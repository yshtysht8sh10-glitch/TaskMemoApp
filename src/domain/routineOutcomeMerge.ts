import type { MemoNode, RoutineOutcome } from '../models/node';

export function validRoutineOutcome(value: unknown): value is RoutineOutcome {
  if (!value || typeof value !== 'object') return false;
  const v = value as RoutineOutcome;
  return ['completed', 'skipped', 'pending'].includes(v.state) && typeof v.changedAt === 'string' &&
    Number.isFinite(Date.parse(v.changedAt)) && Number.isSafeInteger(v.version) && v.version > 0;
}

/** Per-date register. Concurrent equal versions use timestamp then state as a stable tie break.
 * Pending is an explicit cancellation, never an absent map entry. */
export function mergeRoutineOutcomes(a: MemoNode['routineOutcomes'], b: MemoNode['routineOutcomes']) {
  const result: NonNullable<MemoNode['routineOutcomes']> = {};
  for (const source of [a, b]) for (const [key, value] of Object.entries(source ?? {})) {
    if (!validRoutineOutcome(value)) continue;
    const old = result[key];
    if (!old || value.version > old.version || (value.version === old.version &&
      (value.changedAt > old.changedAt || (value.changedAt === old.changedAt && value.state > old.state)))) result[key] = value;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
