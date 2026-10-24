// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MemoCreateButton } from './MemoCreateButton';
vi.mock('react-native', () => ({
  Pressable: (p: { children: React.ReactNode; onPress: () => void; disabled?: boolean; accessibilityLabel: string }) =>
    <button aria-label={p.accessibilityLabel} disabled={p.disabled} onClick={p.onPress}>{p.children}</button>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
it('explains a blocked add without creating, then opens exactly once after permission changes', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const onCreate = vi.fn(), onBlocked = vi.fn();
  try {
    await act(async () => { root.render(<MemoCreateButton editable={false} onCreate={onCreate} onBlocked={onBlocked} />); });
    await act(async () => { host.querySelector('button')!.click(); });
    expect(onBlocked).toHaveBeenCalledOnce(); expect(onCreate).not.toHaveBeenCalled();
    await act(async () => { root.render(<MemoCreateButton editable onCreate={onCreate} onBlocked={onBlocked} />); });
    await act(async () => { host.querySelector('button')!.click(); });
    expect(onCreate).toHaveBeenCalledOnce(); expect(onBlocked).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
