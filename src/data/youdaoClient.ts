import { requestUrl } from "obsidian";

import { parseYoudaoResponse } from "./youdaoParser";
import { ParsedYoudaoData } from "./wordTypes";

const YOUDAO_JSON_API_URL = "https://dict.youdao.com/jsonapi";

export async function lookupYoudaoWord(word: string): Promise<ParsedYoudaoData> {
  const normalizedWord = word.trim();
  if (!normalizedWord) {
    throw new Error("Word is required.");
  }

  const response = await requestUrl({
    url: `${YOUDAO_JSON_API_URL}?q=${encodeURIComponent(normalizedWord)}`,
    method: "GET"
  });

  return parseYoudaoResponse(response.json, normalizedWord);
}
