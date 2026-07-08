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
  const card = options.generateCard
    ? await options.generateCard(fetched, options.context)
    : createBaseWordCardFromYoudao(fetched.parsed);
  const markdown = serializeWordCardToMarkdown(card, contextHash);
  const timestamp = options.now?.() ?? Date.now();

  const record: WordLookupRecord = {
    word: normalizeLookupWord(card.word),
    context: options.context,
    contextHash,
    card,
    source: {
      youdaoRaw: fetched.raw,
      youdaoFetchedAt: timestamp
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
