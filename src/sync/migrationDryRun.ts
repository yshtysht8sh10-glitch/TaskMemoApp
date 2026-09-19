import type { Node } from "../models/node";
import { nodeFromV2Value, nodeToV2Value } from "./nodeV2Codec";
import type { VersionedNode } from "./types";
import { normalizeNodeSortKeys } from "../domain/sortKeys";

export type MigrationIssue = { kind: "duplicate-id" | "orphan-parent" | "invalid-node" | "field-loss"; nodeId: string; detail: string };
export type MigrationDryRun = {
  schemaVersion: 2;
  sourceCount: number;
  outputCount: number;
  activeCount: number;
  deletedCount: number;
  purgedCount: number;
  categoryCount: number;
  memoCount: number;
  ideaCount: number;
  routineCount: number;
  completedCount: number;
  routineHistoryCount: number;
  dueCount: number;
  dayPartCount: number;
  orphanCount: number;
  unexpectedDataCount: number;
  addedV2Metadata: string[];
  unknownFields: { nodeId: string; fields: string[] }[];
  changedFields: { nodeId: string; fields: string[] }[];
  lostFieldCount: number;
  records: VersionedNode[];
  issues: MigrationIssue[];
};

/** Pure/read-only planner. It never receives a Firestore handle and cannot write production data. */
export function planV1ToV2Migration(nodes: Node[], migrationId: string): MigrationDryRun {
  if (!migrationId.trim()) throw new Error("migrationId is required");
  const ids = new Set<string>();
  const duplicates = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) duplicates.add(node.id);
    else ids.add(node.id);
  }
  const issues: MigrationIssue[] = [...duplicates].map((nodeId) => ({ kind: "duplicate-id", nodeId, detail: "同じidのNodeが複数あります。" }));
  for (const node of nodes) if (node.parentId && !ids.has(node.parentId)) issues.push({ kind: "orphan-parent", nodeId: node.id, detail: `親Category ${node.parentId} がありません。` });
  const known = new Set("id type parentId sortKey title createdAt updatedAt deletedAt deletionBatchId purgedAt categoryKind routineWeekday routineDayOfMonth routineMonth memoType deadlineSortKey body dueAt duePreset status completedAt routineHistory repeatRule".split(" "));
  const unknownFields = nodes.map(node => ({ nodeId: node.id, fields: Object.keys(node).filter(key => !known.has(key)) })).filter(item => item.fields.length);
  const normalizedNodes = normalizeNodeSortKeys(nodes);
  const changedFields: MigrationDryRun["changedFields"] = normalizedNodes
    .filter((node, index) => node.sortKey !== nodes[index].sortKey)
    .map((node) => ({ nodeId: node.id, fields: ["sortKey"] }));
  let lostFieldCount = 0;
  let unexpectedDataCount = 0;
  for (const node of nodes) {
    if (!node.id || !["memo", "category"].includes(node.type) || !node.sortKey || !(node.createdAt instanceof Date) || !Number.isFinite(node.createdAt.getTime()))
      { issues.push({ kind: "invalid-node", nodeId: node.id, detail: "Invalid identity/type/rank/date" }); unexpectedDataCount++; }
    const parent = nodes.find(item => item.id === node.parentId);
    if (parent && parent.type !== "category") issues.push({ kind: "orphan-parent", nodeId: node.id, detail: "Parent is not a Category" });
    if (node.type === "memo" && (!["task", "idea"].includes(node.memoType ?? "task") || !["active", "completed"].includes(node.status) || typeof node.body !== "string" || typeof node.duePreset !== "string")) {
      issues.push({ kind: "invalid-node", nodeId: node.id, detail: "Invalid Memo schema value" }); unexpectedDataCount++;
    }
  }
  // IDs (not input array order or updatedAt) define deterministic migration identity.
  const records = normalizedNodes.map((node): VersionedNode => ({
    value: nodeToV2Value(node), revision: 0,
    lastOpId: `migration:${encodeURIComponent(migrationId)}:${encodeURIComponent(node.id)}`,
    lastDeviceId: `migration:${migrationId}`, lastLocalSeq: 0, operationType: "import",
  }));
  for (const record of records) {
    const decoded = nodeToV2Value(nodeFromV2Value(JSON.parse(JSON.stringify(record.value))));
    const changed = Object.keys(decoded).filter(key => JSON.stringify(decoded[key]) !== JSON.stringify(record.value[key]));
    if (changed.length) changedFields.push({ nodeId: record.value.id, fields: changed });
    for (const key of Object.keys(record.value)) if (JSON.stringify(decoded[key]) !== JSON.stringify(record.value[key])) {
      lostFieldCount++;
      issues.push({ kind: "field-loss", nodeId: record.value.id, detail: key });
    }
  }
  return {
    schemaVersion: 2, sourceCount: nodes.length, outputCount: records.length,
    activeCount: nodes.filter((node) => !node.deletedAt && !node.purgedAt).length,
    deletedCount: nodes.filter((node) => Boolean(node.deletedAt) && !node.purgedAt).length,
    purgedCount: nodes.filter((node) => Boolean(node.purgedAt)).length,
    categoryCount: nodes.filter(node => node.type === "category").length,
    memoCount: nodes.filter(node => node.type === "memo").length,
    ideaCount: nodes.filter(node => node.type === "memo" && node.memoType === "idea").length,
    routineCount: nodes.filter(node => node.type === "memo" && Boolean(node.repeatRule)).length,
    completedCount: nodes.filter(node => node.type === "memo" && node.status === "completed").length,
    routineHistoryCount: nodes.reduce((sum, node) => sum + (node.type === "memo" ? Object.keys(node.routineHistory ?? {}).length : 0), 0),
    dueCount: nodes.filter(node => node.type === "memo" && Boolean(node.dueAt)).length,
    dayPartCount: nodes.filter(node => node.type === "memo" && ["morning", "afternoon"].includes(node.duePreset)).length,
    orphanCount: issues.filter(issue => issue.kind === "orphan-parent").length,
    unexpectedDataCount,
    addedV2Metadata: ["revision", "lastOpId", "lastDeviceId", "lastLocalSeq", "operationType"],
    unknownFields, changedFields, lostFieldCount,
    records, issues,
  };
}
