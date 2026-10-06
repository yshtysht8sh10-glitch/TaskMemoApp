import type { RepeatRule } from '../models/node';
import { resolveDeadline, sessionDate } from './deadlines';
import { ROUTINE_ALIASES } from './syntax';
import { COMPLETION_VALUES, ROUTINE_FREQUENCIES, errorAt, type TextContext, type TextDocument, type TextSession, type ValidatedDocument } from './syntax';

export function parseRoutine(value: string, startsOn?: string): RepeatRule | null | undefined {
  if (value === 'なし') return null;
  if (Object.hasOwn(ROUTINE_ALIASES, value) && startsOn) return parseRoutine(`${ROUTINE_ALIASES[value as keyof typeof ROUTINE_ALIASES]} interval=1 startsOn=${startsOn}`);
  const match = /^(day|week|month|year) interval=([1-9]\d*) startsOn=(\d{4}-\d{2}-\d{2})$/.exec(value);
  if (!match || !Number.isSafeInteger(+match[2])) return undefined;
  const date = new Date(`${match[3]}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== match[3]) return undefined;
  return { frequency: match[1] as typeof ROUTINE_FREQUENCIES[number], interval: +match[2], startsOn: match[3] };
}

/** Usable for live validation without React, effects, clocks, storage or mutation. */
export function validateText(document: TextDocument, context: TextContext, session?: TextSession): ValidatedDocument {
  const errors = [...document.errors], seen = new Set<string>();
  const routineStart = sessionDate(context);
  const rows = document.rows.map(row => {
    if (!row.title.trim()) errors.push(errorAt('title', row.line, 3));
    if (row.ref) {
      if (seen.has(row.ref) || (session && !session.refs[row.ref])) errors.push(errorAt('ref', row.line, 1));
      seen.add(row.ref);
    }
    const baseline = row.ref && session ? session.baselineCells[row.ref] : undefined;
    const existing = row.ref && session ? session.baseline.find(record => record.value.id === session.refs[row.ref!])?.value : undefined;
    let resolvedDue;
    if (row.due !== undefined && row.due !== '') {
      // Preserve the exact stored dueAt AND duePreset for unchanged display cells.
      if (existing && baseline?.[3] === row.due) resolvedDue = { dueAt: existing.dueAt as string | null, duePreset: existing.duePreset as import('../models/node').DuePreset };
      else { resolvedDue = resolveDeadline(row.due, context) ?? undefined; if (!resolvedDue) errors.push(errorAt('due', row.line, 4)); }
    }
    if (row.completion && !(COMPLETION_VALUES as readonly string[]).includes(row.completion)) errors.push(errorAt('completion', row.line, 5));
    let repeatRule;
    if (row.routine) {
      const oldRule = existing?.repeatRule as RepeatRule | null | undefined;
      const frequency = Object.hasOwn(ROUTINE_ALIASES, row.routine) ? ROUTINE_ALIASES[row.routine as keyof typeof ROUTINE_ALIASES] : undefined;
      repeatRule = parseRoutine(row.routine, oldRule && frequency && oldRule.frequency === frequency && oldRule.interval === 1 ? oldRule.startsOn : routineStart);
      if (repeatRule === undefined && baseline?.[6] !== row.routine) errors.push(errorAt('routine', row.line, 7));
    }
    if (row.type === 'Category' && (row.due || row.completion || row.body || row.routine)) errors.push(errorAt('protected', row.line, 4, 'Categoryには期限・完了・本文・Routine列を設定できません。'));
    if (row.type === 'Idea' && (row.completion && row.completion !== '未完了' || row.due && row.due !== '期限なし' || row.routine && row.routine !== 'なし')) errors.push(errorAt('protected', row.line, 4, 'Ideaに期限・完了・Routineは設定できません。'));
    return { ...row, resolvedDue, repeatRule };
  });
  for (const row of rows) {
    if (session?.systemRegions && session.view === 'tree' && !row.region) errors.push(errorAt('hierarchy', row.line, 1, '@rootまたは@routine領域を指定してください。'));
    if (row.region === 'routine') {
      if (row.parentRow !== null || row.type !== 'Task' || session && !session.routineRootId) errors.push(errorAt('routine', row.line, 7, '既存Routine管理領域の直下にTaskを指定してください。管理領域の準備が必要です。ツリーの「ルーティーン追加」から準備して再度開いてください。'));
      if (!row.routine || row.routine === 'なし' || !row.repeatRule) errors.push(errorAt('routine', row.line, 7, '@routine直下には有効なRoutine設定が必要です。'));
    }
    if (session?.systemRegions && session.view === 'tree' && row.ref) {
      const existing = session.baseline.find(r => r.value.id === session.refs[row.ref!])?.value;
      if (session.routineRootId && existing?.parentId === session.routineRootId && row.region !== 'routine' && row.routine && row.routine !== 'なし') errors.push(errorAt('routine', row.line, 7, 'Routine解除には領域移動とRoutine設定の削除の両方が必要です。'));
    }
  }
  return { rows, errors };
}
