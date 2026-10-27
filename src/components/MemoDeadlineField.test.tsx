// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { DuePreset } from '../models/node';
import { MemoDeadlineField } from './MemoDeadlineField';
import { memoDeadlineDraft } from '../utils/memoDeadline';
import { allDeadlineGroupIds } from '../domain/deadlineView';
vi.mock('react-native', () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Pressable: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => <button onClick={onPress}>{children}</button>,
}));
vi.mock('../theme/theme', () => ({ useAppTheme: () => ({ colors: {} }) }));
const styles = { chips: {}, chip: {}, chipOn: {}, chipText: {}, chipTextOn: {} };

it('uses the current display settings instead of showing disabled presets', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const change = vi.fn(), host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const config = { visibleGroupIds: new Set(['nextWeek' as const]), granularity: 'today' as const };
  try {
    await act(async () => root.render(<MemoDeadlineField preset="custom" custom="2030/08/14 15:12" styles={styles} onChange={change} {...config} />));
    expect([...host.querySelectorAll('button')].map(b => b.textContent)).not.toContain('来月');
    await act(async () => root.render(<MemoDeadlineField preset="custom" custom="2030/08/14 15:12" styles={styles} onChange={change} {...config} visibleGroupIds={new Set()} />));
    expect([...host.querySelectorAll('button')].map(b => b.textContent)).toEqual(['日時指定']);
    expect((host.querySelector('input[type="date"]') as HTMLInputElement).value).toBe('2030-08-14');
    await act(async () => root.render(<MemoDeadlineField preset="custom" custom="2030/08/14 15:12" styles={styles} onChange={change} {...config} visibleGroupIds={new Set(['nextMonth'])} />));
    expect([...host.querySelectorAll('button')].some(b => b.textContent?.startsWith('来月'))).toBe(true);
    expect([...host.querySelectorAll('button')].some(b => b.textContent?.startsWith('来週'))).toBe(false);
    expect(change).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('changes today granularity in the actual field without rewriting a legacy hidden deadline', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const change = vi.fn(), host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const visibleGroupIds = new Set(allDeadlineGroupIds());
  try {
    await act(async () => root.render(<MemoDeadlineField preset="afternoon" custom="2026/10/01 17:00" styles={styles} onChange={change} visibleGroupIds={visibleGroupIds} granularity="amPm" />));
    let labels = [...host.querySelectorAll('button')].map(b => b.textContent);
    expect(labels).toContain('今日-午前（～12:00）'); expect(labels).toContain('今日-午後（～24:00）');
    expect(labels).not.toContain('午後まで'); expect(labels).not.toContain('今日中');
    await act(async () => root.render(<MemoDeadlineField preset="afternoon" custom="2026/10/01 17:00" styles={styles} onChange={change} visibleGroupIds={visibleGroupIds} granularity="threePart" />));
    labels = [...host.querySelectorAll('button')].map(b => b.textContent);
    expect(labels).toContain('今日-朝（～10:00）'); expect(labels).toContain('今日-昼（～17:00）'); expect(labels).toContain('今日-夜（～24:00）');
    expect(labels).not.toContain('今日-午前（～12:00）');
    expect((host.querySelector('input[type="date"]') as HTMLInputElement).value).toBe('2026-10-01');
    expect((host.querySelector('input[type="time"]') as HTMLInputElement).value).toBe('17:00');
    expect(change).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('always allows entering and saving a date in an OFF group, including when none is OFF', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), save = vi.fn();
  function EditorHarness() {
    const [preset, setPreset] = useState<DuePreset>('none'), [custom, setCustom] = useState('2030/08/14 15:12');
    return <><MemoDeadlineField preset={preset} custom={custom} styles={styles} visibleGroupIds={new Set()} granularity="today" onChange={(p, value) => {
      setPreset(p); if (value !== undefined) setCustom(value);
    }} /><button onClick={() => save(memoDeadlineDraft(preset, custom))}>保存</button></>;
  }
  try {
    await act(async () => root.render(<EditorHarness />));
    expect([...host.querySelectorAll('button')].map(b => b.textContent)).toEqual(['日時指定','保存']);
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === '日時指定')!.click(); });
    const input = host.querySelector('input[type="date"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '2035-06-01');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === '保存')!.click(); });
    expect(save).toHaveBeenCalledWith({ duePreset: 'custom', dueAt: new Date(2035,5,1,15,12) });
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it.each([
  ['来週', '2028-02-12'], ['来月', '2028-02-29'], ['来年', '2029-12-31'],
] as const)('the actual Memo field selects %s without emitting changes merely on open', async (label, expected) => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2028, 0, 31, 8));
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const change = vi.fn(), save = vi.fn();
  function EditorHarness() {
    const [preset, setPreset] = useState<DuePreset>('custom'), [custom, setCustom] = useState('2030/08/14 15:12');
    return <><MemoDeadlineField preset={preset} custom={custom} styles={styles} visibleGroupIds={new Set(allDeadlineGroupIds())} granularity="today" onChange={(p, value) => {
      change(p, value); setPreset(p); if (value !== undefined) setCustom(value);
    }} /><button onClick={() => save(memoDeadlineDraft(preset, custom))}>保存</button></>;
  }
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<EditorHarness />));
    expect(change).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
    expect((host.querySelector('input[type="date"]') as HTMLInputElement).value).toBe('2030-08-14');
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent?.startsWith(label))!.click(); });
    expect((host.querySelector('input[type="date"]') as HTMLInputElement).value).toBe(expected);
    expect((host.querySelector('input[type="time"]') as HTMLInputElement).value).toBe('23:59');
    // Saving after midnight must keep the selected concrete date.
    vi.setSystemTime(new Date(2028, 1, 1, 8));
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === '保存')!.click(); });
    const [year, month, day] = expected.split('-').map(Number);
    expect(save).toHaveBeenCalledWith({ duePreset: 'custom', dueAt: new Date(year, month - 1, day, 23, 59) });
  } finally { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); }
});
