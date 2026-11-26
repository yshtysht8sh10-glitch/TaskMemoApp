// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RoutineHistoryPanel } from './RoutineHistoryPanel';
import type { MemoNode } from '../models/node';
const theme = vi.hoisted(() => ({ resolved: 'light', colors: { text: '#222b36', textSecondary: '#68737e', accent: '#40566c' } }));
const flatten = (style: unknown): React.CSSProperties => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
vi.mock('react-native', () => ({
  StyleSheet: { create: (s: unknown) => s },
  View: ({ children, style, testID, accessibilityElementsHidden }: { children?: React.ReactNode; style?: unknown; testID?: string; accessibilityElementsHidden?: boolean }) => <div data-testid={testID} aria-hidden={accessibilityElementsHidden || undefined} style={flatten(style)}>{children}</div>,
  Text: ({ children, style, testID }: { children?: React.ReactNode; style?: unknown; testID?: string }) => <span data-testid={testID} style={flatten(style)}>{children}</span>,
  Pressable: ({ children, onPress, accessibilityLabel }: { children: React.ReactNode; onPress: () => void; accessibilityLabel: string }) => <button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>,
}));
vi.mock('../theme/theme', () => ({ useAppTheme: () => theme }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it.each(['light', 'dark'])('%s: keeps dates neutral, applies matching result/icon colors and fixed geometry without writes', async mode => {
  const now = new Date(2026, 10, 26, 12); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  theme.resolved = mode; theme.colors.text = mode === 'dark' ? '#edf1f5' : '#222b36';
  theme.colors.textSecondary = mode === 'dark' ? '#aeb8c3' : '#68737e';
  const memo: MemoNode = { id: 'synthetic', type: 'memo', title: 'synthetic', body: '', parentId: 'r', sortKey: 'a0',
    createdAt: now, updatedAt: now, deletedAt: null, status: 'active', completedAt: null, dueAt: null, duePreset: 'none',
    repeatRule: { frequency: 'day', interval: 1, startsOn: '2026-11-24' },
    routineHistory: { '2026-11-25': now.toISOString() }, routineOutcomes: { '2026-11-24': { state: 'skipped', changedAt: now.toISOString(), version: 1 } } };
  const raw = JSON.stringify(memo), host = document.createElement('div'), root = createRoot(host), toggle = vi.fn();
  try {
    await act(async () => root.render(<RoutineHistoryPanel memo={memo} onToggle={toggle} />));
    const colors = { completed: mode === 'dark' ? 'rgb(114, 216, 154)' : 'rgb(24, 114, 60)', skipped: mode === 'dark' ? 'rgb(237, 241, 245)' : 'rgb(0, 0, 0)', pending: mode === 'dark' ? 'rgb(174, 184, 195)' : 'rgb(104, 115, 126)' };
    for (const state of ['completed', 'skipped', 'pending'] as const) {
      const icon = host.querySelector(`[data-testid="routine-result-icon-${state}"]`) as HTMLElement;
      const result = host.querySelector(`[data-testid="routine-result-label-${state}"]`) as HTMLElement;
      expect(icon).toBeTruthy(); expect(icon.style.borderColor).toBe(colors[state]); expect(result.style.color).toBe(colors[state]);
      expect(icon.style.width).toBe('18px'); expect(icon.style.height).toBe('18px'); expect(icon.getAttribute('aria-hidden')).toBe('true');
      expect((result.parentElement as HTMLElement).style.color).toBe(mode === 'dark' ? 'rgb(237, 241, 245)' : 'rgb(34, 43, 54)');
    }
    expect(host.querySelector('[data-testid="routine-result-label-pending"]')?.textContent).toBe('-');
    expect(host.querySelector('[data-testid="routine-result-icon-completed"]')?.textContent).toBe('✓');
    expect((host.querySelector('[data-testid="routine-result-icon-completed"] span') as HTMLElement).style.color).toBe(colors.completed);
    expect((host.querySelector('[data-testid="skip-triangle"]') as HTMLElement).style.borderLeftColor).toBe(colors.skipped);
    expect((host.querySelector('[data-testid="skip-bar"]') as HTMLElement).style.backgroundColor).toBe(colors.skipped);
    expect(host.textContent).not.toContain('未達');
    expect(JSON.stringify(memo)).toBe(raw); expect(toggle).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); vi.useRealTimers(); }
});
