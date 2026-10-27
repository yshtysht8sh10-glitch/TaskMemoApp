import type { DuePreset } from '../models/node';
import { deadlineCreateContext, deadlineGroupDefinitions, deadlineGroupForDueAt, deadlineGroups, deadlineDisplayGroups,
  type DeadlineCreateContext, type DeadlineGroupKey, type TodayGranularity } from '../domain/deadlineView';
import { dueDateForPreset, formatDateTimeInput, parseLocalDateTime } from './dueDates';

export type MemoDeadlineChoice = DeadlineGroupKey | 'custom';
export function memoDeadlineChoices(visibleGroupIds: ReadonlySet<DeadlineGroupKey>, granularity: TodayGranularity, now = new Date()) {
  return [...deadlineDisplayGroups(deadlineGroups([], now, visibleGroupIds, granularity), now, granularity)
    .filter(group => group.create)
    .map(group => ({ key: group.key as MemoDeadlineChoice, label: group.label })),
    { key: 'custom' as const, label: '日時指定' }];
}

/** Group choices select concrete dates; visibility never rewrites a saved deadline. */
export function chooseMemoDeadline(choice: MemoDeadlineChoice, now = new Date(), granularity: TodayGranularity = 'amPm'): { preset: DuePreset; custom?: string } {
  if (choice === 'custom') return { preset: 'custom' };
  if (choice === 'none') return { preset: 'none' };
  const definition = deadlineGroupDefinitions(granularity).find(group => group.id === choice);
  if (!definition?.create) throw new Error('期限を設定できないグループです。');
  const dueAt = new Date(deadlineCreateContext(definition, now, granularity)!.initialDueAt!);
  dueAt.setSeconds(0, 0);
  return { preset: 'custom', custom: formatDateTimeInput(dueAt) };
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
