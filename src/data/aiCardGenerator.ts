import { requestUrl } from "obsidian";

import { createBaseWordCardFromYoudao } from "./markdownSerializer";
import { ParsedYoudaoData, WordCardData } from "./wordTypes";

export interface AiCardGeneratorSettings {
  endpointUrl: string;
  apiKey: string;
  model: string;
}

export interface GenerateAiWordCardOptions {
  parsed: ParsedYoudaoData;
  context?: string;
  settings: AiCardGeneratorSettings;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export async function generateAiWordCard(options: GenerateAiWordCardOptions): Promise<WordCardData> {
  const endpointUrl = options.settings.endpointUrl.trim();
  const apiKey = options.settings.apiKey.trim();
  const model = options.settings.model.trim();

  if (!endpointUrl || !apiKey || !model) {
    throw new Error("AI endpoint URL, API key, and model are required.");
  }

  const baseCard = createBaseWordCardFromYoudao(options.parsed);
  const response = await requestUrl({
    url: endpointUrl,
    method: "POST",
    contentType: "application/json",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You generate compact English vocabulary learning card JSON. Return only valid JSON with the requested keys."
        },
        {
          role: "user",
          content: buildPrompt(options.parsed, baseCard, options.context)
        }
      ]
    })
  });

  const content = extractMessageContent(response.json as ChatCompletionResponse);
  const aiCard = parseWordCardData(content);

  return mergeWithTrustedDictionaryFields(aiCard, baseCard);
}

function buildPrompt(parsed: ParsedYoudaoData, baseCard: WordCardData, context?: string): string {
  return JSON.stringify({
    task:
      "Complete the vocabulary card. Preserve factual dictionary fields where provided. Use concise Chinese explanations.",
    outputSchema: {
      word: "string",
      spellingSyllables: ["string"],
      phoneticSyllables: ["string"],
      stressSyllableIndexes: ["number, zero-based"],
      fullPhonetic: "string",
      basicExplanations: ["string"],
      coreMeanings: ["string, exactly 3 items when possible"],
      contextMeaning: "string",
      example: "string",
      roots: "string",
      meaningDistribution: [{ proportion: "string", tr: "string" }],
      audioSrc: "string"
    },
    word: parsed.word,
    context: context || "",
    trustedBaseCard: baseCard,
    dictionaryFacts: {
      englishDefinitions: parsed.englishDefinitions,
      exampleCandidates: parsed.exampleCandidates,
      etymologyCandidates: parsed.etymologyCandidates
    },
    requirements: [
      "Align spellingSyllables and phoneticSyllables by syllable count when possible.",
      "stressSyllableIndexes must refer to phoneticSyllables indexes and use zero-based numbers.",
      "coreMeanings should be the three most central senses, not long dictionary dumps.",
      "contextMeaning should use the supplied context if present; otherwise use the most common technical or general sense.",
      "example should be natural and include the target word.",
      "roots should be concise and may mention uncertainty if etymology is not clear."
    ]
  });
}

function extractMessageContent(response: ChatCompletionResponse): string {
  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI response did not include message content.");
  }

  return content;
}

function parseWordCardData(content: string): WordCardData {
  const parsed = JSON.parse(content) as unknown;
  const normalized = normalizeAiWordCardData(parsed);

  if (!isWordCardData(normalized)) {
    throw new Error("AI response did not match WordCardData.");
  }

  return normalized;
}

function mergeWithTrustedDictionaryFields(aiCard: WordCardData, baseCard: WordCardData): WordCardData {
  return {
    ...aiCard,
    word: baseCard.word,
    fullPhonetic: baseCard.fullPhonetic || aiCard.fullPhonetic,
    basicExplanations: baseCard.basicExplanations.length > 0 ? baseCard.basicExplanations : aiCard.basicExplanations,
    meaningDistribution: baseCard.meaningDistribution.length > 0 ? baseCard.meaningDistribution : aiCard.meaningDistribution,
    audioSrc: baseCard.audioSrc || aiCard.audioSrc
  };
}

function isWordCardData(value: unknown): value is WordCardData {
  if (!isRecord(value)) return false;

  return (
    typeof value.word === "string" &&
    isStringArray(value.spellingSyllables) &&
    isStringArray(value.phoneticSyllables) &&
    isNumberArray(value.stressSyllableIndexes) &&
    typeof value.fullPhonetic === "string" &&
    isStringArray(value.basicExplanations) &&
    isStringArray(value.coreMeanings) &&
    typeof value.contextMeaning === "string" &&
    typeof value.example === "string" &&
    Array.isArray(value.contexts) &&
    typeof value.roots === "string" &&
    Array.isArray(value.meaningDistribution) &&
    value.meaningDistribution.every(isMeaningDistributionItem) &&
    typeof value.audioSrc === "string"
  );
}

function normalizeAiWordCardData(value: unknown): unknown {
  if (!isRecord(value)) return value;

  return {
    ...value,
    contexts: Array.isArray(value.contexts) ? value.contexts : []
  };
}

function isMeaningDistributionItem(value: unknown): value is { proportion: string; tr: string } {
  return isRecord(value) && typeof value.proportion === "string" && typeof value.tr === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isInteger(item));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
