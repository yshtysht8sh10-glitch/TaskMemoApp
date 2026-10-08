// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DeadlineView } from './DeadlineView';
import { deadlineGroups, moveMemoInDeadlineList } from '../domain/deadlineView';
import type { CategoryNode, MemoNode, Node } from '../models/node';
import { WEB_DRAG_ACTIVATION_DELAY_MS } from '../domain/dragActivation';

vi.mock('react-native', () => ({
  Platform: { OS: 'web' }, StyleSheet: { create: (s: unknown) => s },
  AppState: { addEventListener: () => ({ remove() {} }) },
  PanResponder: { create: () => ({ panHandlers: {} }) }, useWindowDimensions: () => ({ width: 1200 }),
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Pressable: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => <button onClick={onPress}>{children}</button>,
}));
vi.mock('react-native-draggable-flatlist', () => ({ default: () => null, ScaleDecorator: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('../theme/theme', () => ({ useAppTheme: () => ({ colors: {} }) }));
vi.mock('../domain/dragAutoScroll', () => ({ createDragAutoScroller: () => ({ start() {}, stop() {}, update() {} }) }));
vi.mock('../hooks/useInlineTitleEdit', () => ({ useInlineTitleEdit: () => ({ target: null, editing: null, begin() {}, propsFor: () => ({}) }) }));
vi.mock('./FormTextInput', () => ({ FormTextInput: () => null }));
vi.mock('./MemoRowActions', () => ({ MemoRowActions: () => null }));
vi.mock('./QuickTitleEditor', () => ({ QuickTitleEditor: () => null }));
vi.mock('./VerticalResizeHandle.web', () => ({ VerticalResizeHandle: () => null }));
vi.mock('./CountBadge', () => ({ CountBadge: () => null }));
vi.mock('./CompletionMotion', () => ({ CompletionMotion: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./MemoTitleTap', () => ({ MemoTitleTap: ({ children }: { children: React.ReactNode }) => children }));

it.each(['mouse', 'touch'] as const)('DeadlineView %s enables missed Routine drag and passes projection IDs to the real reorder command', async mode => {
  vi.useFakeTimers();
  const now = new Date(2026, 9, 5, 8); vi.setSystemTime(now);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const rootNode: CategoryNode = { id: 'r', type: 'category', categoryKind: 'routineRoot', parentId: null, sortKey: 'a0', title: 'routine', createdAt: now, updatedAt: now, deletedAt: null };
  const memo: MemoNode = { ...rootNode, id: 'm', type: 'memo', parentId: 'r', title: 'daily', body: '', dueAt: new Date(2026, 9, 3, 9), duePreset: 'custom', status: 'active', completedAt: null, repeatRule: { frequency: 'day', interval: 1, startsOn: '2026-10-03' } };
  let nodes: Node[] = [rootNode, memo];
  const old = 'routine-overdue:m:2026-10-03', next = 'routine-overdue:m:2026-10-04';
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const drop = vi.fn((id, group, beforeId) => { nodes = moveMemoInDeadlineList(nodes, id, group, beforeId, now); });
  const noop = () => {};
  const props = { nodes, visibleGroupIds: new Set(['overdue' as const, 'am' as const]), todayGranularity: 'amPm' as const, completingIds: new Set<string>(), onCompletionAnimationFinished: noop, showPinnedNote: false, pinnedNote: '', pinnedNoteHeight: 100, onPinnedNoteChange: noop, onPinnedNoteHeightChange: noop, expandedGroups: new Set(['overdue' as const]), onExpandedGroupsChange: noop, onQuickAdd: async () => true, onRenameMemo: async () => true, onOpenMemo: noop, onQuickTitle: noop, onComplete: noop, onMenu: noop, onDueDrop: drop, onBulkMove: noop, onBulkComplete: () => true, onBulkDelete: noop, onOpenDisplaySettings: noop };
  const dispatch = async (target: EventTarget, type: string, patch = {}) => { const event = new Event(type, { bubbles: true, cancelable: true }); Object.assign(event, patch); await act(async () => { target.dispatchEvent(event); }); };
  try {
    await act(async () => root.render(<DeadlineView {...props} />));
    const moving = host.querySelector(`[data-taskmemo-dnd-key="${old}"] [draggable]`) as HTMLElement;
    const target = host.querySelector(`[data-taskmemo-dnd-key="${next}"]`) as HTMLElement;
    expect(moving.draggable).toBe(true);
    target.getBoundingClientRect = () => ({ top: 100, bottom: 200, left: 0, right: 300, width: 300, height: 100, x: 0, y: 100, toJSON() {} });
    if (mode === 'mouse') {
      await dispatch(moving, 'dragstart', { clientX: 10, clientY: 10 });
      await dispatch(target, 'dragover', { clientX: 10, clientY: 190 });
      await dispatch(target, 'drop');
    } else {
      const touch = { identifier: 1, clientX: 10, clientY: 10 };
      await dispatch(moving, 'touchstart', { touches: [touch] });
      await act(async () => vi.advanceTimersByTime(WEB_DRAG_ACTIVATION_DELAY_MS));
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
      await dispatch(document, 'touchmove', { touches: [{ ...touch, clientY: 190 }] });
      await dispatch(document, 'touchend', { changedTouches: [{ ...touch, clientY: 190 }] });
    }
    expect(drop).toHaveBeenCalledWith(old, 'overdue', undefined);
    expect(deadlineGroups(nodes, now).find(g => g.key === 'overdue')!.memos.map(m => m.id)).toEqual([next, old]);
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '複数選択')!.click());
    expect((host.querySelector(`[data-taskmemo-dnd-key="${old}"] [draggable]`) as HTMLElement).draggable).toBe(false);
  } finally { await act(async () => root.unmount()); host.remove(); Reflect.deleteProperty(document, 'elementFromPoint'); vi.useRealTimers(); }
});

