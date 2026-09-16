import { describe, expect, it } from 'vitest';
import type { MemoNode } from '@/models/node';
import { applyRemoteDeletionsAsTombstones, mergeNodesByUpdatedAt, nodeFromFirestore, nodeToFirestore, withRemoteTombstones } from './firebaseNodeCodec';

const memo = (id: string, updatedAt: Date): MemoNode => ({ id, type: 'memo', parentId: null, sortKey: id, title: id, body: '', dueAt: null, duePreset: 'none', status: 'active', completedAt: null, createdAt: new Date(0), updatedAt, deletedAt: null });

describe('Firebase Node boundary', () => {
  it('DateをTimestampへ変換し、読み込み時にDateへ戻す', () => { const source = memo('a', new Date('2026-01-02T03:04:05Z')); const encoded = nodeToFirestore(source); const decoded = nodeFromFirestore('a', encoded); expect(decoded.updatedAt).toEqual(source.updatedAt); expect(decoded.type).toBe('memo'); if (decoded.type === 'memo') expect(decoded.dueAt).toBeNull(); });
  it('同じIDはupdatedAtが新しい側を採用し、片側だけのNodeを保持する', () => { const local = [memo('shared', new Date(20)), memo('local', new Date(10))]; const remote = [memo('shared', new Date(30)), memo('remote', new Date(10))]; const merged = mergeNodesByUpdatedAt(local, remote); expect(merged.map((node) => node.id).sort()).toEqual(['local', 'remote', 'shared']); expect(merged.find((node) => node.id === 'shared')?.updatedAt).toEqual(new Date(30)); });
  it('ローカル側が新しい場合はクラウド内容で上書きしない', () => { const merged = mergeNodesByUpdatedAt([memo('a', new Date(30))], [memo('a', new Date(20))]); expect(merged[0].updatedAt).toEqual(new Date(30)); });
  it('完全削除tombstoneは別端末のより新しい通常更新より優先する', () => { const purged = { ...memo('a', new Date(20)), deletedAt: new Date(20), purgedAt: new Date(20) }; const active = memo('a', new Date(30)); expect(mergeNodesByUpdatedAt([purged], [active])[0].purgedAt).toEqual(new Date(20)); expect(mergeNodesByUpdatedAt([active], [purged])[0].purgedAt).toEqual(new Date(20)); });
  it('完全削除tombstoneをFirestore境界でDateとして往復する', () => { const purged = { ...memo('a', new Date(20)), deletedAt: new Date(20), purgedAt: new Date(20) }; expect(nodeFromFirestore('a', nodeToFirestore(purged)).purgedAt).toEqual(new Date(20)); });
  it('ローカルから欠落したクラウドNodeを物理削除せずtombstoneにする', () => { const removed = memo('removed', new Date(10)); const kept = memo('kept', new Date(10)); const synchronized = withRemoteTombstones([kept], [kept, removed], new Date(20)); expect(synchronized.find((node) => node.id === 'removed')).toMatchObject({ deletedAt: new Date(20), purgedAt: new Date(20), updatedAt: new Date(20) }); });
  it('旧クライアントからの物理削除もtombstoneとして保持する', () => { const parent = memo('parent', new Date(10)); expect(applyRemoteDeletionsAsTombstones([parent], new Set(['parent']), new Date(20))[0]).toMatchObject({ deletedAt: new Date(20), purgedAt: new Date(20) }); });
  it('別端末が削除後に子を更新してもtombstoneを解除しない', () => { const childTombstone = { ...memo('child', new Date(20)), parentId: 'parent', deletedAt: new Date(20), purgedAt: new Date(20) }; const resentChild = { ...memo('child', new Date(30)), parentId: 'parent', title: '別端末の更新' }; expect(mergeNodesByUpdatedAt([childTombstone], [resentChild])[0]).toMatchObject({ purgedAt: new Date(20), title: 'child' }); });
});
