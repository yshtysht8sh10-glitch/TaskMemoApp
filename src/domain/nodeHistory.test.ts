import { describe, expect, it } from 'vitest';
import { commitNodeHistory, createNodeHistory, NODE_HISTORY_LIMIT, redoNodeHistory, replaceNodeHistory, undoNodeHistory } from './nodeHistory';
import type { Node } from '@/models/node';

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
});
