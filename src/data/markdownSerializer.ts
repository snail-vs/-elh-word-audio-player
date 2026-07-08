import { serializeEmbeddedWordCardPayload } from "./markdownCardData";
import { ParsedYoudaoData, WordCardData } from "./wordTypes";

const DEFAULT_CONTEXT_HASH = "default";

export function createBaseWordCardFromYoudao(parsed: ParsedYoudaoData): WordCardData {
  return {
    word: parsed.word,
    spellingSyllables: [],
    phoneticSyllables: [],
    stressSyllableIndexes: [],
    fullPhonetic: parsed.fullPhonetic,
    basicExplanations: parsed.basicExplanations,
    coreMeanings: [],
    contextMeaning: "",
    example: parsed.exampleCandidates[0]?.sentence ?? "",
    contexts: [],
    roots: parsed.etymologyCandidates.join("；"),
    meaningDistribution: parsed.meaningDistribution,
    audioSrc: parsed.audioSrc
  };
}

export function serializeWordCardToMarkdown(card: WordCardData, contextHash = DEFAULT_CONTEXT_HASH): string {
  const markerWord = normalizeMarkerPart(card.word);
  const markerContext = normalizeMarkerPart(contextHash || DEFAULT_CONTEXT_HASH);
  const lines: string[] = [];

  lines.push(`<div elh-word-card:start ${markerWord} ${markerContext}>`);
  lines.push(`<!-- elh-word-card:data ${serializeEmbeddedWordCardPayload(card, markerContext)} -->`);
  lines.push("</div>");
  lines.push(`## ${card.word}`);
  lines.push(...serializeSyllableSummary(card));
  lines.push(...serializeFullPhonetic(card));
  lines.push(...serializeBasicExplanations(card));
  lines.push(...serializeSingleLineField("词根", card.roots));
  lines.push(...serializeNumberedSection("核心含义", card.coreMeanings));
  lines.push(...serializeContexts(card));
  if (getCardContexts(card).length === 0) {
    lines.push(...serializeSingleLineField("语境含义", card.contextMeaning));
    lines.push(...serializeExample(card));
  }
  lines.push(...serializeMeaningDistribution(card));
  lines.push(...serializeAudio(card));
  lines.push(`<div elh-word-card:end ${markerWord} ${markerContext}></div>`);

  return trimBlankLines(lines).join("\n") + "\n";
}

function serializeSyllableSummary(card: WordCardData): string[] {
  const lines: string[] = [];

  if (card.spellingSyllables.length > 0) {
    lines.push(
      `**拼写音节**：${formatSpellingSyllableSummary(card.spellingSyllables)}（${card.spellingSyllables.length} 音节）`
    );
  }

  if (card.phoneticSyllables.length > 0) {
    lines.push(
      `**发音音节**：/${formatPhoneticSyllableSummary(card)}/（${card.phoneticSyllables.length} 音节，对齐）`
    );
  }

  return lines;
}

function serializeFullPhonetic(card: WordCardData): string[] {
  if (!card.fullPhonetic) return [];

  return [`**完整音标**：/${stripWrappingSlashes(card.fullPhonetic)}/`];
}

function serializeBasicExplanations(card: WordCardData): string[] {
  if (card.basicExplanations.length === 0) return [];

  return ["**单词基本解释**：", ...card.basicExplanations.map((explanation) => `- ${explanation}`)];
}

function serializeSingleLineField(label: string, value: string): string[] {
  if (!value.trim()) return [];

  return [`**${label}**：${value.trim()}`];
}

function serializeNumberedSection(label: string, values: string[]): string[] {
  if (values.length === 0) return [];

  return [`**${label}**：`, ...values.map((value, index) => `${index + 1}. ${value}`)];
}

function serializeExample(card: WordCardData): string[] {
  if (!card.example.trim()) return [];

  return [`**例句**：*${card.example.trim()}*`];
}

function serializeContexts(card: WordCardData): string[] {
  const contexts = getCardContexts(card);
  if (contexts.length === 0) return [];

  const lines = ["**语境**："];

  contexts.forEach((entry, index) => {
    const contextText = entry.context ? `*${entry.context}*` : "*默认语境*";
    const meaningText = entry.contextMeaning || "待补充";
    const exampleText = entry.example ? `  例句：*${entry.example}*` : "";

    lines.push(`${index + 1}. ${contextText} — ${meaningText}`);
    if (exampleText) {
      lines.push(exampleText);
    }
  });

  return lines;
}

function getCardContexts(card: WordCardData) {
  return Array.isArray(card.contexts) ? card.contexts : [];
}

function serializeMeaningDistribution(card: WordCardData): string[] {
  if (card.meaningDistribution.length === 0) return [];

  const distribution = card.meaningDistribution.map((item) => `${item.tr} ${item.proportion}`).join("，");
  return [`**含义分布**：${distribution}`];
}

function serializeAudio(card: WordCardData): string[] {
  if (!card.audioSrc.trim()) return [];

  return [`**发音**：<audio src="${escapeHtmlAttribute(card.audioSrc.trim())}" controls></audio>`];
}

function formatSpellingSyllableSummary(syllables: string[]): string {
  return syllables.map((syllable) => syllable.replace(/^-+|-+$/g, "")).join("-");
}

function formatPhoneticSyllableSummary(card: WordCardData): string {
  return card.phoneticSyllables
    .map((syllable, index) => {
      const clean = syllable.replace(/^-+|-+$/g, "");
      return card.stressSyllableIndexes.includes(index) ? `***${clean}***` : clean;
    })
    .join("-");
}

function stripWrappingSlashes(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function normalizeMarkerPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-") || DEFAULT_CONTEXT_HASH;
}

function trimBlankLines(lines: string[]): string[] {
  const result = [...lines];

  while (result.length > 0 && result[0] === "") {
    result.shift();
  }

  while (result.length > 0 && result[result.length - 1] === "") {
    result.pop();
  }

  return result;
}
