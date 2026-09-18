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

/** Separate namespace for the real-Node dev integration; it cannot overwrite the foundation fixture or v1 state. */
export class TaskMemoV2ApplicationJournal implements ApplicationJournalPersistence {
  loadCommitted() { return AsyncStorage.getItem(TASKMEMO_COMMITTED_KEY); }
  loadJournal() { return AsyncStorage.getItem(TASKMEMO_JOURNAL_KEY); }
  async writeJournal(value: string) { await AsyncStorage.setItem(TASKMEMO_JOURNAL_KEY, value); }
  async writeCommitted(value: string) { await AsyncStorage.setItem(TASKMEMO_COMMITTED_KEY, value); }
  async clearJournal() { await AsyncStorage.removeItem(TASKMEMO_JOURNAL_KEY); }
}
