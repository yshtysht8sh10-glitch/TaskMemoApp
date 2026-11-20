import { expect, it } from 'vitest';
import { allDeadlineGroupIds } from '../domain/deadlineView';
import { chooseMemoDeadline, memoDeadlineChoices, selectedMemoDeadlineChoice } from './memoDeadline';

const visible = new Set(allDeadlineGroupIds());
it.each([
  new Date(2026, 10, 20, 8), new Date(2026, 10, 21, 23, 59),
  new Date(2026, 11, 31, 8), new Date(2028, 1, 29, 8),
  new Date(2026, 2, 8, 1, 59), new Date(2026, 10, 1, 1, 59),
])('selects exactly the first visible exact match at %s, including merged boundary presets', now => {
  const choices = memoDeadlineChoices(visible, 'amPm', now);
  for (const choice of choices.filter(c => !['custom', 'none'].includes(c.key))) {
    const target = chooseMemoDeadline(choice.key, now, 'amPm').custom!;
    const first = choices.find(c => !['custom', 'none'].includes(c.key) && chooseMemoDeadline(c.key, now, 'amPm').custom === target)!;
    expect(selectedMemoDeadlineChoice('custom', target, choices, now, 'amPm')).toBe(first.key);
  }
});
it.each(['today', 'dayNight', 'threePart', 'amPm'] as const)('uses the visible %s concrete choices without changing the draft', granularity => {
  const now = new Date(2026, 10, 18, 8), choices = memoDeadlineChoices(visible, granularity, now);
  for (const choice of choices.filter(c => !['custom', 'none'].includes(c.key))) {
    const draft = chooseMemoDeadline(choice.key, now, granularity).custom!;
    expect(selectedMemoDeadlineChoice('custom', draft, choices, now, granularity)).not.toBe('custom');
    expect(draft).toBe(chooseMemoDeadline(choice.key, now, granularity).custom);
  }
});
it('uses values rather than legacy preset or click history, with no period-membership matching', () => {
  const now = new Date(2026, 10, 18, 8), choices = memoDeadlineChoices(visible, 'today', now);
  const tomorrow = chooseMemoDeadline('tomorrow', now, 'today').custom!;
  expect(selectedMemoDeadlineChoice('today', tomorrow, choices, now, 'today')).toBe('tomorrow');
  expect(selectedMemoDeadlineChoice('thisMonth', '2026/11/22 15:00', choices, now, 'today')).toBe('custom');
  expect(selectedMemoDeadlineChoice('none', tomorrow, choices, now, 'today')).toBe('none');
  expect(selectedMemoDeadlineChoice('custom', 'invalid draft', choices, now, 'today')).toBe('custom');
  expect(selectedMemoDeadlineChoice('custom', tomorrow, choices, now, 'today', { duePreset: 'custom', dueAt: null })).toBe('none');
});
it('does not select a disabled preset or rewrite a saved value when the date changes', () => {
  const now = new Date(2026, 10, 21, 23, 59), next = new Date(2026, 10, 22, 0, 0);
  const value = chooseMemoDeadline('tomorrow', now, 'today').custom!;
  expect(selectedMemoDeadlineChoice('custom', value, memoDeadlineChoices(new Set(), 'today', now), now, 'today')).toBe('custom');
  expect(selectedMemoDeadlineChoice('custom', value, memoDeadlineChoices(visible, 'today', next), next, 'today')).toBe('today');
});
it('does not hide preserved original seconds or milliseconds when testing exact equality', () => {
  const now = new Date(2026, 10, 18, 8), choices = memoDeadlineChoices(visible, 'today', now);
  const original = { duePreset: 'custom' as const, dueAt: new Date(2026, 10, 19, 23, 59, 59, 999) };
  expect(selectedMemoDeadlineChoice('custom', '2026/11/19 23:59', choices, now, 'today', original)).toBe('custom');
  expect(original.dueAt.getMilliseconds()).toBe(999);
  expect(selectedMemoDeadlineChoice('custom', '2026/11/19 23:59', choices, now, 'today', { ...original, dueAt: new Date(2026, 10, 19, 23, 59) })).toBe('tomorrow');
});
