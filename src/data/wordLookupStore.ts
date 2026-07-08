import { WORD_CARD_SCHEMA_VERSION, WordLookupRecord } from "./wordTypes";

const DEFAULT_CONTEXT_HASH = "default";
const DB_NAME = "elh-word-lookup";
const DB_VERSION = 1;
const STORE_NAME = "word-records";

export interface WordLookupRecordStore {
  get(word: string, contextHash?: string): Promise<WordLookupRecord | null>;
  put(record: WordLookupRecord): Promise<void>;
  delete(word: string, contextHash?: string): Promise<void>;
  listRecent(limit: number): Promise<WordLookupRecord[]>;
  close(): void;
}

export function normalizeLookupWord(word: string): string {
  return word.trim().toLowerCase();
}

export function normalizeContextHash(contextHash = DEFAULT_CONTEXT_HASH): string {
  return contextHash.trim().toLowerCase().replace(/\s+/g, "-") || DEFAULT_CONTEXT_HASH;
}

export function createWordLookupKey(word: string, contextHash = DEFAULT_CONTEXT_HASH): string {
  return `${normalizeLookupWord(word)}::${normalizeContextHash(contextHash)}`;
}

export class IndexedDbWordLookupRecordStore implements WordLookupRecordStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  async get(word: string, contextHash = DEFAULT_CONTEXT_HASH): Promise<WordLookupRecord | null> {
    const db = await this.getDb();
    const record = await idbRequest<WordLookupRecord | undefined>(
      db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(createWordLookupKey(word, contextHash))
    );

    if (!record || record.schemaVersion !== WORD_CARD_SCHEMA_VERSION) {
      return null;
    }

    return record;
  }

  async put(record: WordLookupRecord): Promise<void> {
    const db = await this.getDb();
    const normalizedRecord: WordLookupRecord = {
      ...record,
      word: normalizeLookupWord(record.word),
      contextHash: normalizeContextHash(record.contextHash),
      schemaVersion: WORD_CARD_SCHEMA_VERSION
    };

    await idbRequest(
      db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(normalizedRecord, getRecordKey(normalizedRecord))
    );
  }

  async delete(word: string, contextHash = DEFAULT_CONTEXT_HASH): Promise<void> {
    const db = await this.getDb();
    await idbRequest(
      db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(createWordLookupKey(word, contextHash))
    );
  }

  async listRecent(limit: number): Promise<WordLookupRecord[]> {
    const db = await this.getDb();
    const records = await idbRequest<WordLookupRecord[]>(
      db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll()
    );

    return records
      .filter((record) => record.schemaVersion === WORD_CARD_SCHEMA_VERSION)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.max(0, limit));
  }

  close(): void {
    if (!this.dbPromise) return;

    this.dbPromise.then((db) => db.close()).catch(console.error);
    this.dbPromise = null;
  }

  private getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openWordLookupDb();
    }

    return this.dbPromise;
  }
}

function openWordLookupDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction?.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME);

      if (!store) return;

      createIndexIfMissing(store, "word", "word");
      createIndexIfMissing(store, "updatedAt", "updatedAt");
      createIndexIfMissing(store, "schemaVersion", "schemaVersion");
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open word lookup IndexedDB."));
  });
}

function createIndexIfMissing(store: IDBObjectStore, indexName: string, keyPath: string): void {
  if (!store.indexNames.contains(indexName)) {
    store.createIndex(indexName, keyPath);
  }
}

function idbRequest<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function getRecordKey(record: WordLookupRecord): string {
  return createWordLookupKey(record.word, record.contextHash);
}
