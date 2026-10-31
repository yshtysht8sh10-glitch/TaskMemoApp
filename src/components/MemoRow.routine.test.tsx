// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MemoRow } from './MemoRow';
import type { InlineTitleEditController } from '../hooks/useInlineTitleEdit';
import { createNode, ensureRoutineCategories } from '../domain/nodeOperations';
import { completeRoutineDefinition } from '../domain/routineLifecycle';
import type { MemoNode } from '../models/node';

vi.mock('react-native', () => ({
  Platform: { OS: 'web' }, StyleSheet: { create: (s: unknown) => s },
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Pressable: ({ children, onPress, onLongPress, accessibilityLabel, accessibilityRole, disabled }: {
    children: React.ReactNode; onPress?: React.MouseEventHandler; onLongPress?: () => void;
    accessibilityLabel?: string; accessibilityRole?: string; disabled?: boolean;
  }) => <div role={accessibilityRole} aria-label={accessibilityLabel} aria-disabled={disabled}
    onClick={disabled ? undefined : onPress} onContextMenu={onLongPress}>{children}</div>,
}));
vi.mock('../theme/theme', () => ({ useAppTheme: () => ({ colors: {} }) }));
vi.mock('./FormTextInput', () => ({ FormTextInput: () => null }));
vi.mock('./CompletionMotion', () => ({ CompletionMotion: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./MemoTitleTap', () => ({ MemoTitleTap: ({ children, onSingle }: { children: React.ReactNode; onSingle: () => void }) => <span onClick={onSingle}>{children}</span> }));

it.each(['active-definition', 'completed-definition', 'task', 'daily-projection'] as const)(
  '%s has the correct actions while preserving menu, open and drag callbacks', async kind => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const now = new Date(2026, 9, 31, 8);
    let nodes = ensureRoutineCategories([]);
    const parentId = nodes.find(n => n.type === 'category' && n.categoryKind === 'routineRoot')!.id;
    nodes = createNode(nodes, 'memo', { title: 'example', parentId, repeatRule: { frequency: 'day', interval: 1, startsOn: '2026-10-01' } }, now, 'm');
    if (kind === 'completed-definition') nodes = completeRoutineDefinition(nodes, 'm', now);
    const original = nodes.find(n => n.id === 'm') as MemoNode;
    const routine = kind.endsWith('definition');
    const memo = kind === 'task' ? { ...original, parentId: null, repeatRule: null }
      : kind === 'daily-projection' ? { ...original, routineSourceId: 'm', routineOccurrenceKey: '2026-10-31' } : original;
    const saved = JSON.stringify(memo), complete = vi.fn(), menu = vi.fn(), open = vi.fn(), drag = vi.fn();
    function Row() {
      const titleEdit: InlineTitleEditController = { activeId: null, begin() {}, blur() {}, cancel() {}, changeDraft() {}, draft: '', editing: false, nativeID: 'idle', submit: async () => {} };
      return <MemoRow memo={memo} depth={1} ancestorContinuation={[true]} hasNextSibling now={now.getTime()}
        routine={routine} titleEdit={titleEdit} mobileTitleEditor={false} onComplete={complete} onMenu={menu}
        onOpen={open} onLongPress={drag} onQuickTitle={() => {}} onCompletionAnimationFinished={() => {}} />;
    }
    const host = document.createElement('div'), root = createRoot(host);
    try {
      await act(async () => root.render(<Row />));
      const button = host.querySelector('[aria-label="exampleを完了"]') as HTMLElement | null;
      expect(!!button).toBe(!routine);
      if (button) { await act(async () => button.click()); expect(complete).toHaveBeenCalledOnce(); }
      const menuButton = host.querySelector('[aria-label="exampleのメニュー"]') as HTMLElement;
      expect(menuButton).not.toBeNull();
      await act(async () => menuButton.click()); expect(menu).toHaveBeenCalledOnce();
      // The row retains its editor and long-press entry points without touching domain data.
      open.mockClear();
      await act(async () => host.querySelector('[aria-label]')!.parentElement!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
      expect(drag).toHaveBeenCalledOnce();
      await act(async () => [...host.querySelectorAll('span')].find(e => e.textContent === 'example')!.click());
      expect(open).toHaveBeenCalled();
      expect(JSON.stringify(memo)).toBe(saved);
    } finally { await act(async () => root.unmount()); }
  },
);
