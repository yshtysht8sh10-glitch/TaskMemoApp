// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { DuePreset } from '../models/node';
import { MemoDeadlineField } from './MemoDeadlineField';
import { memoDeadlineDraft } from '../utils/memoDeadline';
vi.mock('react-native', () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Pressable: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => <button onClick={onPress}>{children}</button>,
}));
vi.mock('../theme/theme', () => ({ useAppTheme: () => ({ colors: {} }) }));
const styles = { chips: {}, chip: {}, chipOn: {}, chipText: {}, chipTextOn: {} };

it.each([
  ['来週', '2028-02-12'], ['来月', '2028-02-29'], ['来年', '2029-12-31'],
] as const)('the actual Memo field selects %s without emitting changes merely on open', async (label, expected) => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2028, 0, 31, 8));
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const change = vi.fn(), save = vi.fn();
  function EditorHarness() {
    const [preset, setPreset] = useState<DuePreset>('custom'), [custom, setCustom] = useState('2030/08/14 15:12');
    return <><MemoDeadlineField preset={preset} custom={custom} styles={styles} onChange={(p, value) => {
      change(p, value); setPreset(p); if (value !== undefined) setCustom(value);
    }} /><button onClick={() => save(memoDeadlineDraft(preset, custom))}>保存</button></>;
  }
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<EditorHarness />));
    expect(change).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
    expect((host.querySelector('input[type="date"]') as HTMLInputElement).value).toBe('2030-08-14');
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === label)!.click(); });
    expect((host.querySelector('input[type="date"]') as HTMLInputElement).value).toBe(expected);
    expect((host.querySelector('input[type="time"]') as HTMLInputElement).value).toBe('23:59');
    // Saving after midnight must keep the selected concrete date.
    vi.setSystemTime(new Date(2028, 1, 1, 8));
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === '保存')!.click(); });
    const [year, month, day] = expected.split('-').map(Number);
    expect(save).toHaveBeenCalledWith({ duePreset: 'custom', dueAt: new Date(year, month - 1, day, 23, 59) });
  } finally { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); }
});
