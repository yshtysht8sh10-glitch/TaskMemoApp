import { TaskMemoV2ApplicationJournal } from "./applicationStorage";
import { IndexedDbTaskMemoApplicationJournal } from "./indexedDbApplicationStorage";
import { prepareRecoveryPreflight } from "./recoveryPreflight";
import { recoveryFailureDetails } from "./recoveryFailure";
import { applyFeaturesOperation, applyPinnedNoteOperation, applyRevisionOperation } from "./revisionModel";
import { planRecoverySortKeyOperations } from "./recoverySortKeyRepair";
import type { RecoveryExecutionObservation, RecoveryExecutionPhase } from "./recoveryObservation";
import type { SyncAdapter, SyncAcknowledgement, SyncOperation, VersionedFeatures, VersionedNode, VersionedPinnedNote } from "./types";

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

type Snapshot = Awaited<ReturnType<NonNullable<SyncAdapter["readRecoverySnapshot"]>>>;
type Pending = { deviceId: string; nextLocalSeq: number;
  sync: { outbox: SyncOperation[]; seenOpIds?: string[] }; domain: Record<string, VersionedNode>;
  profile?: { pinnedNote?: { synced: VersionedPinnedNote | null }; features?: { synced: VersionedFeatures | null } } };

function sameSnapshot(left: Snapshot, right: Snapshot) {
  const nodes = (snapshot: Snapshot) => [...snapshot.nodes].sort((a, b) => a.value.id.localeCompare(b.value.id));
  return canonical(nodes(left)) === canonical(nodes(right)) &&
    canonical(left.pinnedNote ?? null) === canonical(right.pinnedNote ?? null) &&
    canonical(left.features ?? null) === canonical(right.features ?? null);
}

function sameExceptSortKey(left: VersionedNode, right: VersionedNode) {
  return canonical({ ...left, value: { ...left.value, sortKey: null } }) ===
    canonical({ ...right, value: { ...right.value, sortKey: null } });
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
  onProgress?: (update: Partial<RecoveryExecutionObservation>) => void,
) {
  const startedAtMs = Date.now();
  const phaseState: { current: RecoveryExecutionPhase } = { current: "final-safety-check" };
  let lastCompletedPhase: RecoveryExecutionPhase | null = null;
  let operations: SyncOperation[] | null = null;
  let attempted = 0, succeeded = 0, failed = 0, superseded = 0;
  let currentIndex: number | null = null, lastSuccessfulIndex = -1;
  const progress = (update: Partial<RecoveryExecutionObservation>) => {
    try { onProgress?.({ elapsedMs: Math.max(0, Date.now() - startedAtMs), ...update }); }
    catch { /* Observation must never affect recovery. */ }
  };
  const enter = (next: RecoveryExecutionPhase) => {
    lastCompletedPhase = phaseState.current;
    phaseState.current = next;
    progress({ currentPhase: phaseState.current, lastCompletedPhase });
  };
  progress({ startedAt: new Date(startedAtMs).toISOString(), status: "running", currentPhase: phaseState.current });
  const readSnapshot = adapter.readRecoverySnapshot?.bind(adapter);
  const auditOutbox = adapter.auditOutbox?.bind(adapter);
  try {
    if (!readSnapshot || !auditOutbox) stop("recovery-adapter-unavailable");
    if (!isCurrent()) stop("recovery-cancelled");
    const { report, committedRaw, journalRaw, remote } = await prepareRecoveryPreflight(
      persistence, adapter, scope, initialAudit, legacy);
    if (report.finalPreflight.finalRecoverySafetyDecision !== "safe" ||
        !report.finalPreflight.authorizesRecovery) stop("recovery-preflight-blocked");
    if (!isCurrent()) stop("recovery-cancelled");
    const pending = JSON.parse(journalRaw) as Pending;
    const outbox = pending.sync.outbox;
    const originalPlan = expectedExecution(outbox, remote);
    const originalNodes = new Map(originalPlan.final.nodes.map((record) => [record.value.id, record]));
    if (originalNodes.size !== Object.keys(pending.domain).length ||
        [...originalNodes].some(([id, record]) => !pending.domain[id] ||
          !sameExceptSortKey(record, pending.domain[id])) ||
        canonical(originalPlan.final.pinnedNote ?? null) !== canonical(pending.profile?.pinnedNote?.synced ?? null) ||
        canonical(originalPlan.final.features ?? null) !== canonical(pending.profile?.features?.synced ?? null))
      stop("recovery-candidate-mismatch");
    const repair = planRecoverySortKeyOperations(originalNodes, pending.deviceId,
      pending.nextLocalSeq, outbox.at(-1)?.createdAt ?? "",
      new Set([...outbox.map((operation) => operation.opId), ...(pending.sync.seenOpIds ?? [])]));
    if (repair.operations.length !== report.finalPreflight.sortKeyRepairPreview.plannedOperationCount ||
        !report.finalPreflight.sortKeyRepairPreview.planValid) stop("recovery-sortkey-plan-changed");
    operations = [...outbox, ...repair.operations];
    progress({ totalOperations: operations.length });
    const plan = expectedExecution(operations, remote);
    if (canonical(plan.final.nodes.sort((a, b) => a.value.id.localeCompare(b.value.id))) !==
        canonical([...repair.final.values()].sort((a, b) => a.value.id.localeCompare(b.value.id))))
      stop("recovery-sortkey-plan-changed");
    if (!sameSnapshot(remote, await readSnapshot())) stop("recovery-remote-changed");
    enter("pre-execution-receipt-audit");
    const freshReceipts = await auditOutbox(operations);
    progress({ preExecutionReceiptReceivedCount: freshReceipts.received,
      preExecutionReceiptMissingCount: freshReceipts.missing });
    if (freshReceipts.received !== 0 || freshReceipts.missing !== operations.length)
      stop("recovery-receipt-changed");
    if ((await persistence.loadCommitted()) !== committedRaw || (await persistence.loadJournal()) !== journalRaw ||
        (await legacy.loadCommitted()) !== committedRaw || (await legacy.loadJournal()) !== journalRaw)
      stop("recovery-local-changed");
    enter("upload");
    // The adapter transaction re-reads this operation's receipt and target, then applies the
    // same revisionModel winner rule. Every acknowledgement must equal the preflight plan.
    for (let index = 0; index < operations.length; index++) {
      if (!isCurrent()) stop("recovery-cancelled");
      currentIndex = index;
      attempted++;
      progress({ currentOperationIndex: index, uploadAttemptedCount: attempted });
      const actual = await adapter.upload(operations[index], plan.acknowledgements[index]);
      if (canonical(actual) !== canonical(plan.acknowledgements[index])) stop("recovery-ack-mismatch");
      succeeded++;
      if (actual.result === "superseded") superseded++;
      lastSuccessfulIndex = index;
      currentIndex = null;
      progress({ uploadSucceededCount: succeeded, uploadSupersededCount: superseded,
        lastCompletedOperationIndex: index, lastSuccessfulOperationIndex: index,
        currentOperationIndex: null });
    }
    if (!isCurrent()) stop("recovery-cancelled");
    const after = await readSnapshot();
    if (!sameSnapshot(plan.final, after)) stop("recovery-final-remote-mismatch");
    enter("post-execution-receipt-audit");
    const finalAudit = await auditOutbox(operations);
    progress({ postExecutionReceiptReceivedCount: finalAudit.received,
      postExecutionReceiptMissingCount: finalAudit.missing, postExecutionReceiptAuditCompleted: true });
    if (finalAudit.received !== operations.length || finalAudit.missing !== 0)
      stop("recovery-final-receipt-mismatch");
    if (!isCurrent()) stop("recovery-cancelled");
    enter("local-state-finalization");
    if ((await legacy.loadCommitted()) !== committedRaw || (await legacy.loadJournal()) !== journalRaw)
      stop("recovery-legacy-changed");
    const recovered = JSON.stringify({ ...pending, nextLocalSeq: pending.nextLocalSeq + repair.operations.length,
      domain: Object.fromEntries(plan.final.nodes.map((record) => [record.value.id, record])),
      sync: { ...pending.sync, outbox: [] } });
    await persistence.finalizeRecovery(committedRaw, journalRaw, recovered, repair.operations, originalNodes);
    enter("completed");
    progress({ status: "succeeded", endedAt: new Date().toISOString() });
    return { uploaded: operations.length, applied: report.finalPreflight.replay.applied + repair.operations.length,
      superseded: report.finalPreflight.replay.superseded };
  } catch (reason) {
    const failurePhase = phaseState.current;
    if (failurePhase === "upload" && currentIndex !== null) failed++;
    const details = recoveryFailureDetails(reason);
    progress({ status: "failed", failurePhase, failedOperationIndex: currentIndex,
      failedOperationType: currentIndex !== null ? operations?.[currentIndex]?.type ?? null : null,
      uploadAttemptedCount: attempted, uploadSucceededCount: succeeded, uploadFailedCount: failed,
      uploadSupersededCount: superseded, currentOperationIndex: currentIndex,
      lastSuccessfulOperationIndex: lastSuccessfulIndex, ...details });
    // Diagnostic-only server read. Never reclassify a missing receipt as safe or replace the original failure.
    if (operations && auditOutbox && (attempted > 0 || failurePhase === "post-execution-receipt-audit" ||
        failurePhase === "local-state-finalization")) {
      try {
        const result = await auditOutbox(operations);
        const complete = Number.isSafeInteger(result.received) && Number.isSafeInteger(result.missing) &&
          result.received >= 0 && result.missing >= 0 && result.received + result.missing === operations.length;
        progress({ postExecutionReceiptReceivedCount: complete ? result.received : null,
          postExecutionReceiptMissingCount: complete ? result.missing : null,
          postExecutionReceiptAuditCompleted: complete,
          postExecutionReceiptAuditError: complete ? null : "receipt-count-mismatch" });
      } catch (auditError) {
        progress({ postExecutionReceiptAuditCompleted: false,
          postExecutionReceiptAuditError: recoveryFailureDetails(auditError).errorCode });
      }
    }
    progress({ status: "failed", currentPhase: failurePhase, endedAt: new Date().toISOString() });
    throw reason;
  }
}
