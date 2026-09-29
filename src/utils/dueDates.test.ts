import { describe, expect, it } from 'vitest';

import { dueDateForPreset, parseLocalDateTime } from './dueDates';

describe('dueDateForPreset', () => {
  it('tomorrowを翌日の23:59へ変換する', () => {
    const dueAt = dueDateForPreset('tomorrow', new Date(2026, 11, 31, 10, 15));
    expect(dueAt).toEqual(new Date(2027, 0, 1, 23, 59, 0, 0));
  });
});

it('存在しないカレンダー日付や時刻は保存用日時に変換しない', () => {
  expect(parseLocalDateTime('2026-02-31 12:00')).toBeNull();
  expect(parseLocalDateTime('2026-09-20 25:00')).toBeNull();
  expect(parseLocalDateTime('2026-09-20 15:30')).toEqual(new Date(2026, 8, 20, 15, 30));
});
