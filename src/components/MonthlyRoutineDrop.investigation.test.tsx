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
vi.mock('./MemoRowActions', () => ({ MemoRowActions: ({ onMenu }: { onMenu: () => void }) => <span data-menu onClick={e => { e.stopPropagation(); onMenu(); }}>•••</span> }));
vi.mock('./QuickTitleEditor', () => ({ QuickTitleEditor: () => null }));
vi.mock('./VerticalResizeHandle.web', () => ({ VerticalResizeHandle: () => null }));
vi.mock('./CountBadge', () => ({ CountBadge: () => null }));
vi.mock('./CompletionMotion', () => ({ CompletionMotion: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./MemoTitleTap', () => ({ MemoTitleTap: ({ children }: { children: React.ReactNode }) => children }));

it.each(['mouse', 'touch'] as const)('synthetic monthly %s drop reaches tomorrow callback then Domain returns original nodes', async mode => {
  vi.useFakeTimers();
  const now = new Date(2026, 10, 13, 10); vi.setSystemTime(now);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const folder: CategoryNode = { id: 'r', type: 'category', categoryKind: 'routineRoot', parentId: null, sortKey: 'a0', title: 'synthetic', createdAt: now, updatedAt: now, deletedAt: null };
  const memo: MemoNode = { ...folder, type: 'memo', id: 'm', parentId: 'r', memoType: 'task',
    body: '', title: 'synthetic monthly', dueAt: new Date(2026, 10, 13, 23, 59), duePreset: 'custom',
    repeatRule: { frequency: 'month', interval: 1, startsOn: '2026-11-13' }, status: 'active', completedAt: null };
  let nodes: Node[] = [folder, memo]; const original = nodes;
  const drop = vi.fn((id, group, beforeId) => { nodes = moveMemoInDeadlineList(nodes, id, group, beforeId, now, 'threePart'); });
  const noop = () => {};
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const props = { nodes, visibleGroupIds: new Set(['evening' as const, 'tomorrow' as const, 'thisWeek' as const]), todayGranularity: 'threePart' as const, completingIds: new Set<string>(), onCompletionAnimationFinished: noop, showPinnedNote: false, pinnedNote: '', pinnedNoteHeight: 100, onPinnedNoteChange: noop, onPinnedNoteHeightChange: noop, expandedGroups: new Set(['evening' as const, 'tomorrow' as const]), onExpandedGroupsChange: noop, onQuickAdd: async () => true, onRenameMemo: async () => true, onOpenMemo: noop, onQuickTitle: noop, onComplete: noop, onMenu: noop, onDueDrop: drop, onBulkMove: noop, onBulkComplete: () => true, onBulkDelete: noop, onOpenDisplaySettings: noop };
  const dispatch = async (target: EventTarget, type: string, patch = {}) => {
    const event = new Event(type, { bubbles: true, cancelable: true }); Object.assign(event, patch);
    await act(async () => { target.dispatchEvent(event); });
  };
  try {
    await act(async () => root.render(<DeadlineView {...props} />));
    const moving = host.querySelector('[data-taskmemo-dnd-key="m"] [draggable]') as HTMLElement;
    const target = host.querySelector('[data-taskmemo-dnd-key="group-tomorrow"]') as HTMLElement;
    expect(moving).toBeTruthy(); expect(target).toBeTruthy();
    target.getBoundingClientRect = () => ({ top: 100, bottom: 150, left: 0, right: 300, width: 300, height: 50, x: 0, y: 100, toJSON() {} });
    if (mode === 'mouse') {
      await dispatch(moving, 'dragstart', { clientX: 10, clientY: 10 });
      await dispatch(target, 'dragover', { clientX: 10, clientY: 120 }); await dispatch(target, 'drop');
    } else {
      const touch = { identifier: 1, clientX: 10, clientY: 10 };
      await dispatch(moving, 'touchstart', { touches: [touch] });
      await act(async () => vi.advanceTimersByTime(WEB_DRAG_ACTIVATION_DELAY_MS));
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
      await dispatch(document, 'touchmove', { touches: [{ ...touch, clientY: 120 }] });
      await dispatch(document, 'touchend', { changedTouches: [{ ...touch, clientY: 120 }] });
    }
    expect(drop).toHaveBeenCalledWith('m', 'tomorrow', undefined);
    expect(nodes).toBe(original);
    expect(deadlineGroups(nodes, now, undefined, 'threePart').find(g => g.key === 'evening')?.memos.map(m => m.id)).toContain('m');
  } finally {
    await act(async () => root.unmount()); host.remove();
    Reflect.deleteProperty(document, 'elementFromPoint'); vi.useRealTimers();
  }
});

