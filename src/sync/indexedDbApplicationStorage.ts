import type { ApplicationJournalPersistence } from "./applicationStore";
import { TaskMemoV2ApplicationJournal } from "./applicationStorage";

const DATABASE_NAME = "taskmemo-v2-local-application";
const STORE_NAME = "scopes";

type StoredScope = {
  scope: string;
  committed: string | null;
  journal: string | null;
  legacyFingerprint: string;
};

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDBの読み取りに失敗しました。"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDBの保存が中断されました。"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDBへの保存に失敗しました。"));
  });
}

async function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open(DATABASE_NAME, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "scope" });
  };
  return requestResult(request);
}

async function fingerprint(committed: string | null, journal: string | null): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("安全なストレージ検証機能を利用できません。");
  const bytes = new TextEncoder().encode(JSON.stringify([committed, journal]));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateEnvelope(raw: string | null) {
  if (raw === null) return null;
  const parsed = JSON.parse(raw) as Record<string, unknown> | null;
  const history = parsed?.history as Record<string, unknown> | undefined;
  const sync = parsed?.sync as Record<string, unknown> | undefined;
  if (parsed?.version !== 2 || typeof parsed.deviceId !== "string" || !parsed.deviceId ||
      !parsed.domain || typeof parsed.domain !== "object" || Array.isArray(parsed.domain) ||
      !Array.isArray(history?.past) || !Array.isArray(history?.future) ||
      !Array.isArray(sync?.outbox) || !Array.isArray(sync?.seenOpIds))
    throw new Error("既存V2データを検証できません。移行を中止しました。");
  return parsed;
}

/** Web-only adapter. The legacy source is never written, deleted, or silently re-imported. */
export class IndexedDbTaskMemoApplicationJournal implements ApplicationJournalPersistence {
  private constructor(private readonly database: IDBDatabase, private readonly scope: string) {}

  static async open(scope: string, factory?: IDBFactory) {
    const selectedFactory = factory ?? globalThis.indexedDB;
    if (!selectedFactory) throw new Error("IndexedDBを利用できません。V2データの移行を中止しました。");
    const legacy = new TaskMemoV2ApplicationJournal(scope);
    const [committed, journal] = await Promise.all([legacy.loadCommitted(), legacy.loadJournal()]);
    const committedEnvelope = validateEnvelope(committed);
    const journalEnvelope = validateEnvelope(journal);
    if (committedEnvelope && journalEnvelope && committedEnvelope.deviceId !== journalEnvelope.deviceId)
      throw new Error("applicationとjournalの端末識別が一致しません。移行を中止しました。");
    const legacyFingerprint = await fingerprint(committed, journal);
    const database = await openDatabase(selectedFactory);
    try {
      const adapter = new IndexedDbTaskMemoApplicationJournal(database, scope);
      const existing = await adapter.read();
      if (existing) {
        if (existing.scope !== scope || typeof existing.legacyFingerprint !== "string" ||
            (existing.committed !== null && typeof existing.committed !== "string") ||
            (existing.journal !== null && typeof existing.journal !== "string"))
          throw new Error("IndexedDBの既存V2データを検証できません。自動復旧を停止しました。");
        if (existing.legacyFingerprint !== legacyFingerprint)
          throw new Error("移行後に旧localStorageが変更されています。自動復旧を停止しました。");
        return adapter;
      }
      // Preserve both exact snapshots. A single transaction either installs all of them or none.
      const stored: StoredScope = { scope, committed, journal, legacyFingerprint };
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const done = transactionDone(transaction);
      transaction.objectStore(STORE_NAME).add(stored);
      await done;
      const verified = await adapter.read();
      if (!verified || verified.committed !== committed || verified.journal !== journal || verified.legacyFingerprint !== legacyFingerprint)
        throw new Error("IndexedDB移行後の再読み取り検証に失敗しました。");
      const [latestCommitted, latestJournal] = await Promise.all([legacy.loadCommitted(), legacy.loadJournal()]);
      if (latestCommitted !== committed || latestJournal !== journal)
        throw new Error("移行中に旧localStorageが変更されました。同期を開始しません。");
      return adapter;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  private async read(): Promise<StoredScope | undefined> {
    const transaction = this.database.transaction(STORE_NAME, "readonly");
    const done = transactionDone(transaction);
    const result = await requestResult(transaction.objectStore(STORE_NAME).get(this.scope) as IDBRequest<StoredScope | undefined>);
    await done;
    return result;
  }

  private async update(transform: (current: StoredScope) => StoredScope) {
    const transaction = this.database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    const objectStore = transaction.objectStore(STORE_NAME);
    const current = await requestResult(objectStore.get(this.scope) as IDBRequest<StoredScope | undefined>);
    if (!current) { transaction.abort(); await done.catch(() => undefined); throw new Error("IndexedDBのV2データが見つかりません。"); }
    objectStore.put(transform(current));
    await done;
  }

  async loadCommitted() { return (await this.read())?.committed ?? null; }
  async loadJournal() { return (await this.read())?.journal ?? null; }
  writeJournal(value: string) { return this.update((current) => ({ ...current, journal: value })); }
  writeCommitted(value: string) { return this.update((current) => ({ ...current, committed: value })); }
  clearJournal() { return this.update((current) => ({ ...current, journal: null })); }
}
