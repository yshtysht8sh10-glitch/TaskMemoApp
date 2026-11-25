// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { RoutineHistoryPanel } from './RoutineHistoryPanel';
import type { MemoNode } from '../models/node';
import { localDateKey, routineHistoryDays } from '../domain/routine';

vi.mock('react-native', () => ({
  StyleSheet: { create: (s: unknown) => s },
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Pressable: ({ children, onPress, accessibilityLabel }: { children: React.ReactNode; onPress: () => void; accessibilityLabel: string }) => <button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>,
}));
vi.mock('../theme/theme', () => ({ useAppTheme: () => ({ colors: {} }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const now = new Date(2026, 10, 25, 12);
const task = (count: number, id = 'r1'): MemoNode => ({
  id, type: 'memo', title: '同名', body: '', parentId: 'r', sortKey: 'a0', createdAt: now, updatedAt: now, deletedAt: null,
  status: 'active', completedAt: null, dueAt: null, duePreset: 'none', repeatRule: null,
  routineHistory: Object.fromEntries(Array.from({ length: count }, (_, i) => [localDateKey(new Date(2026, 10, 24 - i)), now.toISOString()])),
});
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); vi.useRealTimers(); });
async function mount(memo: MemoNode) {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host), toggle = vi.fn();
  const render = async (next: MemoNode) => act(async () => root.render(<RoutineHistoryPanel key={next.id} memo={next} onToggle={toggle} />));
  await render(memo);
  cleanup = async () => { await act(async () => root.unmount()); host.remove(); };
  const click = async (label: string) => { const button = [...host.querySelectorAll('button')].find(b => b.textContent === label)!; expect(button).toBeTruthy(); await act(async () => button.click()); };
  const dates = () => [...host.querySelectorAll('span')].map(e => e.textContent!).filter(s => /^\d{4}-\d{2}-\d{2} /.test(s));
  return { host, toggle, click, dates, render };
}
it('starts compact and expands in pages to every stored date without omissions or writes', async () => {
  const memo = task(125), before = JSON.stringify(memo);
  const { host, toggle, click, dates } = await mount(memo);
  expect(dates()).toHaveLength(7);
  await click('すべての履歴を表示'); expect(dates()).toHaveLength(50);
  await click('さらに履歴を表示'); expect(dates()).toHaveLength(100);
  await click('さらに履歴を表示'); expect(dates()).toHaveLength(125);
  expect(new Set(dates()).size).toBe(125);
  expect(dates()).toEqual(routineHistoryDays(memo, now, Infinity).map(d => `${d.key} 完了`));
  expect(host.textContent).not.toContain('さらに履歴を表示');
  await click('直近の履歴に戻す'); expect(dates()).toHaveLength(7);
  expect(toggle).not.toHaveBeenCalled(); expect(JSON.stringify(memo)).toBe(before);
});
it.each([0, 1, 7])('handles %i records without fabricating rows or an unnecessary expand action', async count => {
  const { host, dates, toggle } = await mount(task(count));
  expect(dates()).toHaveLength(count); expect(host.textContent).not.toContain('すべての履歴を表示');
  if (!count) expect(host.textContent).toContain('保存済みの実績はありません');
  expect(toggle).not.toHaveBeenCalled();
});
it('mixes legacy completion and skip, deduplicates today, excludes future and cancelled records', async () => {
  const memo = task(1); memo.repeatRule = { frequency: 'week', interval: 1, startsOn: '2026-11-25' };
  memo.routineHistory!['2026-11-25'] = now.toISOString();
  memo.routineHistory!['2026-12-01'] = now.toISOString();
  memo.routineOutcomes = { '2026-11-24': { state: 'pending', changedAt: now.toISOString(), version: 2 },
    '2026-11-03': { state: 'skipped', changedAt: now.toISOString(), version: 1 } };
  const { dates, toggle, host } = await mount(memo);
  expect(dates()).toEqual(['2026-11-25 完了', '2026-11-03 スキップ']);
  const button = host.querySelector('button[aria-label="2026-11-25の完了を取り消す"]') as HTMLButtonElement;
  await act(async () => button.click());
  expect(toggle).toHaveBeenCalledExactlyOnceWith(memo.id, new Date(2026, 10, 25));
});
it('shows only the generated pending today row and keeps actions attached to the stable ID', async () => {
  const memo = task(0); memo.repeatRule = { frequency: 'day', interval: 1, startsOn: '2026-11-25' };
  const { dates, host, toggle } = await mount(memo);
  expect(dates()).toEqual(['2026-11-25 -']);
  await act(async () => (host.querySelector('button') as HTMLButtonElement).click());
  expect(toggle).toHaveBeenCalledExactlyOnceWith('r1', new Date(2026, 10, 25));
});
it('resets compact mode for a same-name different Routine and re-open', async () => {
  const { click, dates, render } = await mount(task(60));
  await click('すべての履歴を表示'); expect(dates()).toHaveLength(50);
  await render(task(80, 'r2')); expect(dates()).toHaveLength(7);
  await render(task(60)); expect(dates()).toHaveLength(7);
});
it('refreshes expanded results after received updates without duplicating today', async () => {
  const memo = task(60), { click, dates, render, toggle } = await mount(memo);
  await click('すべての履歴を表示');
  await render({ ...memo, routineHistory: { ...memo.routineHistory, '2026-11-25': now.toISOString() } });
  expect(dates()).toHaveLength(50); expect(dates()[0]).toBe('2026-11-25 完了');
  await click('さらに履歴を表示'); expect(dates()).toHaveLength(61);
  expect(new Set(dates()).size).toBe(61); expect(toggle).not.toHaveBeenCalled();
});
it('refreshes a same-length row when its received outcome changes', async () => {
  const memo = task(1), { dates, render, host } = await mount(memo);
  expect(dates()).toEqual(['2026-11-24 完了']);
  await render({ ...memo, routineOutcomes: { '2026-11-24': { state: 'skipped', changedAt: now.toISOString(), version: 1 } } });
  expect(dates()).toEqual(['2026-11-24 スキップ']);
  expect(host.querySelector('button[aria-label="2026-11-24の完了を取り消す"]')).toBeNull();
});
it('rechecks today after a date boundary even when the memo object stays unchanged', async () => {
  const memo = task(0); memo.repeatRule = { frequency: 'day', interval: 1, startsOn: '2026-11-25' };
  const { dates, render } = await mount(memo);
  expect(dates()).toEqual(['2026-11-25 -']);
  vi.setSystemTime(new Date(2026, 10, 26, 0, 1)); await render(memo);
  expect(dates()).toEqual(['2026-11-26 -']);
});
