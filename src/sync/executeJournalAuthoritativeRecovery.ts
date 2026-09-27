import { TaskMemoV2ApplicationJournal } from "./applicationStorage";
import { IndexedDbTaskMemoApplicationJournal } from "./indexedDbApplicationStorage";
import { planJournalAuthoritativeRecovery } from "./journalAuthoritativeRecovery";
import { recoveryFailureDetails } from "./recoveryFailure";
import type { RecoveryExecutionObservation, RecoveryExecutionPhase } from "./recoveryObservation";
import { applyRevisionOperation } from "./revisionModel";
import { prepareRecoveryPreflight } from "./recoveryPreflight";
import type { SyncAdapter, SyncAcknowledgement, SyncOperation, VersionedNode } from "./types";

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export const JOURNAL_AUTHORITATIVE_APPROVAL_KEY = "@taskmemo/journal-authoritative-preflight-approval/v1";
async function digestText(value: string) {
  if (!globalThis.crypto?.subtle) throw new Error("Recovery source hashing is unavailable.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function sourceFingerprint(committed: string, journal: string) {
  return digestText(JSON.stringify([committed, journal]));
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
async function approvalFingerprint(plan: StoredPlan) {
  const ordered = (nodes: VersionedNode[]) => [...nodes].sort((a, b) => a.value.id.localeCompare(b.value.id));
  return digestText(canonical({ sourceFingerprint: plan.sourceFingerprint,
    remoteNodes: ordered(plan.remote.nodes), pinnedNote: plan.remote.pinnedNote ?? null,
    features: plan.remote.features ?? null, finalNodes: ordered(plan.finalNodes),
    originalReceivedIndexes: plan.originalReceivedIndexes, summary: plan.summary }));
}

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
  return { plan, summary: projection.summary, approvalFingerprint: await approvalFingerprint(plan) };
}

/** Not wired to app startup. Activation requires an explicit later release decision. */
export async function executeJournalAuthoritativeRecovery(
  persistence: IndexedDbTaskMemoApplicationJournal, adapter: SyncAdapter, scope: string,
  legacy: TaskMemoV2ApplicationJournal = new TaskMemoV2ApplicationJournal(scope),
  onProgress?: (update: Partial<RecoveryExecutionObservation>) => void,
  expected?: { journalNodeCount: number; remoteNodeCount: number; candidateNodeCount: number;
    originalOutboxCount: number; originalReceiptReceivedCount: number; plannedOperationCount: number;
    approvalFingerprint?: string },
) {
  const started = Date.now();
  let phase: RecoveryExecutionPhase = "final-safety-check";
  let plan: StoredPlan | null = null;
  let currentIndex: number | null = null;
  let attempted = 0, succeeded = 0, failed = 0;
  const emit = (update: Partial<RecoveryExecutionObservation>) => onProgress?.({
    elapsedMs: Math.max(0, Date.now() - started), ...update });
  emit({ startedAt: new Date(started).toISOString(), endedAt: null, status: "running",
    currentPhase: phase, totalOperations: 0, uploadAttemptedCount: 0,
    uploadSucceededCount: 0, uploadFailedCount: 0, uploadSupersededCount: 0,
    lastCompletedOperationIndex: -1, currentOperationIndex: null,
    lastSuccessfulOperationIndex: -1, failedOperationIndex: null, failedOperationType: null,
    failurePhase: null, errorCode: null, errorMessage: null, failureReason: null,
    postExecutionReceiptAuditCompleted: false, postExecutionReceiptAuditError: null,
    postRecoveryRemoteNodeCount: null, postRecoveryCandidateDifferenceCount: null,
    preservedJournal: false, preservedOriginalOutboxCount: null });
  try {
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
    const approved = await preflightJournalAuthoritativeRecovery(persistence, adapter, scope, legacy);
    const { plan } = approved;
    if (expected?.approvalFingerprint && approved.approvalFingerprint !== expected.approvalFingerprint)
      throw new Error("Remote or journal changed since the approved iPhone preflight.");
    if (!sameNodesAndProfile(plan.remote, await readSnapshot()))
      throw new Error("Remote changed after read-only recovery preflight.");
    raw = JSON.stringify(plan);
    await persistence.saveAuthoritativeRecoveryPlan(committedRaw, journalRaw, raw);
  }
  plan = await validateStoredPlan(raw, pending, committedRaw, journalRaw);
  if (expected?.approvalFingerprint && await approvalFingerprint(plan) !== expected.approvalFingerprint)
    throw new Error("Saved recovery plan differs from the approved iPhone preflight.");
  if (expected && (plan.summary.journalNodeCount !== expected.journalNodeCount ||
      plan.summary.remoteNodeCount !== expected.remoteNodeCount ||
      plan.summary.candidateNodeCount !== expected.candidateNodeCount ||
      plan.summary.plannedOperationCount !== expected.plannedOperationCount ||
      pending.sync.outbox.length !== expected.originalOutboxCount ||
      plan.originalReceiptReceivedCount !== expected.originalReceiptReceivedCount))
    throw new Error("Recovery plan no longer matches the approved iPhone preflight counts.");
  emit({ totalOperations: plan.operations.length });
  phase = "pre-execution-receipt-audit";
  emit({ currentPhase: phase, lastCompletedPhase: "final-safety-check" });
  const oldAudit = await auditOutbox(pending.sync.outbox);
  if (oldAudit.received !== plan.originalReceiptReceivedCount ||
      oldAudit.missing !== plan.originalReceiptMissingCount ||
      canonical(oldAudit.receivedOperationIndexes) !== canonical(plan.originalReceivedIndexes))
    throw new Error("Original Outbox receipts changed after recovery plan creation.");
  emit({ preExecutionReceiptReceivedCount: oldAudit.received,
    preExecutionReceiptMissingCount: oldAudit.missing });
  phase = "upload";
  emit({ currentPhase: phase, lastCompletedPhase: "pre-execution-receipt-audit" });
  // The immutable plan is durable before the first write. Existing plan receipts are
  // returned idempotently; a changed target or acknowledgement aborts inside transaction.
  for (const [index, operation] of plan.operations.entries()) {
    currentIndex = index;
    attempted++;
    emit({ currentOperationIndex: index, uploadAttemptedCount: attempted });
    const baseline = plan.remote.nodes.find((record) => record.value.id === operation.targetNodeId) ?? null;
    const actual = await adapter.upload(operation, plan.acknowledgements[index], baseline);
    if (canonical(actual) !== canonical(plan.acknowledgements[index]))
      throw new Error("Recovery acknowledgement differs from the saved plan.");
    succeeded++;
    emit({ uploadSucceededCount: succeeded, lastSuccessfulOperationIndex: index,
      lastCompletedOperationIndex: index, currentOperationIndex: null });
  }
  currentIndex = null;
  phase = "post-execution-receipt-audit";
  emit({ currentPhase: phase, lastCompletedPhase: "upload" });
  const finalSnapshot = await readSnapshot();
  if (!sameNodesAndProfile({ ...plan.remote, nodes: plan.finalNodes }, finalSnapshot))
    throw new Error("Remote Node state differs from the saved recovery plan.");
  emit({ postRecoveryRemoteNodeCount: finalSnapshot.nodes.length,
    postRecoveryCandidateDifferenceCount: 0 });
  const finalAudit = await auditOutbox(plan.operations);
  if (finalAudit.received !== plan.operations.length || finalAudit.missing !== 0)
    throw new Error("Recovery operation receipts are incomplete.");
  emit({ postExecutionReceiptReceivedCount: finalAudit.received,
    postExecutionReceiptMissingCount: finalAudit.missing,
    postExecutionReceiptAuditCompleted: true });
  const finalOriginalAudit = await auditOutbox(pending.sync.outbox);
  if (canonical(finalOriginalAudit.receivedOperationIndexes) !==
      canonical(plan.originalReceivedIndexes) ||
      finalOriginalAudit.missing !== plan.originalReceiptMissingCount)
    throw new Error("Original Outbox receipts changed during recovery execution.");
  if (committedRaw !== await legacy.loadCommitted() || journalRaw !== await legacy.loadJournal())
    throw new Error("Protected local copies changed before finalization.");
  phase = "local-state-finalization";
  emit({ currentPhase: phase, lastCompletedPhase: "post-execution-receipt-audit" });
  const recovered = JSON.stringify({ ...pending,
    nextLocalSeq: pending.nextLocalSeq + plan.operations.length,
    domain: Object.fromEntries(plan.finalNodes.map((record) => [record.value.id, record])),
    sync: { ...pending.sync, outbox: [], seenOpIds: [...new Set([...pending.sync.seenOpIds,
      ...plan.operations.map((operation) => operation.opId)])].slice(-500) },
  });
  await persistence.finalizeAuthoritativeRecovery(committedRaw, journalRaw, raw, recovered);
  const evidence = await persistence.loadPreservedRecoveryEvidence();
  if (evidence.journal !== journalRaw || evidence.committed !== committedRaw || evidence.plan !== raw)
    throw new Error("Protected recovery evidence was not preserved after finalization.");
  phase = "completed";
  emit({ status: "succeeded", endedAt: new Date().toISOString(), currentPhase: phase,
    lastCompletedPhase: phase, currentOperationIndex: null, preservedJournal: true,
    preservedOriginalOutboxCount: pending.sync.outbox.length });
  return { ...plan.summary, receiptReceivedCount: oldAudit.received,
    receiptSkippedOriginalCount: oldAudit.received,
    preservedOriginalOutboxCount: pending.sync.outbox.length,
    recoveryReceiptReceivedCount: finalAudit.received };
  } catch (reason) {
    failed = currentIndex === null ? 0 : 1;
    const details = recoveryFailureDetails(reason);
    emit({ status: "failed", endedAt: new Date().toISOString(), failurePhase: phase,
      uploadAttemptedCount: attempted, uploadSucceededCount: succeeded,
      uploadFailedCount: failed, failedOperationIndex: currentIndex,
      failedOperationType: currentIndex === null ? null : plan?.operations[currentIndex]?.type ?? null,
      currentOperationIndex: currentIndex, ...details });
    if (plan && adapter.auditOutbox) {
      try {
        const finalAudit = await adapter.auditOutbox(plan.operations);
        emit({ postExecutionReceiptReceivedCount: finalAudit.received,
          postExecutionReceiptMissingCount: finalAudit.missing,
          postExecutionReceiptAuditCompleted: true });
      } catch { emit({ postExecutionReceiptAuditCompleted: false,
        postExecutionReceiptAuditError: "receipt-audit-failed" }); }
    }
    throw reason;
  }
}
