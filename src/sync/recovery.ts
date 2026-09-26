import type { ApplicationJournalPersistence } from "./applicationStore";
import { TaskMemoV2ApplicationStore } from "./taskMemoApplicationStore";
import type { SyncAdapter, SyncOperation } from "./types";
import type { RecoveryObservation } from "./recoveryObservation";

type Options = Parameters<typeof TaskMemoV2ApplicationStore.open>[2];

/** Audit an interrupted WAL before promoting it or starting any remote listener. */
export async function recoverV2ApplicationAfterAudit(
  persistence: ApplicationJournalPersistence,
  adapter: SyncAdapter,
  options: Options,
) {
  await auditPendingJournal(persistence, adapter);
  return TaskMemoV2ApplicationStore.open(persistence, [], options);
}

/** Read-only diagnostic path: deliberately never promotes the journal. */
export async function observePendingJournalReceipts(
  persistence: ApplicationJournalPersistence,
  adapter: SyncAdapter,
  onProgress: (update: Partial<RecoveryObservation>) => void,
) {
  return auditPendingJournal(persistence, adapter, onProgress);
}

async function auditPendingJournal(
  persistence: ApplicationJournalPersistence,
  adapter: SyncAdapter,
  onProgress?: (update: Partial<RecoveryObservation>) => void,
) {
  const pendingJournal = await persistence.loadJournal();
  if (pendingJournal) {
    const envelope = JSON.parse(pendingJournal) as { version?: number; deviceId?: unknown; domain?: unknown; history?: { past?: unknown; future?: unknown }; sync?: { outbox?: SyncOperation[] } };
    if (envelope.version !== 2 || typeof envelope.deviceId !== "string" || !envelope.deviceId ||
        !envelope.domain || typeof envelope.domain !== "object" || Array.isArray(envelope.domain) ||
        !Array.isArray(envelope.history?.past) || !Array.isArray(envelope.history?.future) ||
        !Array.isArray(envelope.sync?.outbox) || !adapter.auditOutbox)
      throw new Error("journalとFirebase受領記録を照合できません。復旧を停止しました。");
    onProgress?.({ recoveryPhase: "firebase-connect-start", receiptComparisonTotal: envelope.sync.outbox.length, firebaseConnectionState: "connecting" });
    try { await adapter.connect(); }
    catch (error) { onProgress?.({ firebaseConnectionState: "error" }); throw error; }
    onProgress?.({ recoveryPhase: "firebase-connect-complete", firebaseConnectionState: "connected" });
    const result = await adapter.auditOutbox(envelope.sync.outbox);
    if (!Number.isInteger(result.received) || !Number.isInteger(result.missing) ||
        result.received < 0 || result.missing < 0 || result.received + result.missing !== envelope.sync.outbox.length)
      throw new Error("Firebase受領照合の件数がjournalと一致しません。復旧を停止しました。");
    onProgress?.({ recoveryPhase: "receipt-comparison-complete", receiptComparisonCompleted: envelope.sync.outbox.length,
      lastCompletedOperationIndex: envelope.sync.outbox.length - 1 });
  }
  return Boolean(pendingJournal);
}
