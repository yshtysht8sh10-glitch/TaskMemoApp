// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RoutineResultActions } from './RoutineResultActions';
vi.mock('react-native', () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Pressable: ({ children, onPress, disabled, accessibilityLabel }: { children: React.ReactNode; onPress: () => void; disabled?: boolean; accessibilityLabel: string }) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>,
  StyleSheet: { create: (s: unknown) => s },
}));
vi.mock('../theme/theme', () => ({ useAppTheme: () => ({ colors: { text: 'black', accent: 'blue' } }) }));
it('states are explicit text, selected state is disabled, cancellation is pending, rendering never writes', async () => {
  const host = document.createElement('div'), root = createRoot(host), select = vi.fn();
  try {
    await act(async () => root.render(<RoutineResultActions dateKey="2026-11-25" state="missed" onSelect={select} />));
    expect(host.textContent).toContain('2026-11-25 未達');
    expect(select).not.toHaveBeenCalled();
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons.map(b => b.textContent)).toEqual(['完了', 'スキップ', '未達', '結果を取り消す']);
    expect(buttons[2].disabled).toBe(true);
    await act(async () => buttons[3].click()); expect(select).toHaveBeenLastCalledWith('pending');
    await act(async () => buttons[0].click()); expect(select).toHaveBeenLastCalledWith('completed');
  } finally { await act(async () => root.unmount()); }
});
