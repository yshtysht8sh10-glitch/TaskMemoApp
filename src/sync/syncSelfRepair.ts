import { planRecoverySortKeyRepair } from "./recoverySortKeyRepair";
import { isValidSortKey } from "../domain/sortKeys";
import type { SyncAdapter, SyncOperation, VersionedFeatures, VersionedNode, VersionedPinnedNote } from "./types";
import type { IndexedDbTaskMemoApplicationJournal } from "./indexedDbApplicationStorage";

export const canonicalSyncValue = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

const knownFields = new Set(["id", "sortKey", "type", "parentId", "title", "body", "memoType",
  "deadlineSortKey", "dueAt", "duePreset", "status", "completedAt", "routineHistory", "repeatRule",
  "categoryKind", "routineWeekday", "routineDayOfMonth", "routineMonth", "deletedAt",
  "deletionBatchId", "purgedAt", "createdAt", "updatedAt"]);

export function planSyncSelfRepair(localRecords: VersionedNode[], remoteRecords: VersionedNode[]) {
  const local = new Map(localRecords.map((record) => [record.value.id, record]));
  const remote = new Map(remoteRecords.map((record) => [record.value.id, record]));
  if (local.size !== localRecords.length || remote.size !== remoteRecords.length)
    throw new Error("Node IDが重複しています。自己修復を停止しました。");
  const candidate = new Map<string, VersionedNode>();
  let remoteOnlyCount = 0;
  for (const [id, server] of remote) {
    const localRecord = local.get(id);
    if (localRecord) {
      if (server.value.purgedAt && canonicalSyncValue(server.value) !== canonicalSyncValue(localRecord.value))
        throw new Error("Firebase上の完全削除済みNodeとローカルが競合しています。");
      for (const field of Object.keys(server.value)) if (!knownFields.has(field) &&
          canonicalSyncValue(server.value[field]) !== canonicalSyncValue(localRecord.value[field]))
        throw new Error("未知のFirebaseユーザーデータを上書きできません。");
      candidate.set(id, { ...server, value: localRecord.value });
    } else {
      remoteOnlyCount++;
      if (server.value.deletedAt || server.value.purgedAt) { candidate.set(id, server); continue; }
      if (typeof server.value.title !== "string") throw new Error("remote-only Nodeのタイトルが不正です。");
      candidate.set(id, { ...server, value: { ...server.value,
        title: server.value.title.startsWith("⭐⭐⭐") ? server.value.title : `⭐⭐⭐${server.value.title}` } });
    }
  }
  for (const [id, record] of local) if (!candidate.has(id)) candidate.set(id, record);
  const desired = planRecoverySortKeyRepair(candidate).repaired;
  for (const [id, record] of desired) {
    if (record.value.deletedAt || record.value.purgedAt) continue;
    if (!isValidSortKey(record.value.sortKey as string))
      throw new Error("自己修復後のsortKeyが不正です。");
    const parent = record.value.parentId;
    if (parent !== null && (typeof parent !== "string" ||
        desired.get(parent)?.value.type !== "category" ||
        desired.get(parent)?.value.deletedAt || desired.get(parent)?.value.purgedAt))
      throw new Error("自己修復後の親Categoryが不正です。");
    const seen = new Set([id]);
    let cursor: unknown = parent;
    while (typeof cursor === "string") {
      if (seen.has(cursor)) throw new Error("自己修復後の親子関係に循環があります。");
      seen.add(cursor); cursor = desired.get(cursor)?.value.parentId;
    }
  }
  const changedIds = [...desired.keys()].filter((id) =>
    canonicalSyncValue(desired.get(id)!.value) !== canonicalSyncValue(remote.get(id)?.value)).sort();
  return { desired, changedIds, localCount: local.size, remoteOnlyCount };
}

type LocalEnvelope = {
  version: 2;
  deviceId: string;
  nextLocalSeq: number;
  domain: Record<string, VersionedNode>;
  sync: { outbox: SyncOperation[]; seenOpIds: string[] };
  profile: {
    pinnedNote: { localBody: string; synced: VersionedPinnedNote | null; dirtySince: string | null; migrationPending: boolean };
    features: { localIdeasEnabled: boolean; synced: VersionedFeatures | null; migrationPending: boolean };
  };
};

export type SyncSelfRepairProgress = { phase: "reading" | "writing" | "verifying" | "finalizing";
  completed: number; total: number };

/** No saved operation list is replayed. Every invocation starts from current local + server state. */
export async function runSyncSelfRepair(persistence: IndexedDbTaskMemoApplicationJournal, adapter: SyncAdapter,
  onProgress: (progress: SyncSelfRepairProgress) => void = () => undefined,
  assertActive: () => void = () => undefined) {
  assertActive();
  if (!await persistence.isLocalRecoveryMode()) throw new Error("ローカル復旧モードではありません。");
  const sourceRaw = await persistence.loadCommitted();
  if (!sourceRaw || await persistence.loadJournal()) throw new Error("ローカル保存が確定していません。");
  const source = JSON.parse(sourceRaw) as LocalEnvelope;
  if (source.version !== 2 || typeof source.deviceId !== "string" || !source.deviceId ||
      !Number.isSafeInteger(source.nextLocalSeq) || !source.domain ||
      !Array.isArray(source.sync?.outbox) || !Array.isArray(source.sync?.seenOpIds) ||
      typeof source.profile?.pinnedNote?.localBody !== "string" ||
      typeof source.profile?.features?.localIdeasEnabled !== "boolean" ||
      Object.entries(source.domain).some(([id, record]) => record?.value?.id !== id))
    throw new Error("ローカルApplicationを検証できません。データは変更していません。");
  const evidence = await persistence.loadLocalRecoveryEvidence();
  if (!evidence.journal || !evidence.committed || !evidence.recoveredAt ||
      !Number.isSafeInteger(evidence.archivedOutboxCount) || evidence.archivedOutboxCount! < 0)
    throw new Error("元Journalと旧Outboxの退避証拠がありません。");
  if (!adapter.readRecoverySnapshot || !adapter.convergeRecoveryTarget || !adapter.auditOutbox)
    throw new Error("Firebase自己修復の機能が利用できません。");
  onProgress({ phase: "reading", completed: 0, total: 0 });
  await adapter.connect();
  const initial = await adapter.readRecoverySnapshot();
  const plan = planSyncSelfRepair(Object.values(source.domain), initial.nodes);
  const targets: ({ kind: "node"; id: string } | { kind: "pinnedNote" } | { kind: "features" })[] =
    plan.changedIds.map((id) => ({ kind: "node", id }));
  const pinnedDesired = { body: source.profile.pinnedNote.localBody };
  const featuresDesired = { ideasEnabled: source.profile.features.localIdeasEnabled };
  if (canonicalSyncValue(initial.pinnedNote?.value ?? { body: "" }) !== canonicalSyncValue(pinnedDesired))
    targets.push({ kind: "pinnedNote" });
  if (canonicalSyncValue(initial.features?.value ?? { ideasEnabled: false }) !== canonicalSyncValue(featuresDesired))
    targets.push({ kind: "features" });
  const repairDeviceId = `sync-self-repair-${globalThis.crypto.randomUUID()}`;
  const operations: SyncOperation[] = [];
  let completed = 0;
  for (const target of targets) {
    assertActive();
    onProgress({ phase: "writing", completed, total: targets.length });
    const identity = { deviceId: repairDeviceId, localSeq: completed + 1,
      createdAt: new Date().toISOString() };
    const result = target.kind === "pinnedNote"
      ? await adapter.convergeRecoveryTarget({ targetType: "pinnedNote", desired: pinnedDesired,
          observed: initial.pinnedNote ?? null, identity })
      : target.kind === "features"
        ? await adapter.convergeRecoveryTarget({ targetType: "features", desired: featuresDesired,
            observed: initial.features ?? null, identity })
        : await adapter.convergeRecoveryTarget({ targetType: "node", targetNodeId: target.id,
            desired: plan.desired.get(target.id)!.value,
            observed: initial.nodes.find((record) => record.value.id === target.id) ?? null, identity });
    if (result.operation) {
      if (result.acknowledgement?.result !== "applied" ||
          result.acknowledgement.opId !== result.operation.opId)
        throw new Error("自己修復operationの適用結果が不正です。");
      operations.push(result.operation);
    }
    completed++;
  }
  onProgress({ phase: "verifying", completed, total: targets.length });
  assertActive();
  const receipts = await adapter.auditOutbox(operations);
  if (receipts.received !== operations.length || receipts.missing !== 0)
    throw new Error("自己修復Receiptの照合が完了していません。");
  const final = await adapter.readRecoverySnapshot();
  const finalMap = new Map(final.nodes.map((record) => [record.value.id, record]));
  if (finalMap.size !== final.nodes.length || finalMap.size !== plan.desired.size ||
      [...plan.desired].some(([id, record]) =>
        canonicalSyncValue(record.value) !== canonicalSyncValue(finalMap.get(id)?.value)) ||
      canonicalSyncValue(final.pinnedNote?.value ?? { body: "" }) !== canonicalSyncValue(pinnedDesired) ||
      canonicalSyncValue(final.features?.value ?? { ideasEnabled: false }) !== canonicalSyncValue(featuresDesired) ||
      planRecoverySortKeyRepair(finalMap).changedNodeCount !== 0)
    throw new Error("Firebase再読込と現在ローカル状態が一致しません。再試行できます。");
  if (await persistence.loadCommitted() !== sourceRaw || await persistence.loadJournal())
    throw new Error("自己修復中にローカル状態が変更されました。同期復帰を停止しました。");
  assertActive();
  onProgress({ phase: "finalizing", completed, total: targets.length });
  const next: LocalEnvelope = { ...source, domain: Object.fromEntries(finalMap),
    sync: { ...source.sync, outbox: [], seenOpIds: [...new Set([...source.sync.seenOpIds,
      ...operations.map((operation) => operation.opId)])].slice(-500) },
    profile: { ...source.profile,
      pinnedNote: { ...source.profile.pinnedNote, synced: final.pinnedNote ?? null,
        dirtySince: null, migrationPending: false },
      features: { ...source.profile.features, synced: final.features ?? null,
        migrationPending: false } } };
  await persistence.completeLocalSelfRepair(sourceRaw, JSON.stringify(next), new Date().toISOString());
  return { nodeCount: final.nodes.length, operationCount: operations.length,
    receiptCount: receipts.received, remoteOnlyCount: plan.remoteOnlyCount,
    archivedOldOutboxCount: evidence.archivedOutboxCount };
}
