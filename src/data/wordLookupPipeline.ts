import { createBaseWordCardFromYoudao, serializeWordCardToMarkdown } from "./markdownSerializer";
import {
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
  now?: () => number;
}

export interface LookupWordCardResult {
  record: WordLookupRecord;
  cacheHit: boolean;
}

export async function lookupWordCard(word: string, options: LookupWordCardOptions): Promise<LookupWordCardResult> {
  const normalizedWord = normalizeLookupWord(word);
  const contextHash = normalizeContextHash(options.contextHash || DEFAULT_CONTEXT_HASH);
  const cachedRecord = await options.store.get(normalizedWord, contextHash);

  if (cachedRecord) {
    return {
      record: cachedRecord,
      cacheHit: true
    };
  }

  const fetched = await options.fetchWord(normalizedWord);
  const generated = await generateCardWithFallback(fetched, options);
  const card = generated.card;
  const markdown = serializeWordCardToMarkdown(card, contextHash);
  const timestamp = options.now?.() ?? Date.now();

  const record: WordLookupRecord = {
    word: normalizeLookupWord(card.word),
    context: options.context,
    contextHash,
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
