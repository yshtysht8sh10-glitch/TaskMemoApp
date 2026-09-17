import { describe, expect, it } from 'vitest';
import { commitNodeHistory, createNodeHistory, NODE_HISTORY_LIMIT, reconcileSyncedNodeHistory, redoNodeHistory, replaceNodeHistory, undoNodeHistory } from './nodeHistory';
import type { Node } from '@/models/node';
import { mergeNodesByUpdatedAt } from '../services/firebaseNodeCodec';

const node = (title = 'A'): Node => ({ id: 'a', type: 'category', parentId: null, sortKey: 'a0', title, createdAt: new Date(0), updatedAt: new Date(0), deletedAt: null });

describe('node history', () => {
  it('undoes and redoes one semantic operation', () => {
    const initial = createNodeHistory([node()]);
    const changed = commitNodeHistory(initial, '編集', (nodes) => nodes.map((item) => ({ ...item, title: 'B' })));
    expect(changed.past).toHaveLength(1);
    expect(undoNodeHistory(changed).nodes[0].title).toBe('A');
    expect(redoNodeHistory(undoNodeHistory(changed)).nodes[0].title).toBe('B');
  });

  it('does not record no-ops and clears redo after a new operation', () => {
    const changed = commitNodeHistory(createNodeHistory([node()]), '編集', (nodes) => nodes.map((item) => ({ ...item, title: 'B' })));
    const undone = undoNodeHistory(changed);
    expect(commitNodeHistory(undone, 'no-op', (nodes) => nodes).future).toHaveLength(1);
    expect(commitNodeHistory(undone, '別の編集', (nodes) => nodes.map((item) => ({ ...item, title: 'C' }))).future).toHaveLength(0);
  });

  it('caps history and replacement clears it', () => {
    let history = createNodeHistory([node()]);
    for (let i = 0; i < NODE_HISTORY_LIMIT + 5; i += 1) history = commitNodeHistory(history, '編集', (nodes) => nodes.map((item) => ({ ...item, title: String(i) })));
    expect(history.past).toHaveLength(NODE_HISTORY_LIMIT);
    expect(replaceNodeHistory(history, [node('reset')]).past).toHaveLength(0);
  });

  it('keeps undo and redo history when Firebase echoes the same nodes in another order', () => {
    const second = { ...node('second'), id: 'b', sortKey: 'b0' };
    const initial = createNodeHistory([node(), second]);
    const changed = commitNodeHistory(initial, 'タイトル編集', (nodes) =>
      nodes.map((item) => item.id === 'a' ? { ...item, title: 'edited' } : item),
    );
    const echoed = reconcileSyncedNodeHistory(changed, [...changed.nodes].reverse());
    expect(echoed).toBe(changed);
    expect(undoNodeHistory(echoed).nodes.find((item) => item.id === 'a')?.title).toBe('A');
  });

  it('keeps title undo and redo after Firebase merge echoes a memo without routine history', () => {
    const before: Node = {
      id: 'memo', type: 'memo', parentId: null, sortKey: 'a0', title: 'before', body: '',
      dueAt: null, duePreset: 'none', status: 'active', completedAt: null,
      createdAt: new Date(0), updatedAt: new Date(0), deletedAt: null,
    };
    const edited = commitNodeHistory(createNodeHistory([before]), 'タイトル編集', (nodes) =>
      nodes.map((item) => item.id === 'memo'
        ? { ...item, title: 'after', updatedAt: new Date(1) }
        : item),
    );

    const firebaseEcho = mergeNodesByUpdatedAt(edited.nodes, edited.nodes);
    const reconciled = reconcileSyncedNodeHistory(edited, firebaseEcho);

    expect(reconciled.past).toHaveLength(1);
    const undone = undoNodeHistory(reconciled);
    expect(undone.nodes[0].title).toBe('before');
    expect(redoNodeHistory(undone).nodes[0].title).toBe('after');
  });

  it('clears local history for a genuinely different external node set', () => {
    const changed = commitNodeHistory(createNodeHistory([node()]), '編集', (nodes) =>
      nodes.map((item) => ({ ...item, title: 'local' })),
    );
    const reconciled = reconcileSyncedNodeHistory(changed, [node('remote')]);
    expect(reconciled.nodes[0].title).toBe('remote');
    expect(reconciled.past).toHaveLength(0);
    expect(reconciled.future).toHaveLength(0);
  });
});
