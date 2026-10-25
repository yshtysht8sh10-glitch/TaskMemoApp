// @vitest-environment jsdom
import React, { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useEditorAutosave } from './useEditorAutosave';
import { createNode, updateNode } from '../domain/nodeOperations';
import { deadlineGroups } from '../domain/deadlineView';
import { routineRuleForSave } from '../utils/routineEditor';
import { TaskMemoV2ApplicationStore } from '../sync/taskMemoApplicationStore';
import { InMemoryRevisionServer } from '../sync/revisionModel';
import type { ApplicationJournalPersistence } from '../sync/applicationStore';
import type { MemoNode, RepeatFrequency } from '../models/node';

class Memory implements ApplicationJournalPersistence {
  value: string | null = null;
  loadCommitted = async () => this.value;
  loadJournal = async () => null;
  writeCommitted = async (value: string) => { this.value = value; };
  writeJournal = async () => {};
  clearJournal = async () => {};
  writeAtomic = async (expected: string | null, value: string) => {
    if (expected !== this.value) throw new Error('atomic conflict');
    this.value = value;
  };
}

it.each(['day', 'week', 'month', 'year'] as const)(
  'persists a return to the opening %s rule after another cycle autosaved (#101)', async opening => {
    vi.useFakeTimers();
    const now = new Date(2026, 9, 25, 10);
    vi.setSystemTime(now);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const persistence = new Memory();
    let store = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: 'a', now: () => now });
    const parentId = await store.ensureRoutineRoot();
    const rule = (frequency: RepeatFrequency) => routineRuleForSave(frequency, '1', '2026-10-24');
    await store.command('create', 'create', nodes => createNode(nodes, 'memo', {
      title: 'Routine', parentId, repeatRule: rule(opening),
    }, now, 'routine'));
    const other: RepeatFrequency = opening === 'day' ? 'month' : 'day';
    const server = new InMemoryRevisionServer();
    const remote = await TaskMemoV2ApplicationStore.open(new Memory(), [], { deviceId: 'b' });
    const flush = async () => {
      for (const op of store.outbox) {
        const ack = server.apply(op);
        await store.acknowledge(op.opId, ack.record);
        await remote.receive(ack.record!);
      }
    };
    await flush();
    const todayIds = (source = store, date = now) => deadlineGroups(source.nodes, date)
      .flatMap(group => group.memos).filter(memo => !memo.routineOccurrenceKey).map(memo => memo.id);
    const expectedToday = todayIds();
    function Editor() {
      const [frequency, setFrequency] = useState<RepeatFrequency>(opening);
      const [, refresh] = useState(0);
      const signature = JSON.stringify(rule(frequency));
      const committed = useRef(signature);
      useEditorAutosave(signature, 'routine', committed, async () => {
        await store.command('edit cycle', 'update', nodes => updateNode(nodes, 'routine', { repeatRule: rule(frequency) }, now));
        committed.current = signature;
        refresh(value => value + 1);
      });
      return <>
        <button onClick={() => setFrequency(other)}>other</button>
        <button onClick={() => setFrequency(opening)}>return</button>
        <output>{todayIds().join(',')}</output>
      </>;
    }
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const waitForSave = async () => act(async () => { await vi.advanceTimersByTimeAsync(600); });
    try {
      await act(async () => root.render(<Editor />));
      const depth = store.historyDepths.past;
      await waitForSave();
      expect(store.historyDepths.past).toBe(depth); // no edit on opening
      await act(async () => (host.querySelectorAll('button')[0] as HTMLElement).click());
      await waitForSave();
      expect((store.nodes.find(n => n.id === 'routine') as MemoNode).repeatRule).toEqual(rule(other));
      await act(async () => (host.querySelectorAll('button')[1] as HTMLElement).click());
      await waitForSave();
      expect((store.nodes.find(n => n.id === 'routine') as MemoNode).repeatRule).toEqual(rule(opening));
      expect(host.querySelector('output')!.textContent).toBe(expectedToday.join(','));
      expect(store.historyDepths.past).toBe(depth + 2);
      await flush();
      expect(todayIds(remote)).toEqual(expectedToday);
      const saved = store.nodes;
      store = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: 'ignored' });
      expect(store.nodes).toEqual(saved);
      expect(todayIds()).toEqual(expectedToday);
      expect(todayIds(store, new Date(2026, 9, 26, 10))).toEqual(opening === 'day' ? ['routine'] : []);
      await store.undo(new Date(now.getTime() + 1));
      expect((store.nodes.find(n => n.id === 'routine') as MemoNode).repeatRule).toEqual(rule(other));
      await store.redo(new Date(now.getTime() + 2));
      expect((store.nodes.find(n => n.id === 'routine') as MemoNode).repeatRule).toEqual(rule(opening));
    } finally {
      await act(async () => root.unmount()); host.remove(); vi.useRealTimers();
    }
  },
);
