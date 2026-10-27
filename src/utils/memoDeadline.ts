import type { DuePreset } from '../models/node';
import { deadlineCreateContext, deadlineGroupDefinitions, deadlineGroupForDueAt, type DeadlineCreateContext } from '../domain/deadlineView';
import { dueDateForPreset, formatDateTimeInput, parseLocalDateTime } from './dueDates';

export type MemoDeadlineChoice = DuePreset | 'nextWeek' | 'nextMonth' | 'nextYear';
export const MEMO_DEADLINE_PRESETS: { key: MemoDeadlineChoice; label: string }[] = [
  { key: 'none', label: '期限なし' }, { key: 'today', label: '今日中' },
  { key: 'tomorrow', label: '明日中' }, { key: 'morning', label: '午前中' },
  { key: 'afternoon', label: '午後まで' }, { key: 'thisWeek', label: '今週中' },
  { key: 'nextWeek', label: '来週' }, { key: 'thisMonth', label: '今月中' },
  { key: 'nextMonth', label: '来月' }, { key: 'thisYear', label: '今年中' },
  { key: 'nextYear', label: '来年' },
  { key: 'custom', label: '日時指定' },
];

/** Future shortcuts select a concrete date; the persisted schema stays custom. */
export function chooseMemoDeadline(choice: MemoDeadlineChoice, now = new Date()): { preset: DuePreset; custom?: string } {
  if (choice === 'nextWeek' || choice === 'nextMonth' || choice === 'nextYear') {
    const dueAt = new Date(deadlineCreateContext(deadlineGroupDefinitions('today').find(g => g.id === choice)!, now)!.initialDueAt!);
    dueAt.setSeconds(0, 0);
    return { preset: 'custom', custom: formatDateTimeInput(dueAt) };
  }
  return { preset: choice };
}

export function memoDeadlineDraft(preset: DuePreset, custom: string, context?: DeadlineCreateContext,
  now = new Date(), original?: { duePreset: DuePreset; dueAt: Date | null } | null) {
  if (!context && original && original.duePreset === preset &&
    (!original.dueAt || custom === formatDateTimeInput(original.dueAt)))
    return { duePreset: original.duePreset, dueAt: original.dueAt };
  let dueAt = context && !context.dueEditable ? context.initialDueAt : dueDateForPreset(preset, now);
  if (preset === 'custom' && (!context || context.dueEditable)) {
    dueAt = parseLocalDateTime(custom);
    if (!dueAt) throw new Error('日時を YYYY/MM/DD HH:mm 形式で入力してください。');
  }
  if (context?.dueEditable && deadlineGroupForDueAt(dueAt, now, context.granularity) !== context.targetGroup)
    throw new Error(`「${context.label}」に入る期限を指定してください。`);
  return { duePreset: context?.initialDuePreset ?? preset, dueAt };
}
