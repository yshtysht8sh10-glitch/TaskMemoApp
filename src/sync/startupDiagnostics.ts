import { canonical } from '../textFormat/syntax';
import type { VersionedNode } from './types';
// Bounded, content-free evidence; never used for merge or persistence decisions.
export const STARTUP_DIAGNOSTICS_KEY = 'taskmemo-startup-diagnostics-v1';
function fingerprint(value: unknown) {
  let hash = 2166136261;
  for (const char of canonical(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
let events: object[] = [], last = '';
export function beginStartupDiagnostics() { events = []; last = ''; }
export function recordStartupSnapshot(source: string, records: VersionedNode[], pendingCount: number, history: { past: number; future: number }) {
  const sorted = [...records].sort((a, b) => a.value.id.localeCompare(b.value.id));
  const evidence = { source, count: records.length, dataFingerprint: fingerprint(sorted.map(r => r.value)),
    revisionFingerprint: fingerprint(sorted.map(r => [r.value.id, r.revision, r.lastOpId])), pendingCount, history };
  const key = canonical(evidence);
  if (key === last) return;
  last = key;
  events.push({ at: new Date().toISOString(), ...evidence }); events = events.slice(-80);
  try { if (typeof window !== 'undefined') window.sessionStorage.setItem(STARTUP_DIAGNOSTICS_KEY, JSON.stringify(events)); }
  catch { /* Diagnostics must not block saving or clear user storage. */ }
}
