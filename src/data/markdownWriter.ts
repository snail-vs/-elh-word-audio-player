import { parseEmbeddedWordCardPayload } from "./markdownCardData";
import { WordCardData } from "./wordTypes";

const DEFAULT_CONTEXT_HASH = "default";

export interface WordCardBlock {
  word: string;
  contextHash: string;
  markdown: string;
  card: WordCardData;
}

export function upsertWordCardMarkdown(
  existingMarkdown: string,
  cardMarkdown: string,
  word: string,
  contextHash = DEFAULT_CONTEXT_HASH
): string {
  const markerWord = normalizeMarkerPart(word);
  const markerContext = normalizeMarkerPart(contextHash || DEFAULT_CONTEXT_HASH);
  const existingBlock = findWordCardBlockRange(existingMarkdown, markerWord, markerContext);
  const normalizedCardMarkdown = ensureTrailingNewline(cardMarkdown.trim());

  if (existingBlock) {
    return [
      existingMarkdown.slice(0, existingBlock.start),
      normalizedCardMarkdown,
      existingMarkdown.slice(existingBlock.end)
    ].join("");
  }

  if (!existingMarkdown.trim()) {
    return normalizedCardMarkdown;
  }

  return `${existingMarkdown.replace(/\s*$/u, "")}\n\n${normalizedCardMarkdown}`;
}

export function extractWordCardBlocks(markdown: string): WordCardBlock[] {
  const blocks: WordCardBlock[] = [];
  const blockPattern =
    /<div\s+elh-word-card:start\s+([^\s>]+)\s+([^\s>]+)\s*>[\s\S]*?<div\s+elh-word-card:end\s+\1\s+\2\s*><\/div>/g;

  for (const match of markdown.matchAll(blockPattern)) {
    const blockMarkdown = match[0];
    const payload = parseEmbeddedWordCardPayload(blockMarkdown);
    if (!payload) continue;

    blocks.push({
      word: payload.card.word,
      contextHash: payload.contextHash,
      markdown: blockMarkdown,
      card: payload.card
    });
  }

  return blocks;
}

function findWordCardBlockRange(
  markdown: string,
  markerWord: string,
  markerContext: string
): { start: number; end: number } | null {
  const startMarker = `<div elh-word-card:start ${markerWord} ${markerContext}>`;
  const endMarker = `<div elh-word-card:end ${markerWord} ${markerContext}></div>`;
  const start = markdown.indexOf(startMarker);
  if (start === -1) return null;

  const endMarkerStart = markdown.indexOf(endMarker, start + startMarker.length);
  if (endMarkerStart === -1) return null;

  return {
    start,
    end: endMarkerStart + endMarker.length
  };
}

function normalizeMarkerPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-") || DEFAULT_CONTEXT_HASH;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
