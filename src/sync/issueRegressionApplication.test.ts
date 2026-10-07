import { expect, it } from 'vitest';
import { TaskMemoV2ApplicationStore } from './taskMemoApplicationStore';
import type { ApplicationJournalPersistence } from './applicationStore';
import { createNode, moveNode, siblingsOf } from '../domain/nodeOperations';
import { dropCandidateFor } from '../domain/treeDrop';
import { deadlineGroups } from '../domain/deadlineView';
import { toggleRoutineCompletion } from '../domain/routine';
class Memory implements ApplicationJournalPersistence {
  value: string | null = null; journal: string | null = null; fail = false;
  loadCommitted = async () => this.value; loadJournal = async () => this.journal;
  writeJournal = async (value: string) => { if (this.fail) throw new Error('atomic'); this.journal = value; };
  clearJournal = async () => { this.journal = null; };
  writeCommitted = async (value: string) => { this.value = value; };
  writeAtomic = async (expected: string | null, value: string) => {
    if (this.fail || expected !== this.value) throw new Error('atomic'); this.value = value;
  };
}
const at = new Date(2026, 9, 3, 8);
it('[65-APPLICATION] domain category drop is atomic with one History, Outbox, Undo/Redo and restart', async () => {
  const p = new Memory();
  let store = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'local', now: () => at });
  for (const [id, parentId] of [['a', null], ['b', null], ['child', 'a']] as const)
    await store.command('create', 'create', nodes => createNode(nodes, 'category', { title: id, parentId }, at, id));
  const original = store.nodes;
  const outboxCount = store.outbox.length, history = store.historyDepths.past;
  const move = () => store.command('category drop', 'update', nodes => {
    const target = nodes.find(n => n.id === 'b')!;
    const c = dropCandidateFor(nodes, 'a', target, 'on')!;
    return moveNode(nodes, 'a', c.parentId, c.beforeId, new Date(at.getTime()+1));
  });
  p.fail = true;
  await expect(move()).rejects.toThrow('atomic');
  expect(store.nodes).toEqual(original); expect(store.outbox).toHaveLength(outboxCount); expect(store.historyDepths.past).toBe(history);
  p.fail = false; await move();
  expect(store.historyDepths.past).toBe(history+1); expect(store.outbox).toHaveLength(outboxCount+1);
  expect(store.nodes.find(n => n.id === 'a')).toMatchObject({ parentId: 'b', title: 'a', createdAt: at });
  expect(store.nodes.find(n => n.id === 'child')).toEqual(original.find(n => n.id === 'child'));
  await store.undo(new Date(at.getTime()+2)); expect(store.nodes.find(n => n.id === 'a')?.parentId).toBeNull();
  await store.redo(new Date(at.getTime()+3)); expect(store.nodes.find(n => n.id === 'a')?.parentId).toBe('b');
  const saved = store.nodes;
  store = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'ignored' });
  expect(store.nodes).toEqual(saved); expect(siblingsOf(store.nodes, 'b').map(n => n.id)).toEqual(['a']);
});
it('[71-APPLICATION] old virtual occurrence completion modifies only source history through V2 and survives restart/Undo/Redo', async () => {
  const p = new Memory();
  let store = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'local', now: () => at });
  const parentId = await store.ensureRoutineRoot();
  await store.command('routine', 'create', nodes => createNode(nodes, 'memo', { title: 'daily', parentId, repeatRule: { frequency: 'day', interval: 1, startsOn: '2026-10-03' }, dueAt: new Date(2026, 9, 3, 9), duePreset: 'custom' }, at, 'routine'));
  const now = new Date(2026, 9, 5, 8);
  const persisted = p.value, count = store.outbox.length, depth = store.historyDepths.past;
  const old = () => deadlineGroups(store.nodes, now).find(g => g.key === 'overdue')!.memos.map(n => n.routineOccurrenceKey);
  expect(old()).toEqual(['2026-10-03', '2026-10-04']);
  expect(p.value).toBe(persisted); expect(store.outbox).toHaveLength(count); expect(store.historyDepths.past).toBe(depth);
  await store.command('complete old occurrence', 'update', nodes => toggleRoutineCompletion(nodes, 'routine', at, now));
  expect(old()).toEqual(['2026-10-04']); expect(store.nodes).toHaveLength(2);
  expect(store.historyDepths.past).toBe(depth+1); expect(store.outbox).toHaveLength(count+1);
  await store.undo(new Date(now.getTime()+1)); expect(old()).toEqual(['2026-10-03', '2026-10-04']);
  await store.redo(new Date(now.getTime()+2)); expect(old()).toEqual(['2026-10-04']);
  store = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'ignored' });
  expect(old()).toEqual(['2026-10-04']);
  expect(store.nodes.find(n => n.id === 'routine')).toMatchObject({ status: 'active', completedAt: null, repeatRule: { startsOn: '2026-10-03' } });
});
