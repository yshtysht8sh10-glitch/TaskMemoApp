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

/** Match the actual editor instant, never period membership.
 * If presets coincide, the first displayed (possibly merged) choice wins. */
export function selectedMemoDeadlineChoice(preset: DuePreset, custom: string,
  choices: readonly { key: MemoDeadlineChoice }[], now = new Date(),
  granularity: TodayGranularity = 'amPm', original?: { duePreset: DuePreset; dueAt: Date | null } | null): MemoDeadlineChoice | null {
  if (preset === 'none') return choices.some(item => item.key === 'none') ? 'none' : null;
  if (original && original.duePreset === preset && !original.dueAt)
    return choices.some(item => item.key === 'none') ? 'none' : null;
  // The editor shows minutes but preserves an unchanged stored instant's seconds/ms.
  const value = original && original.duePreset === preset && original.dueAt && custom === formatDateTimeInput(original.dueAt)
    ? original.dueAt : parseLocalDateTime(custom);
  if (value) {
    for (const item of choices) {
      if (item.key === 'none' || item.key === 'custom') continue;
      const concrete = chooseMemoDeadline(item.key, now, granularity).custom;
      if (concrete && parseLocalDateTime(concrete)?.getTime() === value.getTime()) return item.key;
    }
  }
  return 'custom';
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
