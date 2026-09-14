import { describe, expect, it } from 'vitest';

import { dueDateForPreset } from './dueDates';

describe('dueDateForPreset', () => {
  it('tomorrowを翌日の23:59へ変換する', () => {
    const dueAt = dueDateForPreset('tomorrow', new Date(2026, 11, 31, 10, 15));
    expect(dueAt).toEqual(new Date(2027, 0, 1, 23, 59, 0, 0));
  });
});
