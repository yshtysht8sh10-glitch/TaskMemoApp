/** Bounded, opt-in, same-JS-context evidence. Never stores Node title/body values. */
export const SELF_REPAIR_DIAGNOSTICS_KEY = "@taskmemo/self-repair-diagnostics/v1";
type RecordValue = { value: unknown; revision?: number; lastOpId?: string; lastDeviceId?: string;
  lastLocalSeq?: number; operationType?: string };
type ReadMetadata = { fromCache?: boolean; hasPendingWrites?: boolean };
type FieldDigest = { type: string; hash: string | null };
type Comparison = {
  target: string; conflictNodeId: string | null; detectedAt: string; outcome: string; differentFields: string[];
  beforeFields: Record<string, FieldDigest>; afterFields: Record<string, FieldDigest>;
  beforeMetadata: Omit<RecordValue, "value"> | null; afterMetadata: Omit<RecordValue, "value"> | null;
  baselineMutatedInMemory: boolean | null; initialRead: ReadMetadata | null; transactionRead: ReadMetadata;
  lastSuccessfulRepairOperationId: string | null;
  beforeUserData: FieldDigest; afterUserData: FieldDigest;
};
export type SyncActivity = "normalStart" | "localOnlyStart" | "stop" | "normalFlush" |
  "normalUploadAttempt" | "normalUploadSucceeded" | "legacyUploadAttempt" | "outboxGenerated" |
  "listenerReceived" | "listenerLocalMutation" | "localCommit" | "hydrate" | "sortKeyRepair" |
  "blockedCommand" | "authChanged" | "repairCommitted" | "repairTransactionAttempt";
type Report = { version: 1; build: string | null; startedAt: string; endedAt: string | null;
  status: string; readOnly: boolean; localDeviceId: string; coverage: string;
  counters: Partial<Record<SyncActivity, number>>;
  events: { at: string; kind: SyncActivity; operationId?: string; deviceId?: string }[];
  lastSuccessfulRepairOperationId: string | null; comparisons: number;
  lastComparison: Comparison | null; conflict: Comparison | null; differences: Comparison[]; persistenceError: boolean;
  actorReceipt: { status: string; operationId?: string; deviceId?: string; localSeq?: number;
    baseRevision?: number; operationType?: string; producerType?: string; acknowledgedValueMatchesCurrent?: boolean } | null };
let report: Report | null = null;
let active = false;
const baselines = new Map<string, { serialized: string; metadata: ReadMetadata }>();
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item) ?? "undefined";
function persist() {
  if (!report) return;
  try { if (typeof window !== "undefined") window.sessionStorage.setItem(SELF_REPAIR_DIAGNOSTICS_KEY, JSON.stringify(report)); }
  catch { report.persistenceError = true; }
}
export function beginSelfRepairDiagnostics(localDeviceId: string, readOnly: boolean) {
  active = true; baselines.clear();
  report = { version: 1, build: process.env.EXPO_PUBLIC_BUILD_SHA ?? null,
    startedAt: new Date().toISOString(), endedAt: null, status: "running", readOnly, localDeviceId,
    coverage: "This JS context only; other tabs, old builds and external producers are not counted.",
    counters: { normalStart: 0, localOnlyStart: 0, stop: 0, normalFlush: 0,
      normalUploadAttempt: 0, normalUploadSucceeded: 0, legacyUploadAttempt: 0,
      outboxGenerated: 0, listenerReceived: 0, listenerLocalMutation: 0, localCommit: 0,
      hydrate: 0, sortKeyRepair: 0, blockedCommand: 0, authChanged: 0, repairCommitted: 0, repairTransactionAttempt: 0 },
    events: [], lastSuccessfulRepairOperationId: null, comparisons: 0,
    lastComparison: null, conflict: null, differences: [], persistenceError: false, actorReceipt: null };
  persist();
}
export function finishSelfRepairDiagnostics(status: string) {
  if (report && active) { report.status = status; report.endedAt = new Date().toISOString(); persist(); }
  active = false; baselines.clear();
}
export function getSelfRepairDiagnostics() { return report ? structuredClone(report) : null; }
export function selfRepairDiagnosticsActive() { return active; }
export function recordActorReceipt(value: NonNullable<Report["actorReceipt"]>) {
  if (active && report) { report.actorReceipt = value; persist(); }
}
export function recordSyncActivity(kind: SyncActivity, details: { operationId?: string; deviceId?: string } = {}, count = 1) {
  if (!active || !report) return;
  report.counters[kind] = (report.counters[kind] ?? 0) + count;
  report.events.push({ at: new Date().toISOString(), kind, ...details });
  report.events = report.events.slice(-40);
  if (kind === "repairCommitted" && details.operationId) report.lastSuccessfulRepairOperationId = details.operationId;
  persist();
}
export async function recordRepairSnapshot(target: string, record: RecordValue | null, metadata: ReadMetadata) {
  if (!active || !report) return;
  baselines.set(target, { serialized: canonical(record), metadata: { ...metadata } });
}
const metadataOf = (record: RecordValue | null) => record ? {
  revision: record.revision, lastOpId: record.lastOpId, lastDeviceId: record.lastDeviceId,
  lastLocalSeq: record.lastLocalSeq, operationType: record.operationType,
} : null;
async function digest(value: unknown, exists: boolean): Promise<FieldDigest> {
  const type = !exists ? "missing" : value === null ? "null" : Array.isArray(value) ? "array" :
    value instanceof Date ? "Date" : value && typeof value === "object" && "toDate" in value ? "Timestamp-like" : typeof value;
  let hash: string | null = null;
  try {
    const result = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
    hash = [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  } catch { /* Hash unavailable must not alter transaction behavior. */ }
  return { type, hash };
}
export async function recordRepairComparison(target: string, before: RecordValue | null, after: RecordValue | null,
  outcome: string, transactionRead: ReadMetadata) {
  if (!active || !report) return;
  const capturedReport = report;
  const beforeValue = (before?.value ?? {}) as Record<string, unknown>;
  const afterValue = (after?.value ?? {}) as Record<string, unknown>;
  const fields = [...new Set([...Object.keys(beforeValue), ...Object.keys(afterValue)])].sort();
  const differentFields = fields.filter(field => canonical(beforeValue[field]) !== canonical(afterValue[field]));
  if (Boolean(before) !== Boolean(after)) differentFields.unshift("$exists");
  const selected = differentFields.filter(field => field !== "$exists").slice(0, 64);
  const beforeFields: Record<string, FieldDigest> = {}, afterFields: Record<string, FieldDigest> = {};
  // Preserve the original baseline comparison before any await.
  const baseline = baselines.get(target);
  const baselineMutatedInMemory = baseline ? baseline.serialized !== canonical(before) : null;
  const beforeMetadata = metadataOf(before), afterMetadata = metadataOf(after);
  const detectedAt = new Date().toISOString();
  const [beforeUserData, afterUserData] = await Promise.all([digest(before?.value, !!before), digest(after?.value, !!after)]);
  await Promise.all(selected.map(async field => {
    [beforeFields[field], afterFields[field]] = await Promise.all([
      digest(beforeValue[field], Object.hasOwn(beforeValue, field)), digest(afterValue[field], Object.hasOwn(afterValue, field))]);
  }));
  if (report !== capturedReport) return;
  const comparison: Comparison = { target, conflictNodeId: outcome === "conflict" && target.startsWith("node:") ? target.slice(5) : null, detectedAt, outcome, differentFields,
    beforeUserData, afterUserData,
    beforeFields, afterFields, beforeMetadata, afterMetadata, baselineMutatedInMemory,
    initialRead: baseline?.metadata ?? null, transactionRead,
    lastSuccessfulRepairOperationId: report.lastSuccessfulRepairOperationId };
  report.comparisons++; report.lastComparison = comparison;
  if (differentFields.length) report.differences = [...report.differences, comparison].slice(-8);
  if (outcome === "conflict") report.conflict = comparison;
  persist();
}
