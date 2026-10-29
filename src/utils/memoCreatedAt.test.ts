import { expect, it } from 'vitest';
import { memoCreatedAtLabel } from './memoCreatedAt';
import { createNode, updateNode } from '../domain/nodeOperations';
import { nodeFromFirestore, nodeToFirestore } from '../services/firebaseNodeCodec';
import { parseNodeBackup, serializeNodeBackup } from '../services/nodeBackup';

it('displays the stored creation date in local time without using another timestamp', () => {
  expect(memoCreatedAtLabel(new Date(2026, 9, 30, 3, 4))).toBe('作成日時: 2026/10/30 03:04');
  expect(memoCreatedAtLabel(undefined)).toBe('作成日時: 不明');
  expect(memoCreatedAtLabel(new Date('invalid'))).toBe('作成日時: 不明');
  expect(memoCreatedAtLabel(undefined, true)).toBe('定義の作成日時: 不明');
});

it('preserves actual creation time through body/deadline changes, cloud codec and backup restore', () => {
  const created = new Date(2026, 9, 30, 3, 4);
  const initial = createNode([], 'memo', { title: 'Memo', parentId: null }, created, 'test');
  const edited = updateNode(initial, 'test', { body: 'changed', dueAt: new Date(2027, 0, 1) }, new Date(2026, 10, 1));
  const restored = parseNodeBackup(serializeNodeBackup(edited));
  const cloud = nodeFromFirestore('test', nodeToFirestore(restored[0]));
  expect(cloud.createdAt).toEqual(created);
  expect(memoCreatedAtLabel(cloud.createdAt)).toBe(memoCreatedAtLabel(initial[0].createdAt));
});
