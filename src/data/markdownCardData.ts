import { WORD_CARD_SCHEMA_VERSION, WordCardData } from "./wordTypes";

export interface EmbeddedWordCardPayload {
  schemaVersion: number;
  contextHash: string;
  card: WordCardData;
}

export function serializeEmbeddedWordCardPayload(card: WordCardData, contextHash: string): string {
  const payload: EmbeddedWordCardPayload = {
    schemaVersion: WORD_CARD_SCHEMA_VERSION,
    contextHash,
    card
  };

  return encodeBase64Url(JSON.stringify(payload));
}

export function parseEmbeddedWordCardPayload(markdown: string): EmbeddedWordCardPayload | null {
  const match = markdown.match(/<!--\s*elh-word-card:data\s+([A-Za-z0-9_-]+)\s*-->/);
  if (!match?.[1]) return null;

  try {
    const payload = normalizeEmbeddedWordCardPayload(JSON.parse(decodeBase64Url(match[1])) as unknown);
    return isEmbeddedWordCardPayload(payload) ? payload : null;
  } catch (error) {
    console.error("Failed to parse embedded word card payload.", error);
    return null;
  }
}

function normalizeEmbeddedWordCardPayload(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.card)) return value;

  return {
    ...value,
    card: {
      ...value.card,
      contexts: Array.isArray(value.card.contexts) ? value.card.contexts : []
    }
  };
}

function isEmbeddedWordCardPayload(value: unknown): value is EmbeddedWordCardPayload {
  if (!isRecord(value)) return false;

  return (
    value.schemaVersion === WORD_CARD_SCHEMA_VERSION &&
    typeof value.contextHash === "string" &&
    isWordCardData(value.card)
  );
}

function isWordCardData(value: unknown): value is WordCardData {
  if (!isRecord(value)) return false;

  return (
    typeof value.word === "string" &&
    Array.isArray(value.spellingSyllables) &&
    Array.isArray(value.phoneticSyllables) &&
    Array.isArray(value.stressSyllableIndexes) &&
    typeof value.fullPhonetic === "string" &&
    Array.isArray(value.basicExplanations) &&
    Array.isArray(value.coreMeanings) &&
    typeof value.contextMeaning === "string" &&
    typeof value.example === "string" &&
    Array.isArray(value.contexts) &&
    typeof value.roots === "string" &&
    Array.isArray(value.meaningDistribution) &&
    typeof value.audioSrc === "string"
  );
}

function encodeBase64Url(value: string): string {
  return encodeBase64(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return decodeBase64(padded);
}

function encodeBase64(value: string): string {
  const bufferConstructor = getBufferConstructor();

  if (bufferConstructor) {
    return bufferConstructor.from(value, "utf8").toString("base64");
  }

  return btoa(unescape(encodeURIComponent(value)));
}

function decodeBase64(value: string): string {
  const bufferConstructor = getBufferConstructor();

  if (bufferConstructor) {
    return bufferConstructor.from(value, "base64").toString("utf8");
  }

  return decodeURIComponent(escape(atob(value)));
}

function getBufferConstructor():
  | {
      from(value: string, encoding: "utf8" | "base64"): { toString(encoding: "base64" | "utf8"): string };
    }
  | null {
  const globalValue = globalThis as typeof globalThis & {
    Buffer?: {
      from(value: string, encoding: "utf8" | "base64"): { toString(encoding: "base64" | "utf8"): string };
    };
  };

  return globalValue.Buffer ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
