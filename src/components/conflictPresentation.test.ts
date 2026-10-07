import { expect, it } from 'vitest';
import { compareConflictFields, conflictTextSegments, displayConflictValue } from './conflictPresentation';
it('prioritizes changed fields and retains identical fields separately without mutating values', () => {
  const local = { body: 'old', ideasEnabled: true, extra: { a: [null, false] } };
  const account = { extra: { a: [null, false] }, ideasEnabled: true, body: 'new' };
  const before = JSON.stringify([local, account]); const diff = compareConflictFields(local, account);
  expect(diff.changed.map(f => f.name)).toEqual(['body']);
  expect(diff.same.map(f => f.name)).toEqual(['ideasEnabled', 'extra']);
  expect(JSON.stringify([local, account])).toBe(before);
});
it('identifies zero differences regardless of object key order', () => {
  expect(compareConflictFields({ a: 1, b: false }, { b: false, a: 1 }).changed).toEqual([]);
});
it('distinguishes missing null boolean arrays nested values and record absence', () => {
  expect(compareConflictFields({ a: null, b: false, c: [1], d: { x: 2 } }, { b: true, c: [2], d: { x: 3 } }).changed).toHaveLength(4);
  expect(compareConflictFields(null, { id: 'a' }).changed).toHaveLength(1);
  expect(displayConflictValue(undefined)).toBe('未設定（項目なし）');
  expect(displayConflictValue(null)).toBe('null'); expect(displayConflictValue(false)).toBe('false');
  expect(displayConflictValue('')).toBe('空文字');
});
it('highlights only the changed middle of long multiline body, preserves Unicode and all content', () => {
  const prefix = '共通行\n'.repeat(200), suffix = '\n末尾😀';
  const result = conflictTextSegments(prefix + '37万', prefix + '40万');
  expect(result.local.filter(s => s.changed).map(s => s.text).join('')).toBe('37');
  const emoji = conflictTextSegments(prefix + '😀' + suffix, prefix + '😁' + suffix);
  expect(emoji.local.map(s => s.text).join('')).toBe(prefix + '😀' + suffix);
  expect(emoji.local.filter(s => s.changed).map(s => s.text).join('')).toBe('😀');
});
it('highlights insertion/deletion and preserves unchanged strings', () => {
  const r = conflictTextSegments('a\nb', 'a\nNEW\nb');
  expect(r.account.filter(s => s.changed).map(s => s.text).join('')).toBe('NEW\n');
  expect(conflictTextSegments('same', 'same').local.every(s => !s.changed)).toBe(true);
});
