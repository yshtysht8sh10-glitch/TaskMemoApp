import { TaskMemoV2ApplicationJournal } from "./applicationStorage";
import { IndexedDbTaskMemoApplicationJournal } from "./indexedDbApplicationStorage";
import { prepareRecoveryPreflight } from "./recoveryPreflight";
import { applyFeaturesOperation, applyPinnedNoteOperation, applyRevisionOperation } from "./revisionModel";
import type { SyncAdapter, SyncAcknowledgement, SyncOperation, VersionedFeatures, VersionedNode, VersionedPinnedNote } from "./types";

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

type Snapshot = Awaited<ReturnType<NonNullable<SyncAdapter["readRecoverySnapshot"]>>>;
type Pending = { sync: { outbox: SyncOperation[] }; domain: Record<string, VersionedNode>;
  profile?: { pinnedNote?: { synced: VersionedPinnedNote | null }; features?: { synced: VersionedFeatures | null } } };

function sameSnapshot(left: Snapshot, right: Snapshot) {
  const nodes = (snapshot: Snapshot) => [...snapshot.nodes].sort((a, b) => a.value.id.localeCompare(b.value.id));
  return canonical(nodes(left)) === canonical(nodes(right)) &&
    canonical(left.pinnedNote ?? null) === canonical(right.pinnedNote ?? null) &&
    canonical(left.features ?? null) === canonical(right.features ?? null);
}

function expectedExecution(operations: SyncOperation[], remote: Snapshot) {
  const nodes = new Map(remote.nodes.map((record) => [record.value.id, record]));
  let pinned = remote.pinnedNote, features = remote.features;
  const acknowledgements: SyncAcknowledgement[] = [];
  for (const operation of operations) {
    const target = operation.targetType ?? "node";
    const acknowledgement = target === "pinnedNote"
      ? applyPinnedNoteOperation(pinned, operation)
      : target === "features"
        ? applyFeaturesOperation(features, operation)
        : applyRevisionOperation(nodes.get(operation.targetNodeId), operation);
    if (acknowledgement.record) nodes.set(operation.targetNodeId, acknowledgement.record);
    if (acknowledgement.pinnedNoteRecord) pinned = acknowledgement.pinnedNoteRecord;
    if (acknowledgement.featuresRecord) features = acknowledgement.featuresRecord;
    acknowledgements.push(acknowledgement);
  }
  return { acknowledgements, final: { nodes: [...nodes.values()], pinnedNote: pinned, features,
    receiptDocumentCount: remote.receiptDocumentCount + operations.length } };
}

function stop(code: string): never {
  throw { code, message: `復旧の安全条件が変化したため停止しました（${code}）。journalを保持しています。` };
}

/** Explicit execution only after a fresh, fully safe preflight. A failed/partial upload never promotes the WAL. */
export async function executeJournalRecovery(
  persistence: IndexedDbTaskMemoApplicationJournal, adapter: SyncAdapter, scope: string,
  initialAudit: { received: number; missing: number }, isCurrent: () => boolean = () => true,
  legacy: TaskMemoV2ApplicationJournal = new TaskMemoV2ApplicationJournal(scope),
) {
  const readSnapshot = adapter.readRecoverySnapshot?.bind(adapter);
  const auditOutbox = adapter.auditOutbox?.bind(adapter);
  if (!readSnapshot || !auditOutbox) stop("recovery-adapter-unavailable");
  if (!isCurrent()) stop("recovery-cancelled");
  const { report, committedRaw, journalRaw, remote } = await prepareRecoveryPreflight(
    persistence, adapter, scope, initialAudit, legacy);
  if (report.finalPreflight.finalRecoverySafetyDecision !== "safe" ||
      !report.finalPreflight.authorizesRecovery) stop("recovery-preflight-blocked");
  if (!isCurrent()) stop("recovery-cancelled");
  const pending = JSON.parse(journalRaw) as Pending;
  const plan = expectedExecution(pending.sync.outbox, remote);
  if (canonical(plan.final.nodes.sort((a, b) => a.value.id.localeCompare(b.value.id))) !==
      canonical(Object.values(pending.domain).sort((a, b) => a.value.id.localeCompare(b.value.id))) ||
      canonical(plan.final.pinnedNote ?? null) !== canonical(pending.profile?.pinnedNote?.synced ?? null) ||
      canonical(plan.final.features ?? null) !== canonical(pending.profile?.features?.synced ?? null))
    stop("recovery-candidate-mismatch");
  if (!sameSnapshot(remote, await readSnapshot())) stop("recovery-remote-changed");
  const freshReceipts = await auditOutbox(pending.sync.outbox);
  if (freshReceipts.received !== 0 || freshReceipts.missing !== pending.sync.outbox.length)
    stop("recovery-receipt-changed");
  if ((await persistence.loadCommitted()) !== committedRaw || (await persistence.loadJournal()) !== journalRaw ||
      (await legacy.loadCommitted()) !== committedRaw || (await legacy.loadJournal()) !== journalRaw)
    stop("recovery-local-changed");
  // The adapter transaction re-reads this operation's receipt and target, then applies the
  // same revisionModel winner rule. Every acknowledgement must equal the preflight plan.
  for (let index = 0; index < pending.sync.outbox.length; index++) {
    if (!isCurrent()) stop("recovery-cancelled");
    const actual = await adapter.upload(pending.sync.outbox[index], plan.acknowledgements[index]);
    if (canonical(actual) !== canonical(plan.acknowledgements[index])) stop("recovery-ack-mismatch");
  }
  if (!isCurrent()) stop("recovery-cancelled");
  const after = await readSnapshot();
  if (!sameSnapshot(plan.final, after)) stop("recovery-final-remote-mismatch");
  const finalAudit = await auditOutbox(pending.sync.outbox);
  if (finalAudit.received !== pending.sync.outbox.length || finalAudit.missing !== 0)
    stop("recovery-final-receipt-mismatch");
  if (!isCurrent()) stop("recovery-cancelled");
  if ((await legacy.loadCommitted()) !== committedRaw || (await legacy.loadJournal()) !== journalRaw)
    stop("recovery-legacy-changed");
  const recovered = JSON.stringify({ ...pending, sync: { ...pending.sync, outbox: [] } });
  await persistence.finalizeRecovery(committedRaw, journalRaw, recovered);
  return { uploaded: pending.sync.outbox.length, applied: report.finalPreflight.replay.applied,
    superseded: report.finalPreflight.replay.superseded };
}
