# Word Lookup Card Plan

## Goal

Extend the current Obsidian side-view word audio player into a word lookup and card generation tool.

The side view should work like a Copilot-style lookup panel:

1. User enters an English word.
2. User may optionally provide the source sentence or technical context.
3. The plugin checks IndexedDB first.
4. If the word is not cached, the plugin fetches Youdao dictionary JSON.
5. The plugin parses reliable dictionary fields from Youdao.
6. The plugin asks an AI model to complete the learning card fields that require reasoning.
7. The plugin saves the normalized JSON record to IndexedDB.
8. The plugin renders a fixed-format card in the side view.
9. The plugin writes or updates the fixed-format Markdown card in the configured vault note.

The generated Markdown should remain readable and useful even without the plugin.

## Target Card Content

Each generated card must include these sections:

1. Spelling syllables.
2. Pronunciation syllables, including stress marks.
3. Full phonetic transcription.
4. Basic dictionary explanation from Youdao.
5. Three core meanings.
6. Contextual meaning for the current sentence or domain.
7. Contextual example sentence.
8. Root or etymology explanation.
9. Meaning distribution from Youdao `trs-classify`.
10. Audio player using Youdao dictvoice.

Example audio URL:

```html
<audio src="https://dict.youdao.com/dictvoice?type=1&audio=maintenance" controls></audio>
```

## Existing Code Baseline

Current implementation is concentrated in `main.ts`.

Existing capabilities:

- Registers an Obsidian `ItemView` in the right sidebar.
- Reads word cards from a configured Markdown file.
- Parses `## word` sections.
- Extracts `<audio src="...">`.
- Extracts existing Markdown fields such as `词根`, `语境含义`, and `例句`.
- Plays word audio with list-level and word-level loop counts.
- Renders the current card in the side view.

The new feature should reuse the side view and playback behavior, but separate lookup, parsing, caching, generation, Markdown writing, and rendering into clearer modules.

## Data Sources

### Youdao API

Lookup endpoint:

```text
https://dict.youdao.com/jsonapi?q=<word>
```

The local sample `maintenance.dict` is used as the first parser fixture.

Useful fields observed in `maintenance.dict`:

- `ec.word[0].trs[*].tr[*].l.i`
  Basic Chinese explanations.
- `ec.word[0].usphone`
  US phonetic transcription.
- `ec.word[0].ukphone`
  UK phonetic transcription.
- `simple.word[0].usphone`
  Fallback US phonetic transcription.
- `simple.word[0].ukphone`
  Fallback UK phonetic transcription.
- `blng_sents_part["trs-classify"]`
  Meaning distribution. Filter out the aggregate row `全部`.
- `expand_ec.word[*].transList[*].content.sents`
  Example sentence candidates.
- `ee.word.trs`
  English definitions.
- `etym.etyms.zh`
  Etymology candidates.

The plugin should keep the raw Youdao response in IndexedDB so future parser changes can reprocess cached data.

### AI Model

The AI model should not directly write Markdown.

It should receive:

- The word.
- Optional user context.
- Parsed Youdao facts.
- A strict JSON schema request.

It should return only normalized card JSON. The plugin validates this JSON before storing or rendering it.

Fields best handled by AI:

- Spelling syllable split.
- Phonetic syllable split.
- Stress alignment between spelling syllables and phonetic syllables.
- Three core meanings.
- Contextual meaning.
- Contextual example sentence, if Youdao examples are unsuitable.
- Root or etymology explanation.

Fields best handled directly from Youdao:

- Basic explanation.
- Full phonetic transcription.
- Meaning distribution.
- Audio URL.
- Raw example candidates.

## Normalized Data Model

Use one internal model as the boundary between lookup, rendering, Markdown writing, and playback.

```ts
interface WordLookupRecord {
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

interface WordLookupSource {
  youdaoRaw: unknown;
  youdaoFetchedAt: number;
  aiModel?: string;
  aiGeneratedAt?: number;
}

interface WordCardData {
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

interface MeaningDistributionItem {
  proportion: string;
  tr: string;
}
```

`contextHash` should be stable. A simple first version can use normalized lowercase context text plus the word. If no context is supplied, use a constant such as `default`.

## Proposed File Structure

Move toward this structure in small steps:

```text
main.ts
styles.css
src/
  data/
    aiCardGenerator.ts
    markdownCardData.ts
    markdownSerializer.ts
    markdownWriter.ts
    vaultMarkdownWriter.ts
    wordLookupPipeline.ts
    wordLookupStore.ts
    wordTypes.ts
    youdaoClient.ts
    youdaoParser.ts
  playback/
    wordListParser.ts
  view/
    WordLookupView.ts
    renderWordCard.ts
```

Initial implementation may keep files smaller or migrate gradually, but new lookup code should not deepen the current `main.ts` monolith.

## IndexedDB Design

Database name:

```text
elh-word-lookup
```

Object store:

```text
word-records
```

Primary key:

```text
<normalized-word>::<contextHash>
```

Indexes:

- `word`
- `updatedAt`
- `schemaVersion`

Required operations:

- `get(word, contextHash)`
- `put(record)`
- `delete(word, contextHash)`
- `listRecent(limit)`
- `clearAll()`, guarded behind an explicit user action

Cache lookup policy:

1. Check IndexedDB before network or AI.
2. If cached schema version is current, render immediately.
3. If cached schema version is old, allow migration or regeneration later.
4. Never store failed or partial AI results as complete records.

## Markdown Format

Write generated cards with stable block markers so repeated lookups update existing cards instead of duplicating them.

```md
<div elh-word-card:start maintenance default>
<!-- elh-word-card:data <base64url-json> -->
</div>
## maintenance
**拼写音节**：main-te-nance（3 音节）
**发音音节**：/***ˈmeɪn***-tə-nəns/（3 音节，对齐）
**完整音标**：/ˈmeɪntənəns/
**单词基本解释**：
- n. 维护，保养；保持，维持；（依法应负担的）生活费，抚养费
**词根**：main-（来自 manu- 手）+ ten-（保持）+ -ance（名词后缀） -> 维持、维护
**核心含义**：
1. 维护/保养
2. 保持/维持
3. 赡养费/抚养费
**语境含义**：在运维/技术语境中主要指系统维护与保养。
**例句**：*Proxmox VE provides a web GUI for simplifying system maintenance tasks like backup and updates.*
**含义分布**：维护 64.1%，维修 28.4%
**发音**：<audio src="https://dict.youdao.com/dictvoice?type=1&audio=maintenance" controls></audio>
<div elh-word-card:end maintenance default></div>
```

The marker includes the context hash. The hidden `elh-word-card:data` payload stores `schemaVersion`, `contextHash`, and the full `WordCardData`, so IndexedDB can be restored from Markdown without parsing human-facing prose.

## UI Plan

The side view should contain:

- Word input.
- Lookup button.
- Cache status indicator.
- Error or loading state.
- Existing playback controls and word list.
- Optional context input. TODO.
- Current generated card preview. TODO.

Lookup behavior:

1. Trim and normalize the word.
2. Disable lookup while a request is running.
3. Show whether the result came from cache, Youdao, or AI.
4. Render cached results immediately.
5. On failure, show a concise Obsidian `Notice` and keep the previous card visible.

## Settings

Add settings gradually:

- `sourceFile`
  Existing playback source file.
- `targetWordFile`
  Vault-relative file where generated cards are written.
- `listLoopCount`
  Existing playback setting.
- `wordLoopCount`
  Existing playback setting.
- `aiApiKey`
  Stored in plugin data.
- `aiModel`
  Default model for card generation.
- `enableAiGeneration`
  Allows parser-only lookup during development.
- `aiEndpointUrl`
  OpenAI-compatible chat completions endpoint.

The first parser and Markdown steps should not require an AI key.

## Current Status

Completed:

- Youdao parser fixture and normalized data types.
- Markdown serializer with compact human-facing format.
- Hidden embedded JSON payload in Markdown.
- Markdown upsert writer with stable block markers.
- Vault writer for create/update target note.
- Youdao network client using Obsidian `requestUrl`.
- Command palette lookup command.
- Obsidian modal input for command lookup.
- IndexedDB-backed cache behind `WordLookupRecordStore`.
- Lookup pipeline with injectable `fetchWord` and `generateCard`.
- Sidebar lookup UI with word input, Lookup button, loading state, cache-hit status, and automatic list reload.
- Optional AI generation settings and OpenAI-compatible chat completions client.
- AI failure fallback to base dictionary cards.
- Build verification with `npm run build`.

Current known behavior:

- Basic lookup works without AI.
- AI generation is disabled by default.
- Cache hit bypasses Youdao and AI.
- Existing cache records are not regenerated when AI settings change.
- Existing generated Markdown is replaced by word/context marker instead of duplicated.
- If AI generation fails after Youdao succeeds, the plugin writes a base dictionary card and records fallback metadata.

## Completed Execution Plan

### Step 1: Youdao Parser Fixture

Scope:

- Add normalized types.
- Add a parser for Youdao raw JSON.
- Use `maintenance.dict` as the fixture.

Success criteria:

- Parser extracts `maintenance`.
- Parser extracts basic explanations.
- Parser extracts `ˈmeɪntənəns`.
- Parser extracts meaning distribution without the `全部` aggregate row.
- Parser produces the dictvoice audio URL.

Status: Done.

### Step 2: Markdown Serializer

Scope:

- Convert normalized `WordCardData` into fixed-format Markdown.
- Keep this pure and deterministic.

Success criteria:

- The `maintenance` fixture produces a readable Markdown card.
- The generated Markdown includes all required sections.
- The generated Markdown includes stable start and end markers.

Status: Done. The final format is compact and uses `<div elh-word-card:start ...>` / `<div elh-word-card:end ...></div>` markers.

### Step 3: Markdown Writer

Scope:

- Write generated Markdown to the configured target note.
- Replace an existing marked block for the same word and context.
- Append if no block exists.

Success criteria:

- Re-running lookup for the same word does not duplicate the card.
- Missing target file is created.
- Existing unrelated note content is preserved.

Status: Done.

### Step 4: IndexedDB Store

Scope:

- Add a small IndexedDB wrapper.
- Store and retrieve `WordLookupRecord`.

Success criteria:

- First lookup stores the record.
- Second lookup reads the same record from IndexedDB.
- Failed lookups do not create complete records.

Status: Done for normal success flow. Cache-management actions remain TODO.

### Step 5: Youdao Network Client

Scope:

- Fetch Youdao JSON through Obsidian-compatible APIs.
- Parse the response with the Step 1 parser.

Success criteria:

- Online lookup works for `maintenance`.
- Network failure produces a controlled error message.
- Parser errors include enough context for debugging.

Status: Done for online lookup and controlled top-level failure notice. More granular error states remain TODO.

### Step 6: AI Card Generator

Scope:

- Add AI generation behind settings.
- Request strict JSON.
- Validate required fields.

Success criteria:

- AI fills syllables, core meanings, contextual meaning, example, and roots.
- Invalid AI output is rejected and not cached as complete.
- Parser-only fallback remains possible for development.

Status: Partial. AI generator skeleton, settings, JSON validation, parser-only fallback, and AI failure fallback are implemented. Real prompt tuning remains TODO.

### Step 7: Side View Lookup UI

Scope:

- Add word and context inputs to the existing side view.
- Wire lookup to cache, network, AI, Markdown write, and render.

Success criteria:

- Cached lookup renders without network.
- New lookup renders after generation.
- Existing playback controls still work.

Status: Partial. Sidebar word lookup exists and reuses the cache/network/AI pipeline. Context input and immediate rich preview remain TODO.

### Step 8: Playback Compatibility

Scope:

- Update Markdown parsing so newly generated cards are playable.
- Keep existing older cards compatible.

Success criteria:

- New cards appear in the word list.
- Audio playback works from generated cards.
- Existing cards continue to parse.

Status: Partial. Generated cards appear and audio playback works through `<audio>`. Playback parsing does not yet prefer embedded JSON, so new fields such as full phonetic, core meanings, and meaning distribution are not fully rendered in the side card.

### Step 9: Verification

Scope:

- Run TypeScript and build checks.
- Manually verify one full lookup flow in Obsidian.

Success criteria:

- `npm run build` passes.
- Lookup, cache hit, Markdown update, and playback all work for `maintenance`.

Status: Partial. `npm run build` passes. Lookup/cache/write/playback have been manually exercised. AI needs real endpoint testing.

## Todo

### P0: Regenerate and Refresh

- Add `forceRefresh?: boolean` to `lookupWordCard`.
- Add sidebar Refresh button.
- Add command palette refresh command.
- Refresh should bypass cache, refetch data, regenerate AI card if enabled, update IndexedDB, and replace the Markdown block.

### P1: Context Input

- Add context textarea to the sidebar.
- Pass context into `lookupWordCard`.
- Use stable context hash in cache key and Markdown markers.
- Include context in AI generation.

### P1: Playback Parser From Embedded JSON

- Update `parseWordEntries` to prefer `extractWordCardBlocks`.
- Populate side-view entries from `WordCardData`.
- Preserve old Markdown fallback only where needed.

### P1: Side Card Rendering

- Render full phonetic, basic explanations, core meanings, contextual meaning, example, roots, and meaning distribution in the side view.
- Keep the view compact and consistent with the Markdown format.

### P2: Cache Management

- Add clear all cache action.
- Add delete one word cache action.
- Add recent cached word list if useful.
- Add schema migration policy.

### P2: AI Prompt Tuning

- Test real model output.
- Tighten JSON instructions if needed.
- Validate syllable count alignment and stress indexes.
- Reduce hallucinated etymology by requiring uncertainty where appropriate.

### P2: Backend API Adapter

- Add a backend-backed `fetchWord` or `generateCard` implementation when backend shape is known.
- Optionally add a backend-backed `WordLookupRecordStore`.
- Keep `main.ts` depending only on pipeline interfaces.

### P2: Error Classification

- Distinguish Youdao network failure, empty dictionary result, AI failure, JSON validation failure, IndexedDB failure, and vault write failure.
- Show concise UI/Notice messages for each.

## Implementation Rules

- Keep each step independently buildable.
- Prefer pure functions for parsers and serializers.
- Keep raw external data out of UI components.
- Do not let AI output bypass validation.
- Do not directly mutate unrelated user note content.
- Do not duplicate cards on repeated lookup.
- Preserve current playback behavior while adding lookup features.

## Open Decisions

1. Whether multiple contexts for the same word should create multiple cards or update one canonical card.
2. Whether generated card Markdown should ever be inserted into the current active note, or only the fixed configured note.
3. Whether cache records should expire or persist indefinitely.
4. Whether Youdao raw JSON should be stored fully or compressed/trimmed for mobile storage.
5. Whether AI calls should go directly from the plugin or through a backend proxy.
