// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { WebSortableScrollList } from './WebSortableScrollList';
import { dropCandidateFor, treeEndDropCandidate } from '../domain/treeDrop';
import { moveNode, siblingsOf } from '../domain/nodeOperations';
import type { CategoryNode, Node } from '../models/node';
import { WEB_DRAG_ACTIVATION_DELAY_MS } from '../domain/dragActivation';
vi.mock('react-native', async () => {
  const React = await import('react');
  return { StyleSheet: { create: (s: unknown) => s }, View: (p: { children: React.ReactNode }) => React.createElement('div', {}, p.children) };
});
vi.mock('../domain/dragAutoScroll', () => ({ createDragAutoScroller: () => ({ start() {}, stop() {}, update() {} }) }));
const now = new Date(2026, 9, 7);
const cat = (id: string, parentId: string | null, sortKey: string): CategoryNode => ({ id, parentId, sortKey, type: 'category', title: id, createdAt: now, updatedAt: now, deletedAt: null });
it.each(['mouse', 'touch'] as const)('[65-UI-TAIL] %s tail indicator and commit share the root append candidate', async mode => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  let nodes: Node[] = [cat('moving', null, 'a0'), cat('last', null, 'a1'), cat('child', 'last', 'a0')];
  const rows = nodes.map(node => ({ node }));
  const hover = vi.fn(), drop = vi.fn();
  try {
    await act(async () => root.render(<WebSortableScrollList data={rows} keyFor={r => r.node.id} canDrag={() => true} canDropAfter={() => true} distinguishBeforeTarget renderItem={r => r.node.title}
      onHover={() => {}} onDrop={() => { throw new Error('tail must use the tail command'); }}
      onTailHover={active => hover(treeEndDropCandidate(nodes, active.node.id, rows))}
      onTailDrop={active => { const candidate = treeEndDropCandidate(nodes, active.node.id, rows)!; drop(candidate); nodes = moveNode(nodes, active.node.id, candidate.parentId, candidate.beforeId); }} />));
    const moving = host.querySelector('[data-taskmemo-dnd-key="moving"] [draggable]')!;
    const tail = host.querySelector('[data-taskmemo-dnd-tail]')!;
    const dispatch = async (target: EventTarget, type: string, patch: object = {}) => {
      const event = new Event(type, { bubbles: true, cancelable: true }); Object.assign(event, patch);
      await act(async () => { target.dispatchEvent(event); });
    };
    if (mode === 'mouse') {
      await dispatch(moving, 'dragstart', { clientX: 10, clientY: 10 });
      await dispatch(tail, 'dragover', { clientX: 10, clientY: 300 });
    } else {
      const touch = { identifier: 1, clientX: 10, clientY: 10 };
      await dispatch(moving, 'touchstart', { touches: [touch] });
      await act(async () => vi.advanceTimersByTime(WEB_DRAG_ACTIVATION_DELAY_MS));
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => tail) });
      await dispatch(document, 'touchmove', { touches: [{ ...touch, clientY: 300 }] });
    }
    expect(host.querySelector('[data-taskmemo-dnd-tail-indicator]')).toBeTruthy();
    const expected = hover.mock.calls.at(-1)![0];
    if (mode === 'mouse') await dispatch(tail, 'drop');
    else await dispatch(document, 'touchend', { changedTouches: [{ identifier: 1, clientX: 10, clientY: 300 }] });
    expect(drop).toHaveBeenCalledWith(expected);
    expect(siblingsOf(nodes, null).map(n => n.id)).toEqual(['last', 'moving']);
    expect(nodes[2].parentId).toBe('last');
    expect(host.querySelector('[data-taskmemo-dnd-tail-indicator]')).toBeNull();
  } finally {
    await act(async () => root.unmount()); host.remove(); Reflect.deleteProperty(document, 'elementFromPoint'); vi.restoreAllMocks(); vi.useRealTimers();
  }
});
it('[65-UI-INSIDE] category middle zone commits nest target including an existing child', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  let nodes: Node[] = [cat('moving', null, 'a0'), cat('target', null, 'a1'), cat('child', 'target', 'a0')];
  const hover = vi.fn();
  try {
    await act(async () => root.render(<WebSortableScrollList data={nodes} keyFor={n => n.id} canDrag={() => true} canDropAfter={() => true} distinguishBeforeTarget renderItem={n => n.title}
      onHover={(a, t, p) => hover(dropCandidateFor(nodes, a.id, t, p))} onDrop={(a, t, p) => { const c = dropCandidateFor(nodes, a.id, t, p)!; nodes = moveNode(nodes, a.id, c.parentId, c.beforeId); }} />));
    const active = host.querySelector('[data-taskmemo-dnd-key="moving"] [draggable]')!;
    const target = host.querySelector('[data-taskmemo-dnd-key="target"]')!;
    target.getBoundingClientRect = () => ({ top: 100, height: 100 }) as DOMRect;
    await act(async () => active.dispatchEvent(new Event('dragstart', { bubbles: true })));
    const event = new Event('dragover', { bubbles: true, cancelable: true }); Object.assign(event, { clientY: 150, clientX: 10 });
    await act(async () => target.dispatchEvent(event));
    expect(hover.mock.calls.at(-1)![0]).toMatchObject({ kind: 'inside', parentId: 'target', beforeId: 'child' });
    await act(async () => target.dispatchEvent(new Event('drop', { bubbles: true })));
    expect(siblingsOf(nodes, 'target').map(n => n.id)).toEqual(['moving', 'child']);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
