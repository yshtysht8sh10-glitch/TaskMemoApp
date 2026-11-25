import type { MemoNode, RoutineOutcome } from '../models/node';

export function validRoutineOutcome(value: unknown): value is RoutineOutcome {
  if (!value || typeof value !== 'object') return false;
  const v = value as RoutineOutcome;
  return ['completed', 'skipped', 'missed', 'pending'].includes(v.state) && typeof v.changedAt === 'string' &&
    Number.isFinite(Date.parse(v.changedAt)) && Number.isSafeInteger(v.version) && v.version > 0;
}

/** Per-date register. Concurrent equal versions use timestamp then state as a stable tie break.
 * Pending is an explicit cancellation, never an absent map entry. */
export function mergeRoutineOutcomes(a: MemoNode['routineOutcomes'], b: MemoNode['routineOutcomes']) {
  assertRoutineOutcomesReadable(a);
  assertRoutineOutcomesReadable(b);
  const result: NonNullable<MemoNode['routineOutcomes']> = {};
  for (const source of [a, b]) for (const [key, value] of Object.entries(source ?? {})) {
    if (!validRoutineOutcome(value)) continue;
    const old = result[key];
    if (!old || value.version > old.version || (value.version === old.version &&
      (value.changedAt > old.changedAt || (value.changedAt === old.changedAt && value.state > old.state)))) result[key] = value;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

/** Fail before lossy merge. The caller retains the source raw; no guessed fallback. */
export function assertRoutineOutcomesReadable(value: unknown): asserts value is MemoNode['routineOutcomes'] {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([key, entry]) =>
    !/^\d{4}-\d{2}-\d{2}$/.test(key) || !Number.isFinite(Date.parse(key)) ||
    new Date(key).toISOString().slice(0, 10) !== key || !validRoutineOutcome(entry) ||
    Object.keys(entry).some(field => !['state', 'changedAt', 'version'].includes(field))))
    throw new Error('未対応または不正なRoutine実施状態です。原本を保持して停止します。');
}

/** Only an isolated, non-network harness may create missed until the server fence is approved. */
export function containsMissedResult(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const outcomes = (value as { routineOutcomes?: Record<string, { state?: string }> }).routineOutcomes;
  return !!outcomes && Object.values(outcomes).some(entry => entry?.state === 'missed');
}
