import { expect, it } from 'vitest';
import { initialRoutineFrequency, routineRuleForSave } from './routineEditor';
import type { MemoNode } from '../models/node';

it('new ordinary Routine starts with a visible daily rule instead of saving null', () => {
  const frequency = initialRoutineFrequency(null, true);
  expect(frequency).toBe('day');
  expect(routineRuleForSave(frequency, '1', '2026-10-06')).toEqual({ frequency: 'day', interval: 1, startsOn: '2026-10-06' });
});
it('an unset existing Routine cannot commit a null rule', () => {
  expect(() => routineRuleForSave('none', '1', '2026-10-06')).toThrow('繰り返し');
});
it('does not infer a rule for existing unset data or ordinary Tasks', () => {
  expect(initialRoutineFrequency({ repeatRule: null } as MemoNode, true)).toBe('none');
  expect(initialRoutineFrequency(null, false)).toBe('none');
});
it.each(['day', 'week', 'month', 'year'] as const)('retains the selected %s frequency', frequency => {
  const rule = { frequency, interval: 3, startsOn: '2026-10-06' };
  expect(initialRoutineFrequency({ repeatRule: rule } as MemoNode, true)).toBe(frequency);
  expect(routineRuleForSave(frequency, '3', rule.startsOn)).toEqual(rule);
});
it.each([['0', '2026-10-06'], ['1.5', '2026-10-06'], ['1', '2026-02-30']])('rejects invalid interval/date %s %s', (interval, date) => {
  expect(() => routineRuleForSave('day', interval, date)).toThrow();
});
