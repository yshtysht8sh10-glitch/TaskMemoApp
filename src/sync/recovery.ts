import type { ApplicationJournalPersistence } from "./applicationStore";
import { TaskMemoV2ApplicationStore } from "./taskMemoApplicationStore";
import type { SyncAdapter, SyncOperation } from "./types";

type Options = Parameters<typeof TaskMemoV2ApplicationStore.open>[2];

/** Audit an interrupted WAL before promoting it or starting any remote listener. */
export async function recoverV2ApplicationAfterAudit(
  persistence: ApplicationJournalPersistence,
  adapter: SyncAdapter,
  options: Options,
) {
  const pendingJournal = await persistence.loadJournal();
  if (pendingJournal) {
    const envelope = JSON.parse(pendingJournal) as { version?: number; sync?: { outbox?: SyncOperation[] } };
    if (envelope.version !== 2 || !Array.isArray(envelope.sync?.outbox) || !adapter.auditOutbox)
      throw new Error("journalとFirebase受領記録を照合できません。復旧を停止しました。");
    await adapter.connect();
    const result = await adapter.auditOutbox(envelope.sync.outbox);
    if (!Number.isInteger(result.received) || !Number.isInteger(result.missing) ||
        result.received < 0 || result.missing < 0 || result.received + result.missing !== envelope.sync.outbox.length)
      throw new Error("Firebase受領照合の件数がjournalと一致しません。復旧を停止しました。");
  }
  return TaskMemoV2ApplicationStore.open(persistence, [], options);
}
