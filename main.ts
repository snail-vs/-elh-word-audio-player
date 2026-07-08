import {
  App,
  ItemView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TextComponent,
  TFile,
  WorkspaceLeaf
} from "obsidian";

import { generateAiWordCard } from "./src/data/aiCardGenerator";
import { writeWordCardToVault } from "./src/data/vaultMarkdownWriter";
import { fetchYoudaoWord } from "./src/data/youdaoClient";
import { lookupWordCard } from "./src/data/wordLookupPipeline";
import { IndexedDbWordLookupRecordStore, WordLookupRecordStore } from "./src/data/wordLookupStore";

const VIEW_TYPE_WORD_PLAYER = "elh-word-audio-player-view";

interface WordPlayerSettings {
  sourceFile: string;
  targetWordFile: string;
  listLoopCount: number;
  wordLoopCount: number;
  enableAiGeneration: boolean;
  aiEndpointUrl: string;
  aiApiKey: string;
  aiModel: string;
}

interface WordEntry {
  word: string;
  audioSrc: string;
  spellingSyllables: string[];
  stressSyllableIndexes: number[];
  roots: string;
  contextMeaning: string;
  example: string;
  startLine: number;
}

const DEFAULT_SETTINGS: WordPlayerSettings = {
  sourceFile: "reading/单词记忆.md",
  targetWordFile: "reading/单词记忆.md",
  listLoopCount: 2,
  wordLoopCount: 5,
  enableAiGeneration: false,
  aiEndpointUrl: "https://api.openai.com/v1/chat/completions",
  aiApiKey: "",
  aiModel: ""
};

export default class WordAudioPlayerPlugin extends Plugin {
  settings: WordPlayerSettings;
  private wordStore: WordLookupRecordStore;

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.wordStore = new IndexedDbWordLookupRecordStore();

    this.registerView(
      VIEW_TYPE_WORD_PLAYER,
      (leaf) => new WordAudioPlayerView(leaf, this)
    );

    this.addRibbonIcon("volume-2", "Open word audio player", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-word-audio-player",
      name: "Open word audio player",
      callback: () => this.activateView()
    });

    this.addCommand({
      id: "lookup-youdao-word-card",
      name: "Lookup word and write card",
      callback: () => this.lookupWordFromPrompt()
    });

    this.addSettingTab(new WordAudioPlayerSettingTab(this.app, this));
  }

  onunload() {
    this.wordStore?.close();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_WORD_PLAYER);
  }

  async activateView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_WORD_PLAYER);
    const leaf = leaves[0] ?? this.app.workspace.getRightLeaf(false);

    if (!leaf) {
      new Notice("Could not create word audio player view.");
      return;
    }

    await leaf.setViewState({
      type: VIEW_TYPE_WORD_PLAYER,
      active: true
    });

    this.app.workspace.revealLeaf(leaf);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async lookupAndWriteWordCard(word: string, options: { forceRefresh?: boolean } = {}) {
    const normalizedWord = word.trim();
    if (!normalizedWord) return null;

    const result = await lookupWordCard(normalizedWord, {
      store: this.wordStore,
      fetchWord: fetchYoudaoWord,
      generateCard: this.getAiCardGenerator(),
      getAiModel: () => this.settings.aiModel.trim() || undefined,
      forceRefresh: options.forceRefresh
    });

    await writeWordCardToVault(
      this.app,
      this.settings.targetWordFile,
      result.record.markdown,
      result.record.word,
      result.record.contextHash
    );
    await this.reloadWordPlayerViews();

    return result;
  }

  private getAiCardGenerator() {
    if (
      !this.settings.enableAiGeneration ||
      !this.settings.aiEndpointUrl.trim() ||
      !this.settings.aiApiKey.trim() ||
      !this.settings.aiModel.trim()
    ) {
      return undefined;
    }

    return (fetched: Awaited<ReturnType<typeof fetchYoudaoWord>>, context?: string) =>
      generateAiWordCard({
        parsed: fetched.parsed,
        context,
        settings: {
          endpointUrl: this.settings.aiEndpointUrl,
          apiKey: this.settings.aiApiKey,
          model: this.settings.aiModel
        }
      });
  }

  private async lookupWordFromPrompt() {
    const normalizedWord = await new WordLookupModal(this.app).openAndGetValue();
    if (!normalizedWord) return;

    new Notice(`Looking up ${normalizedWord}...`);

    try {
      const result = await this.lookupAndWriteWordCard(normalizedWord);
      if (!result) return;

      new Notice(getLookupResultMessage(result.record.word, result.cacheHit, result.record.source.aiFallbackUsed));
    } catch (error) {
      console.error(error);
      new Notice(`Word lookup failed: ${normalizedWord}`);
    }
  }

  private async reloadWordPlayerViews() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_WORD_PLAYER);

    await Promise.all(
      leaves.map(async (leaf) => {
        const view = leaf.view;
        if (view instanceof WordAudioPlayerView) {
          await view.reload();
        }
      })
    );
  }
}

class WordLookupModal extends Modal {
  private resolveValue: (value: string | null) => void = () => undefined;
  private textComponent: TextComponent;
  private submitted = false;

  openAndGetValue(): Promise<string | null> {
    return new Promise((resolve) => {
      this.resolveValue = resolve;
      this.open();
    });
  }

  onOpen() {
    this.setTitle("Lookup word");
    this.contentEl.empty();

    this.textComponent = new TextComponent(this.contentEl)
      .setPlaceholder("maintenance");

    this.textComponent.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.submit();
      }
    });

    const actionsEl = this.contentEl.createDiv({ cls: "elh-word-lookup-modal__actions" });

    actionsEl.createEl("button", { text: "Cancel", attr: { type: "button" } }, (button) => {
      button.onclick = () => this.close();
    });

    actionsEl.createEl("button", { text: "Lookup", cls: "mod-cta", attr: { type: "button" } }, (button) => {
      button.onclick = () => this.submit();
    });

    window.setTimeout(() => this.textComponent.inputEl.focus(), 0);
  }

  onClose() {
    this.contentEl.empty();

    if (!this.submitted) {
      this.resolveValue(null);
    }
  }

  private submit() {
    const value = this.textComponent.getValue().trim();
    if (!value) return;

    this.submitted = true;
    this.resolveValue(value);
    this.close();
  }
}

function getLookupResultMessage(
  word: string,
  cacheHit: boolean,
  aiFallbackUsed?: boolean,
  forceRefresh?: boolean
): string {
  if (forceRefresh && aiFallbackUsed) {
    return `${word} refreshed; AI fallback used.`;
  }

  if (forceRefresh) {
    return `${word} refreshed.`;
  }

  if (cacheHit) {
    return `${word} written from cache.`;
  }

  if (aiFallbackUsed) {
    return `${word} written; AI fallback used.`;
  }

  return `${word} written.`;
}

class WordAudioPlayerView extends ItemView {
  private readonly plugin: WordAudioPlayerPlugin;
  private entries: WordEntry[] = [];
  private currentIndex = 0;
  private currentListLoop = 1;
  private currentWordLoop = 1;
  private isPlaybackActive = false;
  private audioEl: HTMLAudioElement;
  private contentElRef: HTMLElement;
  private listEl: HTMLElement;
  private wordEl: HTMLElement;
  private countEl: HTMLElement;
  private progressEl: HTMLElement;
  private lookupInputEl: HTMLInputElement;
  private lookupButtonEl: HTMLButtonElement;
  private refreshButtonEl: HTMLButtonElement;
  private lookupStatusEl: HTMLElement;
  private isLookupActive = false;

  constructor(leaf: WorkspaceLeaf, plugin: WordAudioPlayerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_WORD_PLAYER;
  }

  getDisplayText() {
    return "Word Audio Player";
  }

  getIcon() {
    return "volume-2";
  }

  async onOpen() {
    this.renderShell();
    await this.reload();
  }

  async onClose() {
    this.audioEl?.pause();
  }

  private renderShell() {
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass("elh-word-player");

    const lookupEl = root.createDiv({ cls: "elh-word-player__lookup" });
    this.lookupInputEl = lookupEl.createEl("input", {
      attr: {
        type: "text",
        placeholder: "Lookup word",
        "aria-label": "Lookup word"
      }
    });
    this.lookupInputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.lookupFromSidebar();
      }
    });

    this.lookupButtonEl = lookupEl.createEl("button", {
      text: "Lookup",
      attr: { type: "button" }
    });
    this.lookupButtonEl.onclick = () => this.lookupFromSidebar();

    this.refreshButtonEl = lookupEl.createEl("button", {
      text: "Refresh",
      attr: { type: "button" }
    });
    this.refreshButtonEl.onclick = () => this.lookupFromSidebar({ forceRefresh: true });

    this.lookupStatusEl = root.createDiv({ cls: "elh-word-player__lookup-status" });

    const toolbarEl = root.createDiv({ cls: "elh-word-player__toolbar" });
    toolbarEl.createDiv({
      cls: "elh-word-player__path",
      text: this.plugin.settings.sourceFile
    });

    const actionsEl = toolbarEl.createDiv({ cls: "elh-word-player__actions" });
    actionsEl.createEl("button", { text: "⟳", attr: { "aria-label": "Reload" } }, (button) => {
      button.onclick = () => this.reload();
    });
    actionsEl.createEl("button", { text: "▶", attr: { "aria-label": "Play" } }, (button) => {
      button.onclick = () => this.startPlayback();
    });
    actionsEl.createEl("button", { text: "⏸", attr: { "aria-label": "Pause" } }, (button) => {
      button.onclick = () => this.pausePlayback();
    });

    const nowEl = root.createDiv({ cls: "elh-word-player__now" });
    this.wordEl = nowEl.createDiv({ cls: "elh-word-player__word" });
    this.countEl = nowEl.createDiv({ cls: "elh-word-player__count" });
    this.progressEl = root.createDiv({ cls: "elh-word-player__progress" });

    this.audioEl = root.createEl("audio", { attr: { controls: "true", preload: "metadata" } });
    this.audioEl.onended = () => this.handleEnded();
    this.audioEl.onerror = () => {
      const entry = this.entries[this.currentIndex];
      if (entry) {
        new Notice(`Audio failed: ${entry.word}`);
      }
    };

    this.contentElRef = root.createDiv({ cls: "elh-word-player__content" });
    this.listEl = root.createDiv({ cls: "elh-word-player__list" });
  }

  private async lookupFromSidebar(options: { forceRefresh?: boolean } = {}) {
    if (this.isLookupActive) return;

    const word = this.lookupInputEl.value.trim();
    if (!word) return;

    this.setLookupState(true, `${options.forceRefresh ? "Refreshing" : "Looking up"} ${word}...`);

    try {
      const result = await this.plugin.lookupAndWriteWordCard(word, options);
      if (!result) return;

      if (!options.forceRefresh) {
        this.lookupInputEl.value = "";
      }
      this.setLookupState(
        false,
        getLookupResultMessage(
          result.record.word,
          result.cacheHit,
          result.record.source.aiFallbackUsed,
          options.forceRefresh
        )
      );
    } catch (error) {
      console.error(error);
      this.setLookupState(false, `Lookup failed: ${word}`);
      new Notice(`Word lookup failed: ${word}`);
    }
  }

  private setLookupState(isActive: boolean, status: string) {
    this.isLookupActive = isActive;
    this.lookupInputEl.disabled = isActive;
    this.lookupButtonEl.disabled = isActive;
    this.refreshButtonEl.disabled = isActive;
    this.lookupButtonEl.setText(isActive ? "..." : "Lookup");
    this.refreshButtonEl.setText(isActive ? "..." : "Refresh");
    this.lookupStatusEl.setText(status);
  }

  async reload() {
    const sourceFile = this.getSourceFile();

    if (!sourceFile) {
      new Notice(`Word file not found: ${this.plugin.settings.sourceFile}`);
      this.entries = [];
      await this.renderCurrent();
      return;
    }

    const markdown = await this.app.vault.read(sourceFile);
    this.entries = parseWordEntries(markdown);
    this.currentIndex = Math.min(this.currentIndex, Math.max(this.entries.length - 1, 0));
    this.resetLoopProgress();
    this.renderList();
    await this.renderCurrent();

    if (this.entries.length === 0) {
      new Notice("No word audio entries found.");
    }
  }

  private getSourceFile(): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.sourceFile);
    return file instanceof TFile ? file : null;
  }

  private async handleEnded() {
    if (!this.isPlaybackActive || this.entries.length === 0) return;

    if (this.currentWordLoop < this.getWordLoopCount()) {
      this.currentWordLoop += 1;
      this.updateProgress();
      await this.playCurrent();
      return;
    }

    this.currentWordLoop = 1;

    if (this.currentIndex < this.entries.length - 1) {
      this.currentIndex += 1;
      await this.renderCurrent();
      await this.playCurrent();
      return;
    }

    if (this.currentListLoop < this.getListLoopCount()) {
      this.currentListLoop += 1;
      this.currentIndex = 0;
      await this.renderCurrent();
      await this.playCurrent();
      return;
    }

    this.stopPlayback();
    new Notice("Word playback completed.");
  }

  private async startPlayback() {
    if (this.entries.length === 0) return;

    this.isPlaybackActive = true;
    await this.playCurrent();
  }

  private pausePlayback() {
    this.isPlaybackActive = false;
    this.audioEl.pause();
  }

  private stopPlayback() {
    this.isPlaybackActive = false;
    this.audioEl.pause();
    this.audioEl.currentTime = 0;
    this.resetLoopProgress();
    this.updateProgress();
  }

  private resetLoopProgress() {
    this.currentListLoop = 1;
    this.currentWordLoop = 1;
  }

  private async restartFromEntry(index: number) {
    this.currentIndex = index;
    this.resetLoopProgress();
    await this.renderCurrent();
    await this.startPlayback();
  }

  private async playCurrent() {
    const entry = this.entries[this.currentIndex];
    if (!entry) return;

    if (this.audioEl.src !== entry.audioSrc) {
      this.audioEl.src = entry.audioSrc;
    }

    try {
      this.audioEl.currentTime = 0;
      await this.audioEl.play();
    } catch (error) {
      new Notice(`Playback blocked or failed: ${entry.word}`);
      console.error(error);
    }
  }

  private async selectEntry(index: number, autoplay = true) {
    if (index < 0 || index >= this.entries.length) return;

    if (autoplay) {
      await this.restartFromEntry(index);
      return;
    }

    this.currentIndex = index;
    this.resetLoopProgress();
    await this.renderCurrent();
  }

  private async renderCurrent() {
    const entry = this.entries[this.currentIndex];
    this.contentElRef.empty();
    this.wordEl.setText(entry?.word ?? "No word loaded");
    this.countEl.setText(entry ? `${this.currentIndex + 1}/${this.entries.length}` : "0/0");
    this.updateProgress();

    if (!entry) {
      this.audioEl.removeAttribute("src");
      return;
    }

    this.audioEl.src = entry.audioSrc;
    const cardEl = this.contentElRef.createDiv({ cls: "elh-word-player__card" });
    renderWordCard(cardEl, entry);
    this.contentElRef.scrollTo({ top: 0, behavior: "smooth" });
    this.renderList();
  }

  private renderList() {
    this.listEl.empty();

    this.entries.forEach((entry, index) => {
      const itemEl = this.listEl.createEl("button", {
        cls: "elh-word-player__item",
        attr: { type: "button" }
      });
      itemEl.toggleClass("is-active", index === this.currentIndex);
      itemEl.createSpan({ text: String(index + 1).padStart(2, "0") });
      itemEl.createSpan({ text: entry.word });
      itemEl.onclick = () => this.selectEntry(index);
    });
  }

  private updateProgress() {
    if (!this.progressEl) return;

    if (this.entries.length === 0) {
      this.progressEl.setText("列表 0/0 · 单词 0/0");
      return;
    }

    this.progressEl.setText(
      `列表 ${this.currentListLoop}/${this.getListLoopCount()} · 单词 ${this.currentWordLoop}/${this.getWordLoopCount()}`
    );
  }

  private getListLoopCount() {
    return normalizeLoopCount(this.plugin.settings.listLoopCount, DEFAULT_SETTINGS.listLoopCount);
  }

  private getWordLoopCount() {
    return normalizeLoopCount(this.plugin.settings.wordLoopCount, DEFAULT_SETTINGS.wordLoopCount);
  }
}

class WordAudioPlayerSettingTab extends PluginSettingTab {
  private readonly plugin: WordAudioPlayerPlugin;

  constructor(app: App, plugin: WordAudioPlayerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Source word file")
      .setDesc("Vault-relative markdown path, for example: reading/单词记忆.md")
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.sourceFile)
          .setValue(this.plugin.settings.sourceFile)
          .onChange(async (value) => {
            this.plugin.settings.sourceFile = value.trim() || DEFAULT_SETTINGS.sourceFile;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Target word file")
      .setDesc("Vault-relative markdown path where generated lookup cards are written.")
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.targetWordFile)
          .setValue(this.plugin.settings.targetWordFile)
          .onChange(async (value) => {
            this.plugin.settings.targetWordFile = value.trim() || DEFAULT_SETTINGS.targetWordFile;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("List loop count")
      .setDesc("How many times to play the full word list before stopping.")
      .addText((text) => {
        text
          .setPlaceholder(String(DEFAULT_SETTINGS.listLoopCount))
          .setValue(String(this.plugin.settings.listLoopCount))
          .onChange(async (value) => {
            this.plugin.settings.listLoopCount = normalizeLoopCount(
              Number.parseInt(value, 10),
              DEFAULT_SETTINGS.listLoopCount
            );
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Word loop count")
      .setDesc("How many times to repeat each word before moving to the next word.")
      .addText((text) => {
        text
          .setPlaceholder(String(DEFAULT_SETTINGS.wordLoopCount))
          .setValue(String(this.plugin.settings.wordLoopCount))
          .onChange(async (value) => {
            this.plugin.settings.wordLoopCount = normalizeLoopCount(
              Number.parseInt(value, 10),
              DEFAULT_SETTINGS.wordLoopCount
            );
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Enable AI generation")
      .setDesc("When enabled, lookup uses an OpenAI-compatible chat completion endpoint to complete syllables, meanings, and roots.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.enableAiGeneration)
          .onChange(async (value) => {
            this.plugin.settings.enableAiGeneration = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("AI endpoint URL")
      .setDesc("OpenAI-compatible chat completions endpoint.")
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.aiEndpointUrl)
          .setValue(this.plugin.settings.aiEndpointUrl)
          .onChange(async (value) => {
            this.plugin.settings.aiEndpointUrl = value.trim() || DEFAULT_SETTINGS.aiEndpointUrl;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("AI model")
      .setDesc("Model name sent to the configured endpoint.")
      .addText((text) => {
        text
          .setPlaceholder("model name")
          .setValue(this.plugin.settings.aiModel)
          .onChange(async (value) => {
            this.plugin.settings.aiModel = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("AI API key")
      .setDesc("Stored in Obsidian plugin data on this device.")
      .addText((text) => {
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.aiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.aiApiKey = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
      });
  }
}

function parseWordEntries(markdown: string): WordEntry[] {
  const lines = markdown.split(/\r?\n/);
  const entries: WordEntry[] = [];
  const headingIndexes: number[] = [];

  lines.forEach((line, index) => {
    if (/^##\s+\S/.test(line)) {
      headingIndexes.push(index);
    }
  });

  headingIndexes.forEach((startLine, headingPosition) => {
    const endLine = headingIndexes[headingPosition + 1] ?? lines.length;
    const blockLines = lines.slice(startLine, endLine);
    const heading = blockLines[0].replace(/^##\s+/, "").trim();
    const block = blockLines.join("\n").trim();
    const audioSrc = extractAudioSrc(block);

    if (!heading || !audioSrc) return;

    entries.push({
      word: heading,
      audioSrc,
      spellingSyllables: extractSpellingSyllables(block),
      stressSyllableIndexes: extractStressSyllableIndexes(block),
      roots: extractField(block, "词根"),
      contextMeaning: extractField(block, "语境含义"),
      example: normalizeExample(extractField(block, "例句")),
      startLine
    });
  });

  return entries;
}

function extractAudioSrc(markdown: string): string | null {
  const audioMatch = markdown.match(/<audio\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i);
  return audioMatch?.[1] ? normalizeAudioSrc(audioMatch[1]) : null;
}

function extractField(markdown: string, label: string): string {
  const escapedLabel = escapeRegExp(label);
  const fieldMatch = markdown.match(new RegExp(`^\\s*\\*\\*${escapedLabel}\\*\\*\\s*[：:]\\s*(.+?)\\s*$`, "m"));
  return fieldMatch?.[1]?.trim() ?? "";
}

function extractSpellingSyllables(markdown: string): string[] {
  const spelling = extractField(markdown, "拼写音节");
  const syllableText = spelling.replace(/（.*$/, "").replace(/\(.*$/, "").trim();
  return syllableText
    .split("-")
    .map((part) => part.trim())
    .filter(Boolean);
}

function extractStressSyllableIndexes(markdown: string): number[] {
  const stressIndexes: number[] = [];

  markdown.split(/\r?\n/).forEach((line) => {
    const columns = line
      .split("|")
      .map((column) => column.trim())
      .filter(Boolean);

    if (columns.length < 4 || !/^\d+$/.test(columns[0])) return;

    const index = Number.parseInt(columns[0], 10) - 1;
    const stressColumn = columns[3].replace(/\*/g, "").trim();

    if (stressColumn === "是") {
      stressIndexes.push(index);
    }
  });

  return stressIndexes;
}

function normalizeExample(example: string): string {
  return example
    .replace(/^\*+/, "")
    .replace(/\*+$/, "")
    .trim();
}

function normalizeLoopCount(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

function normalizeAudioSrc(src: string): string {
  if (src.startsWith("http://dict.youdao.com/")) {
    return src.replace("http://", "https://");
  }

  return src;
}

function renderWordCard(containerEl: HTMLElement, entry: WordEntry) {
  containerEl.empty();

  renderSyllables(containerEl, entry);
  renderFieldSection(containerEl, "词根", entry.roots, "roots");
  renderFieldSection(containerEl, "语境含义", entry.contextMeaning, "meaning");
  renderExampleSection(containerEl, entry);
}

function renderSyllables(containerEl: HTMLElement, entry: WordEntry) {
  if (entry.spellingSyllables.length === 0) return;

  const sectionEl = createCardSection(containerEl, "拼写音节", "syllables");
  const chipsEl = sectionEl.createDiv({ cls: "elh-word-player__syllables" });

  entry.spellingSyllables.forEach((syllable, index) => {
    const chipEl = chipsEl.createSpan({ cls: "elh-word-player__syllable", text: syllable });
    chipEl.toggleClass("is-stressed", entry.stressSyllableIndexes.includes(index));
  });
}

function renderFieldSection(containerEl: HTMLElement, title: string, value: string, modifier: string) {
  if (!value) return;

  const sectionEl = createCardSection(containerEl, title, modifier);
  sectionEl.createDiv({ cls: "elh-word-player__section-text", text: value });
}

function renderExampleSection(containerEl: HTMLElement, entry: WordEntry) {
  if (!entry.example) return;

  const sectionEl = createCardSection(containerEl, "例句", "example");
  const exampleEl = sectionEl.createDiv({ cls: "elh-word-player__example" });
  appendHighlightedText(exampleEl, entry.example, entry.word);
}

function createCardSection(containerEl: HTMLElement, title: string, modifier: string) {
  const sectionEl = containerEl.createDiv({
    cls: `elh-word-player__section elh-word-player__section--${modifier}`
  });
  sectionEl.createDiv({ cls: "elh-word-player__section-title", text: title });
  return sectionEl;
}

function appendHighlightedText(containerEl: HTMLElement, text: string, word: string) {
  const pattern = new RegExp(`(${escapeRegExp(word)})`, "gi");
  const parts = text.split(pattern);

  parts.forEach((part) => {
    if (!part) return;

    if (part.toLowerCase() === word.toLowerCase()) {
      containerEl.createSpan({ cls: "elh-word-player__example-word", text: part });
      return;
    }

    containerEl.appendText(part);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
