import { createBaseWordCardFromYoudao, serializeWordCardToMarkdown } from "./markdownSerializer";
import {
  createContextHash,
  createWordLookupKey,
  normalizeContextHash,
  normalizeLookupWord,
  WordLookupRecordStore
} from "./wordLookupStore";
import { WORD_CARD_SCHEMA_VERSION, WordCardData, WordLookupFetchResult, WordLookupRecord } from "./wordTypes";

const DEFAULT_CONTEXT_HASH = "default";

export interface LookupWordCardOptions {
  store: WordLookupRecordStore;
  fetchWord: (word: string) => Promise<WordLookupFetchResult>;
  generateCard?: (fetched: WordLookupFetchResult, context?: string) => Promise<WordCardData>;
  getAiModel?: () => string | undefined;
  context?: string;
  contextHash?: string;
  forceRefresh?: boolean;
  now?: () => number;
}

export interface LookupWordCardResult {
  record: WordLookupRecord;
  cacheHit: boolean;
}

export async function lookupWordCard(word: string, options: LookupWordCardOptions): Promise<LookupWordCardResult> {
  const normalizedWord = normalizeLookupWord(word);
  const context = options.context?.trim() || undefined;
  const cardContextHash = normalizeContextHash(options.contextHash || createContextHash(context));
  const recordContextHash = DEFAULT_CONTEXT_HASH;
  const cachedRecord = await options.store.get(normalizedWord, recordContextHash);

  if (cachedRecord && !options.forceRefresh && (!context || hasContextEntry(cachedRecord.card, cardContextHash))) {
    return {
      record: cachedRecord,
      cacheHit: true
    };
  }

  const fetched = await options.fetchWord(normalizedWord);
  const generated = await generateCardWithFallback(fetched, { ...options, context });
  const timestamp = options.now?.() ?? Date.now();
  const contextEntry = context
    ? createContextEntry(generated.card, context, cardContextHash, timestamp, cachedRecord?.card)
    : null;
  const card = mergeWordCards(cachedRecord?.card, generated.card, contextEntry, Boolean(options.forceRefresh));
  const markdown = serializeWordCardToMarkdown(card, recordContextHash);

  const record: WordLookupRecord = {
    word: normalizeLookupWord(card.word),
    context,
    contextHash: recordContextHash,
    card,
    source: {
      youdaoRaw: fetched.raw,
      youdaoFetchedAt: timestamp,
      aiModel: generated.aiGenerated ? options.getAiModel?.() : undefined,
      aiGeneratedAt: generated.aiGenerated ? timestamp : undefined,
      aiFallbackUsed: generated.aiFallbackUsed || undefined,
      aiError: generated.aiError
    },
    markdown,
    schemaVersion: WORD_CARD_SCHEMA_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  await options.store.put(record);

  return {
    record,
    cacheHit: false
  };
}

export function getLookupRecordKey(record: Pick<WordLookupRecord, "word" | "contextHash">): string {
  return createWordLookupKey(record.word, record.contextHash);
}

function hasContextEntry(card: WordCardData, contextHash: string): boolean {
  return card.contexts.some((entry) => entry.contextHash === contextHash);
}

function createContextEntry(
  generatedCard: WordCardData,
  context: string,
  contextHash: string,
  timestamp: number,
  existingCard?: WordCardData
) {
  const existingEntry = existingCard?.contexts.find((entry) => entry.contextHash === contextHash);

  return {
    contextHash,
    context: createContextExcerpt(context),
    contextMeaning: generatedCard.contextMeaning,
    example: generatedCard.example,
    createdAt: existingEntry?.createdAt ?? timestamp,
    updatedAt: timestamp
  };
}

function mergeWordCards(
  existingCard: WordCardData | undefined,
  generatedCard: WordCardData,
  contextEntry: WordCardData["contexts"][number] | null,
  refreshBase: boolean
): WordCardData {
  const baseCard = !existingCard || refreshBase ? generatedCard : existingCard;
  const existingContexts = existingCard?.contexts ?? [];
  const contexts = mergeContextEntries(existingContexts, contextEntry);

  return {
    ...baseCard,
    contexts
  };
}

function mergeContextEntries(
  existingContexts: WordCardData["contexts"],
  contextEntry: WordCardData["contexts"][number] | null
): WordCardData["contexts"] {
  const contextsByHash = new Map<string, WordCardData["contexts"][number]>();

  existingContexts.forEach((entry) => {
    contextsByHash.set(entry.contextHash, entry);
  });

  if (contextEntry) {
    contextsByHash.set(contextEntry.contextHash, contextEntry);
  }

  return Array.from(contextsByHash.values()).sort((a, b) => a.createdAt - b.createdAt);
}

function createContextExcerpt(context: string): string {
  const normalized = context.replace(/\s+/g, " ").trim();
  const maxLength = 120;

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

async function generateCardWithFallback(
  fetched: WordLookupFetchResult,
  options: LookupWordCardOptions
): Promise<{
  card: WordCardData;
  aiGenerated: boolean;
  aiFallbackUsed: boolean;
  aiError?: string;
}> {
  if (!options.generateCard) {
    return {
      card: createBaseWordCardFromYoudao(fetched.parsed),
      aiGenerated: false,
      aiFallbackUsed: false
    };
  }

  try {
    return {
      card: await options.generateCard(fetched, options.context),
      aiGenerated: true,
      aiFallbackUsed: false
    };
  } catch (error) {
    console.error("AI card generation failed. Falling back to dictionary card.", error);

    return {
      card: createBaseWordCardFromYoudao(fetched.parsed),
      aiGenerated: false,
      aiFallbackUsed: true,
      aiError: getErrorMessage(error)
    };
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
