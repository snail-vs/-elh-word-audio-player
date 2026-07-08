export const WORD_CARD_SCHEMA_VERSION = 1;

export interface MeaningDistributionItem {
  proportion: string;
  tr: string;
}

export interface WordCardData {
  word: string;
  spellingSyllables: string[];
  phoneticSyllables: string[];
  stressSyllableIndexes: number[];
  fullPhonetic: string;
  basicExplanations: string[];
  coreMeanings: string[];
  contextMeaning: string;
  example: string;
  roots: string;
  meaningDistribution: MeaningDistributionItem[];
  audioSrc: string;
}

export interface WordLookupSource {
  youdaoRaw: unknown;
  youdaoFetchedAt: number;
  aiModel?: string;
  aiGeneratedAt?: number;
  aiFallbackUsed?: boolean;
  aiError?: string;
}

export interface WordLookupRecord {
  word: string;
  context?: string;
  contextHash: string;
  card: WordCardData;
  source: WordLookupSource;
  markdown: string;
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
}

export interface YoudaoExampleCandidate {
  sentence: string;
  translation?: string;
  source?: string;
}

export interface ParsedYoudaoData {
  word: string;
  fullPhonetic: string;
  basicExplanations: string[];
  meaningDistribution: MeaningDistributionItem[];
  audioSrc: string;
  exampleCandidates: YoudaoExampleCandidate[];
  englishDefinitions: string[];
  etymologyCandidates: string[];
}

export interface WordLookupFetchResult {
  parsed: ParsedYoudaoData;
  raw: unknown;
}
