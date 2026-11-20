// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { TaskSearch } from './TaskSearch';
import type { MemoNode } from '../models/node';

vi.mock('react-native', () => ({
  StyleSheet: { create: (value: unknown) => value },
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Modal: ({ children, onRequestClose }: { children: React.ReactNode; onRequestClose: () => void }) => <section data-modal onKeyDown={e => { if (e.key === 'BrowserBack') onRequestClose(); }}>{children}</section>,
  Pressable: ({ children, onPress, disabled, accessibilityLabel }: { children: React.ReactNode; onPress: () => void; disabled?: boolean; accessibilityLabel: string }) => <button disabled={disabled} aria-label={accessibilityLabel} onClick={onPress}>{children}</button>,
  FlatList: ({ data, renderItem, ListEmptyComponent }: { data: { key: string }[]; renderItem: (value: { item: unknown }) => React.ReactNode; ListEmptyComponent: React.ReactNode }) => <div>{data.length ? data.map(item => <React.Fragment key={item.key}>{renderItem({ item })}</React.Fragment>) : ListEmptyComponent}</div>,
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock('../theme/theme', () => ({ useAppTheme: () => ({ colors: {} }) }));
vi.mock('./FormTextInput', () => ({ FormTextInput: ({ value, onChangeText, accessibilityLabel }: { value: string; onChangeText: (text: string) => void; accessibilityLabel: string }) => <input aria-label={accessibilityLabel} value={value} onInput={e => onChangeText(e.currentTarget.value)} /> }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const now = new Date(2026, 10, 21);
const nodes: MemoNode[] = ['a', 'b'].map(id => ({ id, type: 'memo', title: '集合写真', parentId: null,
  sortKey: 'a0', createdAt: now, updatedAt: now, deletedAt: null, body: '', dueAt: now,
  duePreset: 'custom', status: 'active', completedAt: null }));
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

async function mount(editable = true) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host), open = vi.fn(), close = vi.fn();
  await act(async () => root.render(<TaskSearch nodes={nodes} editable={editable} onOpenMemo={open} onClose={close} />));
  cleanup = async () => { await act(async () => root.unmount()); host.remove(); };
  const input = host.querySelector('input')!;
  const type = async (text: string) => { await act(async () => {
    input.value = text; input.dispatchEvent(new Event('input', { bubbles: true }));
  }); };
  const receive = async (next: MemoNode[]) => act(async () => root.render(<TaskSearch nodes={next} editable={editable} onOpenMemo={open} onClose={close} />));
  return { host, input, open, close, type, receive };
}

it('Japanese composition and Enter do not submit, dismiss, or open a task', async () => {
  const { input, host, open, close, type } = await mount();
  await act(async () => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await type('しゅう');
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
  expect(open).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  await act(async () => input.dispatchEvent(new CompositionEvent('compositionend', { data: '集合', bubbles: true })));
  await type('集合');
  expect(host.textContent).toContain('2件');
  expect(input.value).toBe('集合');
});
it('opens the exact selected same-name task without any persistence dependency', async () => {
  const before = JSON.stringify(nodes);
  const { host, open, type } = await mount(); await type('写真');
  const results = host.querySelectorAll('button[aria-label^="集合写真"]');
  expect(results).toHaveLength(2);
  await act(async () => (results[1] as HTMLButtonElement).click());
  expect(open).toHaveBeenCalledExactlyOnceWith(nodes[1]);
  expect(JSON.stringify(nodes)).toBe(before);
});
it('shows zero results, clears input, and provides an explicit return without changing data', async () => {
  const { host, input, close, open, type } = await mount(); await type('ありません');
  expect(host.textContent).toContain('該当する未完了タスクはありません');
  await act(async () => (host.querySelector('button[aria-label="検索文字をクリア"]') as HTMLButtonElement).click());
  expect(input.value).toBe(''); expect(open).not.toHaveBeenCalled();
  await act(async () => (host.querySelector('button[aria-label="検索を終了して元の画面へ戻る"]') as HTMLButtonElement).click());
  expect(close).toHaveBeenCalledOnce();
});
it('allows read-only search while startup editing is gated', async () => {
  const { host, type, open } = await mount(false); await type('写真');
  expect(host.textContent).toContain('2件');
  const result = host.querySelector('button[aria-label^="集合写真"]') as HTMLButtonElement;
  expect(result.disabled).toBe(true);
  await act(async () => result.click()); expect(open).not.toHaveBeenCalled();
});
it('refreshes results from received data without changing the query or opening stale rows', async () => {
  const { host, input, type, receive, open } = await mount(); await type('写真');
  await receive(nodes.map(node => ({ ...node, status: 'completed' })));
  expect(input.value).toBe('写真');
  expect(host.textContent).toContain('0件');
  expect(host.querySelector('button[aria-label^="集合写真"]')).toBeNull();
  expect(open).not.toHaveBeenCalled();
});
