import { IDBFactory } from 'fake-indexeddb';
import { expect, it, vi } from 'vitest';
import { createNode } from '../domain/nodeOperations';
import { setFolderColor } from '../domain/folderColor';
import { nodeToFirestore, nodeFromFirestore } from '../services/firebaseNodeCodec';
import { IndexedDbTaskMemoApplicationJournal } from './indexedDbApplicationStorage';
import { TaskMemoV2ApplicationStore } from './taskMemoApplicationStore';
import { InMemoryRevisionServer } from './revisionModel';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async () => null, setItem: async () => {}, removeItem: async () => {},
} }));
const at = new Date('2026-10-22T01:00:00Z');
const seed = () => createNode(createNode(createNode([], 'category', { title: 'A', parentId: null }, at, 'a'),
  'category', { title: 'B', parentId: null }, at, 'b'), 'memo', { title: 'child', parentId: 'a' }, at, 'm');

it('keeps independent colors, IDs and child metadata through IndexedDB restart, undo/redo and V2 server delivery to another device', async () => {
  const factory = new IDBFactory();
  const persistence = await IndexedDbTaskMemoApplicationJournal.open('colors-a', factory);
  let a = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: 'a' });
  await a.command('seed', 'create', () => seed());
  const child = a.nodes.find(n => n.id === 'm');
  await a.command('blue', 'update', nodes => setFolderColor(nodes, 'a', 'blue', at));
  await a.command('yellow', 'update', nodes => setFolderColor(nodes, 'b', 'yellow', at));
  expect(a.nodes.find(n => n.id === 'm')).toEqual(child);
  a = await TaskMemoV2ApplicationStore.open(await IndexedDbTaskMemoApplicationJournal.open('colors-a', factory), [], { deviceId: 'ignored' });
  expect(a.nodes.find(n => n.id === 'a')).toMatchObject({ folderColor: 'blue' });
  expect(a.nodes.find(n => n.id === 'b')).toMatchObject({ folderColor: 'yellow' });
  await a.undo(); expect(a.nodes.find(n => n.id === 'b')).not.toHaveProperty('folderColor', 'yellow');
  await a.redo(); expect(a.nodes.find(n => n.id === 'b')).toMatchObject({ folderColor: 'yellow' });
  await a.command('reset', 'update', nodes => setFolderColor(nodes, 'a', null, at));
  const b = await TaskMemoV2ApplicationStore.open(await IndexedDbTaskMemoApplicationJournal.open('colors-b', factory), [], { deviceId: 'b' });
  const server = new InMemoryRevisionServer();
  for (const op of [...a.outbox]) {
    const ack = server.apply(op);
    if (!ack.record) throw new Error('Missing server record');
    await a.acknowledge(op.opId, ack.record);
    await b.receive(ack.record);
  }
  expect(b.nodes.find(n => n.id === 'a')).toMatchObject({ folderColor: null });
  expect(b.nodes.find(n => n.id === 'b')).toMatchObject({ folderColor: 'yellow' });
  for (const node of b.nodes) expect(nodeFromFirestore(node.id, nodeToFirestore(node))).toEqual(node);
  expect(b.nodes.find(n => n.id === 'm')).toEqual(child);
  await a.undo(); expect(a.nodes.find(n => n.id === 'a')).toMatchObject({ folderColor: 'blue' });
  await a.redo(); expect(a.nodes.find(n => n.id === 'a')).toMatchObject({ folderColor: null });
});

it('accepts legacy absence and rejects special, deleted, virtual, memo and unknown color targets', () => {
  const nodes = seed();
  expect(nodes[0]).not.toHaveProperty('folderColor');
  expect(setFolderColor(nodes, 'a', null)).toBe(nodes);
  for (const categoryKind of ['routineRoot', 'routineDaily', 'routineWeekly', 'routineMonthly', 'routineYearly'] as const)
    expect(() => setFolderColor(nodes.map(n => n.id === 'a' ? { ...n, categoryKind } : n), 'a', 'red')).toThrow();
  expect(() => setFolderColor(nodes, 'virtual', 'blue')).toThrow();
  expect(() => setFolderColor(nodes, 'm', 'blue')).toThrow();
  expect(() => setFolderColor(nodes.map(n => ({ ...n, deletedAt: at })), 'a', 'blue')).toThrow();
  expect(() => setFolderColor(nodes, 'a', 'invalid' as never)).toThrow();
});
