import {
  App,
  ItemView,
  MarkdownRenderer,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf
} from "obsidian";

const VIEW_TYPE_WORD_PLAYER = "elh-word-audio-player-view";

interface WordPlayerSettings {
  sourceFile: string;
  listLoopCount: number;
  wordLoopCount: number;
}

interface WordEntry {
  word: string;
  markdown: string;
  audioSrc: string;
  startLine: number;
}

const DEFAULT_SETTINGS: WordPlayerSettings = {
  sourceFile: "reading/单词记忆.md",
  listLoopCount: 2,
  wordLoopCount: 5
};

export default class WordAudioPlayerPlugin extends Plugin {
  settings: WordPlayerSettings;

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

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

    this.addSettingTab(new WordAudioPlayerSettingTab(this.app, this));
  }

  onunload() {
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

  private async reload() {
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
    const sourceFile = this.getSourceFile();
    const sourcePath = sourceFile?.path ?? this.plugin.settings.sourceFile;
    const cardEl = this.contentElRef.createDiv({ cls: "elh-word-player__card" });
    await MarkdownRenderer.renderMarkdown(entry.markdown, cardEl, sourcePath, this);
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
      markdown: block,
      audioSrc,
      startLine
    });
  });

  return entries;
}

function extractAudioSrc(markdown: string): string | null {
  const audioMatch = markdown.match(/<audio\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i);
  return audioMatch?.[1] ? normalizeAudioSrc(audioMatch[1]) : null;
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
