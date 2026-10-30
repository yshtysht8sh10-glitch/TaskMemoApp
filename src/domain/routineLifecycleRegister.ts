import type { MemoNode } from '../models/node';
type Lifecycle = NonNullable<MemoNode['routineLifecycle']>;
export function validRoutineLifecycle(value: unknown): value is Lifecycle {
  if (!value || typeof value !== 'object') return false;
  const v = value as Lifecycle;
  const timestamp = (s: unknown): s is string => typeof s === 'string' && Number.isFinite(Date.parse(s));
  return Number.isSafeInteger(v.version) && v.version >= 1 && Array.isArray(v.periods) && v.periods.every((p, i) =>
    !!p && timestamp(p.completedAt) && (p.resumedAt === null || (timestamp(p.resumedAt) && Date.parse(p.resumedAt) >= Date.parse(p.completedAt))) &&
    (i === v.periods.length - 1 || p.resumedAt !== null) &&
    (i === 0 || (!!v.periods[i - 1].resumedAt && Date.parse(p.completedAt) >= Date.parse(v.periods[i - 1].resumedAt!))) &&
    !!p.retained && typeof p.retained === 'object' && !Array.isArray(p.retained) && Object.entries(p.retained).every(([key, due]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && timestamp(due)));
}
// Definition state and all exclusion periods form one register. Content edits
// from another device must not resurrect a completed definition.
export function mergeRoutineLifecycle(a?: Lifecycle, b?: Lifecycle): Lifecycle | undefined {
  if ((a && !validRoutineLifecycle(a)) || (b && !validRoutineLifecycle(b))) throw Error('Routine完了期間が不正です。原本を保持して同期を停止します。');
  if (!a) return b;
  if (!b) return a;
  if (a.version !== b.version) return a.version > b.version ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}
export function replayRoutineLifecycle(current?: Lifecycle, target?: Lifecycle): Lifecycle | undefined {
  if (JSON.stringify(current) === JSON.stringify(target)) return target;
  return { version: Math.max(current?.version ?? 0, target?.version ?? 0) + 1, periods: target?.periods ?? [] };
}
