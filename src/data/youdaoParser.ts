import { MeaningDistributionItem, ParsedYoudaoData, YoudaoExampleCandidate } from "./wordTypes";

type UnknownRecord = Record<string, unknown>;

export function parseYoudaoResponse(raw: unknown, requestedWord = ""): ParsedYoudaoData {
  const word = extractWord(raw, requestedWord);

  return {
    word,
    fullPhonetic: extractFullPhonetic(raw),
    basicExplanations: uniqueStrings(extractBasicExplanations(raw)),
    meaningDistribution: extractMeaningDistribution(raw),
    audioSrc: buildYoudaoAudioSrc(word),
    exampleCandidates: extractExampleCandidates(raw),
    englishDefinitions: uniqueStrings(extractEnglishDefinitions(raw)),
    etymologyCandidates: uniqueStrings(extractEtymologyCandidates(raw))
  };
}

export function buildYoudaoAudioSrc(word: string): string {
  return `https://dict.youdao.com/dictvoice?type=1&audio=${encodeURIComponent(word)}`;
}

function extractWord(raw: unknown, requestedWord: string): string {
  const fromEc = getString(raw, ["ec", "word", 0, "return-phrase", "l", "i"]);
  const fromSimple = getString(raw, ["simple", "word", 0, "return-phrase"]);
  const fromInput = getString(raw, ["input"]);
  const fallback = requestedWord.trim();

  return (fromEc || fromSimple || fromInput || fallback).trim();
}

function extractFullPhonetic(raw: unknown): string {
  return (
    getString(raw, ["ec", "word", 0, "usphone"]) ||
    getString(raw, ["simple", "word", 0, "usphone"]) ||
    getString(raw, ["ec", "word", 0, "ukphone"]) ||
    getString(raw, ["simple", "word", 0, "ukphone"]) ||
    ""
  );
}

function extractBasicExplanations(raw: unknown): string[] {
  const explanations: string[] = [];
  const ecWords = getArray(raw, ["ec", "word"]);

  ecWords.forEach((wordEntry) => {
    getArray(wordEntry, ["trs"]).forEach((trsEntry) => {
      getArray(trsEntry, ["tr"]).forEach((trEntry) => {
        explanations.push(...getStringList(trEntry, ["l", "i"]));
      });
    });
  });

  return explanations;
}

function extractMeaningDistribution(raw: unknown): MeaningDistributionItem[] {
  return getArray(raw, ["blng_sents_part", "trs-classify"])
    .map((item) => ({
      proportion: getString(item, ["proportion"]),
      tr: getString(item, ["tr"])
    }))
    .filter((item) => item.proportion && item.tr && item.tr !== "全部");
}

function extractExampleCandidates(raw: unknown): YoudaoExampleCandidate[] {
  const candidates: YoudaoExampleCandidate[] = [];

  getArray(raw, ["expand_ec", "word"]).forEach((wordEntry) => {
    getArray(wordEntry, ["transList"]).forEach((transEntry) => {
      getArray(transEntry, ["content", "sents"]).forEach((sentEntry) => {
        const sentence = stripHtml(getString(sentEntry, ["sentOrig"]));
        if (!sentence) return;

        candidates.push({
          sentence,
          translation: getString(sentEntry, ["sentTrans"]) || undefined,
          source: getString(sentEntry, ["source"]) || undefined
        });
      });
    });
  });

  return dedupeExamples(candidates);
}

function extractEnglishDefinitions(raw: unknown): string[] {
  const definitions: string[] = [];

  getArray(raw, ["ee", "word", "trs"]).forEach((trsEntry) => {
    getArray(trsEntry, ["tr"]).forEach((trEntry) => {
      definitions.push(...getStringList(trEntry, ["l", "i"]));
    });
  });

  return definitions;
}

function extractEtymologyCandidates(raw: unknown): string[] {
  const candidates: string[] = [];

  getArray(raw, ["etym", "etyms", "zh"]).forEach((entry) => {
    candidates.push(...collectStrings(entry, ["word", "value", "desc", "text", "source"]));
  });

  return candidates;
}

function getString(root: unknown, path: Array<string | number>): string {
  const value = getPath(root, path);
  return typeof value === "string" ? value.trim() : "";
}

function getStringList(root: unknown, path: Array<string | number>): string[] {
  const value = getPath(root, path);

  if (typeof value === "string") {
    return [value.trim()].filter(Boolean);
  }

  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function getArray(root: unknown, path: Array<string | number>): unknown[] {
  const value = getPath(root, path);
  return Array.isArray(value) ? value : [];
}

function getPath(root: unknown, path: Array<string | number>): unknown {
  return path.reduce<unknown>((current, segment) => {
    if (typeof segment === "number") {
      return Array.isArray(current) ? current[segment] : undefined;
    }

    return isRecord(current) ? current[segment] : undefined;
  }, root);
}

function collectStrings(root: unknown, keys: string[]): string[] {
  const values: string[] = [];

  if (typeof root === "string") {
    values.push(root.trim());
    return values.filter(Boolean);
  }

  if (Array.isArray(root)) {
    root.forEach((item) => values.push(...collectStrings(item, keys)));
    return values;
  }

  if (!isRecord(root)) return values;

  Object.entries(root).forEach(([key, value]) => {
    if (keys.includes(key)) {
      values.push(...collectStrings(value, keys));
      return;
    }

    if (Array.isArray(value) || isRecord(value)) {
      values.push(...collectStrings(value, keys));
    }
  });

  return values.filter(Boolean);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach((value) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) return;

    seen.add(normalized);
    result.push(normalized);
  });

  return result;
}

function dedupeExamples(examples: YoudaoExampleCandidate[]): YoudaoExampleCandidate[] {
  const seen = new Set<string>();
  const result: YoudaoExampleCandidate[] = [];

  examples.forEach((example) => {
    const key = example.sentence.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    result.push(example);
  });

  return result;
}
