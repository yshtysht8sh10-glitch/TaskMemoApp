import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbTaskMemoApplicationJournal } from './indexedDbApplicationStorage';
import { TaskMemoV2ApplicationStore } from './taskMemoApplicationStore';
import { InMemoryRevisionServer } from './revisionModel';
import { createNode, updateNode } from '../domain/nodeOperations';
import { completeRoutineDefinition, resumeRoutineDefinition, isRoutineDefinitionCompleted } from '../domain/routineLifecycle';
import { missedRoutineOccurrences } from '../domain/routine';
import type { MemoNode } from '../models/node';
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }));

it('preserves definition lifecycle, pending tasks and Undo/Redo through IndexedDB restart and concurrent V2 sync', async () => {
  const factory = new IDBFactory();
  const persistence = await IndexedDbTaskMemoApplicationJournal.open('issue109', factory);
  const at = new Date(2026, 9, 1, 8);
  let a = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: 'a', now: () => at });
  let b = await TaskMemoV2ApplicationStore.open(await IndexedDbTaskMemoApplicationJournal.open('other', factory), [], { deviceId: 'b' });
  const server = new InMemoryRevisionServer();
  const flush = async (source: TaskMemoV2ApplicationStore, target: TaskMemoV2ApplicationStore) => {
    for (const op of source.outbox) {
      const ack = server.apply(op); await source.acknowledge(op.opId, ack.record); await target.receive(ack.record!);
    }
  };
  const parentId = await a.ensureRoutineRoot();
  await a.command('create', 'create', n => createNode(n, 'memo', { title: 'daily', parentId, dueAt: new Date(2026, 9, 1, 9), duePreset: 'custom', repeatRule: { frequency: 'day', interval: 1, startsOn: '2026-10-01' } }, at, 'm'));
  await flush(a, b);
  await a.command('finish', 'update', n => completeRoutineDefinition(n, 'm', new Date(2026, 9, 3, 8)));
  // B edits a stale definition before receiving A's completion.
  await b.command('body', 'update', n => updateNode(n, 'm', { body: 'from other device' }));
  await flush(a, b); await flush(b, a);
  const definition = (s: TaskMemoV2ApplicationStore) => s.nodes.find(n => n.id === 'm') as MemoNode;
  expect(isRoutineDefinitionCompleted(definition(a))).toBe(true);
  expect(isRoutineDefinitionCompleted(definition(b))).toBe(true);
  a = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: 'ignored' });
  expect(isRoutineDefinitionCompleted(definition(a))).toBe(true);
  await a.command('resume', 'update', n => resumeRoutineDefinition(n, 'm', new Date(2026, 9, 6, 10)));
  await flush(a, b);
  expect(missedRoutineOccurrences(a.nodes, definition(a), new Date(2026, 9, 7)).map(n => n.routineOccurrenceKey)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  await a.undo(); await flush(a, b);
  expect(isRoutineDefinitionCompleted(definition(b))).toBe(true);
  await a.redo(); await flush(a, b);
  expect(isRoutineDefinitionCompleted(definition(b))).toBe(false);
});
