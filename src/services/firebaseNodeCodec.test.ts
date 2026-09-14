import { describe, expect, it } from 'vitest';
import type { MemoNode } from '@/models/node';
import { mergeNodesByUpdatedAt, nodeFromFirestore, nodeToFirestore } from './firebaseNodeCodec';

const memo = (id: string, updatedAt: Date): MemoNode => ({ id, type: 'memo', parentId: null, sortKey: id, title: id, body: '', dueAt: null, duePreset: 'none', status: 'active', completedAt: null, createdAt: new Date(0), updatedAt, deletedAt: null });

describe('Firebase Node boundary', () => {
  it('DateをTimestampへ変換し、読み込み時にDateへ戻す', () => { const source = memo('a', new Date('2026-01-02T03:04:05Z')); const encoded = nodeToFirestore(source); const decoded = nodeFromFirestore('a', encoded); expect(decoded.updatedAt).toEqual(source.updatedAt); expect(decoded.type).toBe('memo'); if (decoded.type === 'memo') expect(decoded.dueAt).toBeNull(); });
  it('同じIDはupdatedAtが新しい側を採用し、片側だけのNodeを保持する', () => { const local = [memo('shared', new Date(20)), memo('local', new Date(10))]; const remote = [memo('shared', new Date(30)), memo('remote', new Date(10))]; const merged = mergeNodesByUpdatedAt(local, remote); expect(merged.map((node) => node.id).sort()).toEqual(['local', 'remote', 'shared']); expect(merged.find((node) => node.id === 'shared')?.updatedAt).toEqual(new Date(30)); });
  it('ローカル側が新しい場合はクラウド内容で上書きしない', () => { const merged = mergeNodesByUpdatedAt([memo('a', new Date(30))], [memo('a', new Date(20))]); expect(merged[0].updatedAt).toEqual(new Date(30)); });
});
