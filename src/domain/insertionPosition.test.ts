import { describe, expect, it } from 'vitest';
import { beforeIdForInsertion } from './insertionPosition';

describe('insertion position', () => {
  const ids = ['a', 'moving', 'b', 'c'];
  it('先頭・末尾をbeforeIdへ変換する', () => {
    expect(beforeIdForInsertion(ids, 'moving', { kind: 'prepend' })).toBe('a');
    expect(beforeIdForInsertion(ids, 'moving', { kind: 'append' })).toBeUndefined();
  });
  it('兄弟の前・後ろをmoving自身を除いたbeforeIdへ変換する', () => {
    expect(beforeIdForInsertion(ids, 'moving', { kind: 'before', nodeId: 'b' })).toBe('b');
    expect(beforeIdForInsertion(ids, 'moving', { kind: 'after', nodeId: 'b' })).toBe('c');
    expect(beforeIdForInsertion(ids, 'moving', { kind: 'after', nodeId: 'c' })).toBeUndefined();
  });
});
