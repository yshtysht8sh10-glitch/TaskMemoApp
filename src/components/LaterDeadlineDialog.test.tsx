// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { LaterDeadlineDialog } from './LaterDeadlineDialog';
vi.mock('react-native', () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Pressable: ({ children, disabled, onPress }: { children: React.ReactNode; disabled: boolean; onPress: () => void }) =>
    <button disabled={disabled} onClick={onPress}>{children}</button>,
}));
vi.mock('../theme/theme', () => ({ useAppTheme: () => ({ colors: {} }) }));

it.each(['confirm', 'custom', 'cancel', 'failure', 'yearEnd'] as const)('requires confirmation, %s (#102)', async mode => {
  vi.useFakeTimers(); const now = mode === 'yearEnd' ? new Date(2026, 11, 31, 10) : new Date(2026, 9, 26, 10); vi.setSystemTime(now);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const confirm = vi.fn(async () => mode !== 'failure'), cancel = vi.fn();
  const click = async (label: string) => act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === label)!.click(); });
  try {
    await act(async () => root.render(<LaterDeadlineDialog title="Memo" now={now} onConfirm={confirm} onCancel={cancel} />));
    expect(confirm).not.toHaveBeenCalled();
    expect(host.textContent).toContain('2027/01/01 23:59');
    if (mode === 'cancel') { await click('キャンセル'); expect(cancel).toHaveBeenCalledOnce(); expect(confirm).not.toHaveBeenCalled(); }
    else if (mode === 'yearEnd') {
      expect([...host.querySelectorAll('button')].find(b => b.textContent === 'この期限に変更する')!.disabled).toBe(true);
      expect(host.textContent).toContain('日時を指定してください');
    } else if (mode === 'custom') {
      await click('別の日時を指定する');
      const date = host.querySelector('input[type="date"]') as HTMLInputElement;
      const time = host.querySelector('input[type="time"]') as HTMLInputElement;
      const set = async (input: HTMLInputElement, value: string) => act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await set(date, '2032-02-29'); await set(time, '15:30');
      expect(confirm).not.toHaveBeenCalled(); await click('この日時に変更する');
      expect(confirm).toHaveBeenCalledWith(new Date(2032, 1, 29, 15, 30));
    } else {
      await click('この期限に変更する');
      expect(confirm).toHaveBeenCalledWith(new Date(2027, 0, 1, 23, 59));
      if (mode === 'failure') expect(host.textContent).toContain('保存できませんでした');
    }
  } finally { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); }
});
