import { requestUrl } from "obsidian";

import { parseYoudaoResponse } from "./youdaoParser";
import { ParsedYoudaoData, WordLookupFetchResult } from "./wordTypes";

const YOUDAO_JSON_API_URL = "https://dict.youdao.com/jsonapi";

export async function lookupYoudaoWord(word: string): Promise<ParsedYoudaoData> {
  return (await fetchYoudaoWord(word)).parsed;
}

export async function fetchYoudaoWord(word: string): Promise<WordLookupFetchResult> {
  const normalizedWord = word.trim();
  if (!normalizedWord) {
    throw new Error("Word is required.");
  }

  const response = await requestUrl({
    url: `${YOUDAO_JSON_API_URL}?q=${encodeURIComponent(normalizedWord)}`,
    method: "GET"
  });

  return {
    parsed: parseYoudaoResponse(response.json, normalizedWord),
    raw: response.json
  };
}
