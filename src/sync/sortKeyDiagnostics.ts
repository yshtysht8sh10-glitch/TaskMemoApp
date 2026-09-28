import type { Node } from "../models/node";

export const SORT_KEY_DIAGNOSTICS_KEY = "@taskmemo/sort-key-diagnostics/v1";
export type SortKeyPass = { trigger: "hydrate" | "remote-listener" | "local-command" | "routine" | "migration" | "other";
  startedAt: string; scannedCount: number; changedCount: number; generatedOperationCount: number;
  suppressedCount: number; durationMs: number };
type SortKeyReport = { normalizationPassCount: number; scannedNodeCount: number;
  alreadyNormalizedNodeCount: number; changedNodeCount: number; generatedOperationCount: number;
  suppressedNoOpOperationCount: number; remoteOriginSuppressedCount: number;
  maxChangedNodesPerPass: number; maxGeneratedOperationsPerPass: number; passes: SortKeyPass[] };
const empty = (): SortKeyReport => ({ normalizationPassCount: 0, scannedNodeCount: 0,
  alreadyNormalizedNodeCount: 0, changedNodeCount: 0, generatedOperationCount: 0,
  suppressedNoOpOperationCount: 0, remoteOriginSuppressedCount: 0,
  maxChangedNodesPerPass: 0, maxGeneratedOperationsPerPass: 0, passes: [] });
export function getSortKeyDiagnostics(): SortKeyReport {
  if (typeof window === "undefined") return empty();
  try {
    const stored = window.localStorage.getItem(SORT_KEY_DIAGNOSTICS_KEY);
    return stored ? JSON.parse(stored) as SortKeyReport : empty();
  } catch { return empty(); }
}
/** Diagnostic metadata only: no Node titles/bodies/keys are persisted. */
export function recordSortKeyPass(trigger: SortKeyPass["trigger"], before: Node[], after: Node[],
  generatedOperationCount: number, startedAt = new Date(), durationMs = 0) {
  if (typeof window === "undefined") return;
  const afterKeys = new Map(after.map(node => [node.id, node.sortKey]));
  const changedCount = before.filter(node => afterKeys.get(node.id) !== node.sortKey).length;
  const scannedCount = before.length;
  const suppressedCount = scannedCount - changedCount;
  const pass: SortKeyPass = { trigger, startedAt: startedAt.toISOString(), scannedCount,
    changedCount, generatedOperationCount, suppressedCount, durationMs };
  const report = getSortKeyDiagnostics();
  report.normalizationPassCount++;
  report.scannedNodeCount += scannedCount;
  report.alreadyNormalizedNodeCount += suppressedCount;
  report.changedNodeCount += changedCount;
  report.generatedOperationCount += generatedOperationCount;
  report.suppressedNoOpOperationCount += suppressedCount;
  if (trigger === "remote-listener") report.remoteOriginSuppressedCount += changedCount;
  report.maxChangedNodesPerPass = Math.max(report.maxChangedNodesPerPass, changedCount);
  report.maxGeneratedOperationsPerPass = Math.max(report.maxGeneratedOperationsPerPass, generatedOperationCount);
  report.passes = [...report.passes, pass].slice(-32);
  try { window.localStorage.setItem(SORT_KEY_DIAGNOSTICS_KEY, JSON.stringify(report)); }
  catch { /* Best-effort bounded telemetry must not block local editing. */ }
}
