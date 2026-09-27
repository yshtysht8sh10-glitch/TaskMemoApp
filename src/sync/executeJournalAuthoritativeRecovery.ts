import { TaskMemoV2ApplicationJournal } from "./applicationStorage";
import { IndexedDbTaskMemoApplicationJournal } from "./indexedDbApplicationStorage";
import { planJournalAuthoritativeRecovery } from "./journalAuthoritativeRecovery";
import { applyRevisionOperation } from "./revisionModel";
import { prepareRecoveryPreflight } from "./recoveryPreflight";
import type { SyncAdapter, SyncAcknowledgement, SyncOperation, VersionedNode } from "./types";

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
async function sourceFingerprint(committed: string, journal: string) {
  if (!globalThis.crypto?.subtle) throw new Error("Recovery source hashing is unavailable.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(JSON.stringify([committed, journal])));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
type Snapshot = Awaited<ReturnType<NonNullable<SyncAdapter["readRecoverySnapshot"]>>>;
const blocked = (code: string): never => { throw { code }; };
const candidateFailureCode = (reason: unknown): string => {
  const message = reason instanceof Error ? reason.message : "";
  if (message.includes("resurrect") || message.includes("purged remote")) return "deleted-node-conflict";
  if (message.includes("unknown remote Node field")) return "unknown-field-conflict";
  if (message.includes("invalid parent") || message.includes("parent cycle")) return "candidate-parent-invalid";
  if (message.includes("sortKey")) return "candidate-sortkey-invalid";
  if (message.includes("differs from journal") || message.includes("lost a journal"))
    return "candidate-user-data-mismatch";
  return "candidate-validation-failed";
};
type Pending = { deviceId: string; nextLocalSeq: number; domain: Record<string, VersionedNode>;
  sync: { outbox: SyncOperation[]; seenOpIds: string[] };
  profile: { pinnedNote: { synced: unknown }; features: { synced: unknown } } };
type StoredPlan = { version: 1; sourceFingerprint: string;
  remote: Snapshot; operations: SyncOperation[]; acknowledgements: SyncAcknowledgement[];
  finalNodes: VersionedNode[]; originalReceiptReceivedCount: number;
  originalReceiptMissingCount: number; originalReceivedIndexes: number[]; createdAt: string;
  summary: ReturnType<typeof planJournalAuthoritativeRecovery>["summary"] };

function sameNodesAndProfile(a: Snapshot, b: Snapshot) {
  const nodes = (snapshot: Snapshot) => [...snapshot.nodes].sort((x, y) => x.value.id.localeCompare(y.value.id));
  return canonical(nodes(a)) === canonical(nodes(b)) &&
    canonical(a.pinnedNote ?? null) === canonical(b.pinnedNote ?? null) &&
    canonical(a.features ?? null) === canonical(b.features ?? null);
}

function expectedAcknowledgements(remote: Snapshot, operations: SyncOperation[]) {
  const nodes = new Map(remote.nodes.map((record) => [record.value.id, record]));
  return operations.map((operation) => {
    const acknowledgement = applyRevisionOperation(nodes.get(operation.targetNodeId), operation);
    if (acknowledgement.result !== "applied" || !acknowledgement.record)
      throw new Error("Recovery operation did not win against its saved remote snapshot.");
    nodes.set(operation.targetNodeId, acknowledgement.record);
    return acknowledgement;
  });
}

async function validateStoredPlan(raw: string, pending: Pending, committedRaw: string,
  journalRaw: string): Promise<StoredPlan> {
  const saved = JSON.parse(raw) as StoredPlan;
  if (saved.version !== 1 || saved.sourceFingerprint !== await sourceFingerprint(committedRaw, journalRaw) ||
      !Array.isArray(saved.operations) || !Array.isArray(saved.finalNodes) ||
      !Array.isArray(saved.remote?.nodes) || !Array.isArray(saved.acknowledgements) ||
      !Array.isArray(saved.originalReceivedIndexes))
    throw new Error("Saved recovery plan no longer matches the protected journal.");
  const recreated = planJournalAuthoritativeRecovery(saved.remote.nodes, Object.values(pending.domain), {
    deviceId: pending.deviceId, nextLocalSeq: pending.nextLocalSeq,
    existingOperationIds: new Set([...pending.sync.outbox.map((op) => op.opId), ...pending.sync.seenOpIds]),
    createdAt: saved.createdAt,
  });
  const acknowledgements = expectedAcknowledgements(saved.remote, recreated.operations);
  if (canonical(saved.operations) !== canonical(recreated.operations) ||
      canonical(saved.finalNodes) !== canonical([...recreated.final.values()]) ||
      canonical(saved.acknowledgements) !== canonical(acknowledgements) ||
      canonical(saved.summary) !== canonical(recreated.summary) ||
      saved.originalReceiptReceivedCount + saved.originalReceiptMissingCount !== pending.sync.outbox.length)
    throw new Error("Saved recovery plan failed independent reconstruction.");
  if (saved.originalReceivedIndexes.length !== saved.originalReceiptReceivedCount ||
      saved.originalReceivedIndexes.some((index, position) => !Number.isSafeInteger(index) || index < 0 ||
        index >= pending.sync.outbox.length ||
        (position > 0 && index <= saved.originalReceivedIndexes[position - 1])))
    throw new Error("Saved original receipt identities are invalid.");
  return saved;
}

/** Read-only candidate projection; it never stores a plan, starts a listener, or uploads. */
export async function preflightJournalAuthoritativeRecovery(
  persistence: IndexedDbTaskMemoApplicationJournal, adapter: SyncAdapter, scope: string,
  legacy: TaskMemoV2ApplicationJournal = new TaskMemoV2ApplicationJournal(scope),
) {
  const auditOutbox = adapter.auditOutbox?.bind(adapter);
  if (!auditOutbox || !adapter.readRecoverySnapshot) return blocked("source-unavailable");
  const committedRaw = await persistence.loadCommitted();
  const journalRaw = await persistence.loadJournal();
  if (!committedRaw || !journalRaw) return blocked("source-unavailable");
  const pending = JSON.parse(journalRaw) as Pending;
  const firstAudit = await auditOutbox(pending.sync.outbox);
  const receivedIndexes = firstAudit.receivedOperationIndexes;
  if (!receivedIndexes || receivedIndexes.length !== firstAudit.received)
    return blocked("receipt-identity-unavailable");
  const { report, remote } = await prepareRecoveryPreflight(persistence, adapter, scope, firstAudit, legacy);
  if (!report.localCopyMatches || report.applicationNodeNotInJournalCount ||
      report.applicationOutboxNotInJournalCount) blocked("local-copy-mismatch");
  if (!report.remoteSnapshotStable) blocked("remote-snapshot-unstable");
  if (firstAudit.received + firstAudit.missing !== pending.sync.outbox.length)
    blocked("receipt-audit-incomplete");
  if (report.operationUnrecognizedTypeCount ||
      pending.sync.outbox.some((operation) => (operation.targetType ?? "node") !== "node" ||
        !pending.domain[operation.targetNodeId])) blocked("outbox-target-invalid");
  if (report.finalPreflight.blockReasons.localProfileUnsynced) blocked("profile-mismatch");
  if (canonical(remote.pinnedNote ?? null) !== canonical(pending.profile.pinnedNote.synced ?? null) ||
      canonical(remote.features ?? null) !== canonical(pending.profile.features.synced ?? null))
    blocked("profile-mismatch");
  const createdAt = new Date().toISOString();
  const projection = (() => {
    try { return planJournalAuthoritativeRecovery(remote.nodes, Object.values(pending.domain), {
      deviceId: pending.deviceId, nextLocalSeq: pending.nextLocalSeq,
      existingOperationIds: new Set([...pending.sync.outbox.map((op) => op.opId), ...pending.sync.seenOpIds]),
      createdAt,
    }); } catch (reason) { return blocked(candidateFailureCode(reason)); }
  })();
  const acknowledgements = expectedAcknowledgements(remote, projection.operations);
  const newAudit = await auditOutbox(projection.operations);
  if (newAudit.received !== 0 || newAudit.missing !== projection.operations.length)
    blocked("fresh-operation-receipt-exists");
  const plan: StoredPlan = { version: 1, sourceFingerprint: await sourceFingerprint(committedRaw, journalRaw),
    remote, operations: projection.operations, acknowledgements,
    finalNodes: [...projection.final.values()], originalReceiptReceivedCount: firstAudit.received,
    originalReceiptMissingCount: firstAudit.missing,
    originalReceivedIndexes: receivedIndexes, createdAt, summary: projection.summary };
  return { plan, summary: projection.summary };
}

/** Not wired to app startup. Activation requires an explicit later release decision. */
export async function executeJournalAuthoritativeRecovery(
  persistence: IndexedDbTaskMemoApplicationJournal, adapter: SyncAdapter, scope: string,
  legacy: TaskMemoV2ApplicationJournal = new TaskMemoV2ApplicationJournal(scope),
) {
  const readSnapshot = adapter.readRecoverySnapshot?.bind(adapter);
  const auditOutbox = adapter.auditOutbox?.bind(adapter);
  if (!readSnapshot || !auditOutbox) throw new Error("Recovery execution adapter is unavailable.");
  await adapter.connect();
  const committedRaw = await persistence.loadCommitted();
  const journalRaw = await persistence.loadJournal();
  if (!committedRaw || !journalRaw || committedRaw !== await legacy.loadCommitted() ||
      journalRaw !== await legacy.loadJournal()) throw new Error("Protected local copies do not match.");
  const pending = JSON.parse(journalRaw) as Pending;
  let raw = await persistence.loadAuthoritativeRecoveryPlan();
  if (!raw) {
    const { plan } = await preflightJournalAuthoritativeRecovery(persistence, adapter, scope, legacy);
    if (!sameNodesAndProfile(plan.remote, await readSnapshot()))
      throw new Error("Remote changed after read-only recovery preflight.");
    raw = JSON.stringify(plan);
    await persistence.saveAuthoritativeRecoveryPlan(committedRaw, journalRaw, raw);
  }
  const plan = await validateStoredPlan(raw, pending, committedRaw, journalRaw);
  const oldAudit = await auditOutbox(pending.sync.outbox);
  if (oldAudit.received !== plan.originalReceiptReceivedCount ||
      oldAudit.missing !== plan.originalReceiptMissingCount ||
      canonical(oldAudit.receivedOperationIndexes) !== canonical(plan.originalReceivedIndexes))
    throw new Error("Original Outbox receipts changed after recovery plan creation.");
  // The immutable plan is durable before the first write. Existing plan receipts are
  // returned idempotently; a changed target or acknowledgement aborts inside transaction.
  for (const [index, operation] of plan.operations.entries()) {
    const baseline = plan.remote.nodes.find((record) => record.value.id === operation.targetNodeId) ?? null;
    const actual = await adapter.upload(operation, plan.acknowledgements[index], baseline);
    if (canonical(actual) !== canonical(plan.acknowledgements[index]))
      throw new Error("Recovery acknowledgement differs from the saved plan.");
  }
  const finalSnapshot = await readSnapshot();
  if (!sameNodesAndProfile({ ...plan.remote, nodes: plan.finalNodes }, finalSnapshot))
    throw new Error("Remote Node state differs from the saved recovery plan.");
  const finalAudit = await auditOutbox(plan.operations);
  if (finalAudit.received !== plan.operations.length || finalAudit.missing !== 0)
    throw new Error("Recovery operation receipts are incomplete.");
  const finalOriginalAudit = await auditOutbox(pending.sync.outbox);
  if (canonical(finalOriginalAudit.receivedOperationIndexes) !==
      canonical(plan.originalReceivedIndexes) ||
      finalOriginalAudit.missing !== plan.originalReceiptMissingCount)
    throw new Error("Original Outbox receipts changed during recovery execution.");
  if (committedRaw !== await legacy.loadCommitted() || journalRaw !== await legacy.loadJournal())
    throw new Error("Protected local copies changed before finalization.");
  const recovered = JSON.stringify({ ...pending,
    nextLocalSeq: pending.nextLocalSeq + plan.operations.length,
    domain: Object.fromEntries(plan.finalNodes.map((record) => [record.value.id, record])),
    sync: { ...pending.sync, outbox: [], seenOpIds: [...new Set([...pending.sync.seenOpIds,
      ...plan.operations.map((operation) => operation.opId)])].slice(-500) },
  });
  await persistence.finalizeAuthoritativeRecovery(committedRaw, journalRaw, raw, recovered);
  return { ...plan.summary, receiptReceivedCount: oldAudit.received,
    receiptSkippedOriginalCount: oldAudit.received, originalOutboxClearedCount: pending.sync.outbox.length };
}
