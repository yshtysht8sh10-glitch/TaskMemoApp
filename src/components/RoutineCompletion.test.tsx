// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { CompletedRoutines, RoutineCompletionButton } from './RoutineCompletion';
import { appAlert } from '../utils/appAlert';
import { completeRoutineDefinition, resumeRoutineDefinition } from '../domain/routineLifecycle';
import { createNode, ensureRoutineCategories } from '../domain/nodeOperations';
import type { Node } from '../models/node';
vi.mock('react-native', () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Pressable: ({ children, onPress, disabled }: { children: React.ReactNode; onPress: () => void; disabled: boolean }) => <button disabled={disabled} onClick={onPress}>{children}</button>,
}));
vi.mock('../theme/theme', () => ({ useAppTheme: () => ({ colors: {} }) }));
vi.mock('../utils/appAlert', () => ({ appAlert: vi.fn() }));

it('requires confirmation and removes the completed definition from its list after resume', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'), root = createRoot(host), complete = vi.fn(async () => true);
  let nodes: Node[] = ensureRoutineCategories([]);
  const parentId = nodes.find(n => n.type === 'category' && n.categoryKind === 'routineRoot')!.id;
  nodes = createNode(nodes, 'memo', { title: 'daily', parentId, repeatRule: { frequency: 'day', interval: 1, startsOn: '2026-10-01' } }, new Date(2026, 9, 1), 'm');
  try {
    await act(async () => root.render(<RoutineCompletionButton onComplete={complete} />));
    await act(async () => host.querySelector('button')!.click());
    expect(complete).not.toHaveBeenCalled();
    const buttons = vi.mocked(appAlert).mock.calls.at(-1)![2]!;
    expect(buttons[0].style).toBe('cancel');
    await act(async () => { await buttons[1].onPress?.(); });
    expect(complete).toHaveBeenCalledOnce();
    nodes = completeRoutineDefinition(nodes, 'm', new Date(2026, 9, 2));
    const render = () => root.render(<CompletedRoutines nodes={nodes} onResume={async id => {
      nodes = resumeRoutineDefinition(nodes, id, new Date(2026, 9, 3)); render(); return true;
    }} />);
    await act(async () => render());
    expect(host.textContent).toContain('daily');
    expect(host.textContent).toContain('完了を取り消す');
    await act(async () => host.querySelector('button')!.click());
    expect(host.textContent).not.toContain('daily');
    expect(host.textContent).toContain('項目はありません');
  } finally { await act(async () => root.unmount()); }
});
