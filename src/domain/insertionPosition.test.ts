import { describe, expect, it } from 'vitest';
import { beforeIdForInsertion } from './insertionPosition';

describe('insertion position', () => {
  const ids = ['a', 'moving', 'b', 'c'];
  it('空集合と移動元だけの集合の先頭・末尾はbeforeIdなしになる', () => {
    for (const ordered of [[], ['moving']]) {
      expect(beforeIdForInsertion(ordered, 'moving', { kind: 'prepend' })).toBeUndefined();
      expect(beforeIdForInsertion(ordered, 'moving', { kind: 'append' })).toBeUndefined();
    }
  });
  it('移動元の直前のafterは移動元を飛ばし、無効な基準は拒否する', () => {
    expect(beforeIdForInsertion(ids, 'moving', { kind: 'after', nodeId: 'a' })).toBe('b');
    for (const nodeId of ['moving', 'missing']) {
      expect(() => beforeIdForInsertion(ids, 'moving', { kind: 'before', nodeId })).toThrow();
      expect(() => beforeIdForInsertion(ids, 'moving', { kind: 'after', nodeId })).toThrow();
    }
  });
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
