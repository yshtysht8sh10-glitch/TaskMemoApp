import AsyncStorage from "@react-native-async-storage/async-storage";

import type { ApplicationJournalPersistence } from "./applicationStore";

const COMMITTED_KEY = "@taskmemo/sync-v2/application/v1";
const JOURNAL_KEY = "@taskmemo/sync-v2/application-journal/v1";

export class AsyncStorageApplicationJournal implements ApplicationJournalPersistence {
  loadCommitted() { return AsyncStorage.getItem(COMMITTED_KEY); }
  loadJournal() { return AsyncStorage.getItem(JOURNAL_KEY); }
  async writeJournal(value: string) { await AsyncStorage.setItem(JOURNAL_KEY, value); }
  async writeCommitted(value: string) { await AsyncStorage.setItem(COMMITTED_KEY, value); }
  async clearJournal() { await AsyncStorage.removeItem(JOURNAL_KEY); }
}

const TASKMEMO_COMMITTED_KEY = "@taskmemo/sync-v2/taskmemo-application/v2";
const TASKMEMO_JOURNAL_KEY = "@taskmemo/sync-v2/taskmemo-application-journal/v2";
const nativeWriters = new Map<string, symbol>();
/** Native single JS-process writer only. A second writer is rejected, never merged. */
export function claimNativeScopeWriter(scope: string) {
  if (nativeWriters.has(scope)) throw new Error('同じNative scopeのwriterが既に存在します。');
  const token = Symbol(scope); nativeWriters.set(scope, token);
  return { token, release: () => { if (nativeWriters.get(scope) === token) nativeWriters.delete(scope); } };
}

/** Separate namespace for the real-Node dev integration; it cannot overwrite the foundation fixture or v1 state. */
export class TaskMemoV2ApplicationJournal implements ApplicationJournalPersistence {
  constructor(private readonly scope = "local", private readonly writerToken?: symbol) {}
  private assertWriter() {
    if (nativeWriters.has(this.scope) && nativeWriters.get(this.scope) !== this.writerToken) throw new Error('Native single writer以外の書込みを拒否しました。');
  }
  private key(base: string) { return `${base}/${encodeURIComponent(this.scope)}`; }
  loadCommitted() { return AsyncStorage.getItem(this.key(TASKMEMO_COMMITTED_KEY)); }
  loadJournal() { return AsyncStorage.getItem(this.key(TASKMEMO_JOURNAL_KEY)); }
  async writeJournal(value: string) { this.assertWriter(); await AsyncStorage.setItem(this.key(TASKMEMO_JOURNAL_KEY), value); }
  async writeCommitted(value: string) { this.assertWriter(); await AsyncStorage.setItem(this.key(TASKMEMO_COMMITTED_KEY), value); }
  async clearJournal() { this.assertWriter(); await AsyncStorage.removeItem(this.key(TASKMEMO_JOURNAL_KEY)); }
  async writeAtomic(expectedCommitted: string | null, value: string) {
    this.assertWriter();
    // Native single-writer storage: replace ONE complete envelope, not multiple keys.
    // Web uses IndexedDB's transactional CAS implementation instead.
    if (await this.loadCommitted() !== expectedCommitted || await this.loadJournal() !== null)
      throw new Error('保存先が更新されました。再読込して確認してください。');
    await this.writeCommitted(value);
  }
}
