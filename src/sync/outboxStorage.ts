import AsyncStorage from "@react-native-async-storage/async-storage";

import type { SyncPersistence } from "./types";

export const SYNC_OUTBOX_STORAGE_KEY = "@taskmemo/sync-outbox/v1";

export class AsyncStorageSyncPersistence implements SyncPersistence {
  load() { return AsyncStorage.getItem(SYNC_OUTBOX_STORAGE_KEY); }
  async save(value: string) { await AsyncStorage.setItem(SYNC_OUTBOX_STORAGE_KEY, value); }
}
