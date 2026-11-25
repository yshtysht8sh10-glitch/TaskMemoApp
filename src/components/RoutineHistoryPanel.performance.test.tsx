// @vitest-environment jsdom
import React, { act, Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RoutineHistoryPanel } from './RoutineHistoryPanel';
import * as routine from '../domain/routine';
import type { MemoNode } from '../models/node';

const counters = vi.hoisted(() => ({ views: 0 }));
vi.mock('react-native', () => ({
  StyleSheet: { create: (s: unknown) => s },
  View: ({ children }: { children: React.ReactNode }) => { counters.views++; return <div>{children}</div>; },
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Pressable: ({ children, onPress, accessibilityLabel }: { children: React.ReactNode; onPress: () => void; accessibilityLabel: string }) => <button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>,
}));
vi.mock('../theme/theme', () => ({ useAppTheme: () => ({ colors: {} }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it.each([125, 5000])('profiles and isolates %i history rows from parent body edits and latest callbacks', async count => {
  const now = new Date(2026, 10, 25);
  const memo: MemoNode = { id: 'synthetic', type: 'memo', title: 'synthetic', body: '', parentId: 'r', sortKey: 'a0',
    createdAt: now, updatedAt: now, deletedAt: null, status: 'active', completedAt: null, dueAt: null, duePreset: 'none',
    routineHistory: Object.fromEntries(Array.from({ length: count }, (_, i) => [routine.localDateKey(new Date(2026, 10, 24 - i)), now.toISOString()])) };
  const host = document.createElement('div'), root = createRoot(host), durations: number[] = [], toggles = [vi.fn(), vi.fn()];
  document.body.append(host);
  const normalize = vi.spyOn(routine, 'routineHistoryDays');
  const render = async (value: MemoNode, callback = toggles[0]) => act(async () => root.render(<Profiler id="history" onRender={(_id, phase, duration) => { if (phase === 'update') durations.push(duration); }}><RoutineHistoryPanel memo={value} onToggle={callback} /></Profiler>));
  const click = async (label: string) => act(async () => (host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement).click());
  try {
    await render(memo); await click('すべての履歴を表示');
    while (host.querySelector('button[aria-label="さらに履歴を表示"]')) await click('さらに履歴を表示');
    durations.length = 0; normalize.mockClear(); counters.views = 0;
    for (let i = 0; i < 5; i++) await render(memo);
    const bodyOnly = { normalization: normalize.mock.calls.length, views: counters.views, durations: [...durations] };
    durations.length = 0; normalize.mockClear(); counters.views = 0;
    for (let i = 0; i < 5; i++) await render({ ...memo, body: `body ${i}`, routineHistory: { ...memo.routineHistory } }, toggles[1]);
    const savedClone = { normalization: normalize.mock.calls.length, views: counters.views, durations: [...durations] };
    console.log(JSON.stringify({ count, bodyOnly, savedClone, elements: host.querySelectorAll('*').length }));
    expect(bodyOnly.normalization).toBe(0);
    expect(bodyOnly.views).toBeLessThan(10);
    expect(savedClone.views).toBeLessThan(10);
    await click(`${routine.localDateKey(new Date(2026, 10, 24))}の完了を取り消す`);
    expect(toggles[0]).not.toHaveBeenCalled(); expect(toggles[1]).toHaveBeenCalledOnce();
  } finally { normalize.mockRestore(); await act(async () => root.unmount()); host.remove(); }
}, 60000);

it('invalidates cached action dates on a zone-context change without needing a new memo', async () => {
  const now = new Date(2026, 10, 25);
  const memo: MemoNode = { id: 'zone', type: 'memo', title: 'synthetic', body: '', parentId: 'r', sortKey: 'a0',
    createdAt: now, updatedAt: now, deletedAt: null, status: 'active', completedAt: null, dueAt: null, duePreset: 'none',
    routineHistory: { '2026-11-24': now.toISOString() } };
  const host = document.createElement('div'), root = createRoot(host), toggle = vi.fn();
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  let zone = 'Asia/Tokyo';
  const zoneSpy = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function(this: Intl.DateTimeFormat) {
    return { ...original.call(this), timeZone: zone };
  });
  const normalize = vi.spyOn(routine, 'routineHistoryDays');
  try {
    await act(async () => root.render(<RoutineHistoryPanel memo={memo} onToggle={toggle} />));
    normalize.mockClear(); zone = 'America/New_York';
    await act(async () => root.render(<RoutineHistoryPanel memo={memo} onToggle={toggle} />));
    expect(normalize).toHaveBeenCalledOnce();
  } finally { normalize.mockRestore(); zoneSpy.mockRestore(); await act(async () => root.unmount()); }
});
