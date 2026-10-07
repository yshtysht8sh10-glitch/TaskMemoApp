// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ConflictComparison } from './ConflictComparison';
import { OwnershipReconcilePanel } from './OwnershipReconcilePanel';
import { planOwnershipReconcile } from '../sync/ownershipReconcile';
vi.mock('react-native', () => ({ Platform: { OS: 'web' },
  View: ({ children, style }: { children: React.ReactNode; style: React.CSSProperties }) => <div style={style}>{children}</div>,
  Text: ({ children, style }: { children: React.ReactNode; style: React.CSSProperties | React.CSSProperties[] }) => <span style={Array.isArray(style) ? Object.assign({}, ...style) : style}>{children}</span>,
  Pressable: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => <button onClick={onPress}>{children}</button>,
}));
vi.mock('../theme/theme', () => ({ useAppTheme: () => ({ colors: { text: '#111', textSecondary: '#555', border: '#ddd', accent: '#046', memoBackground: '#ffe', memoText: '#111' } }) }));
it('renders changed body first, highlights its changed span, expands context and identical fields', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ConflictComparison local={{ body: '共通'.repeat(200) + '37万', ideasEnabled: true }} account={{ body: '共通'.repeat(200) + '40万', ideasEnabled: true }} />));
    expect(host.textContent).toContain('差分 1件'); expect(host.textContent).toContain('変更項目: body');
    expect(host.textContent).not.toContain('ideasEnabled'); expect(host.textContent).toContain('同一部分を省略');
    expect([...host.querySelectorAll('span')].filter(s => s.style.textDecorationLine === 'underline').map(s => s.textContent)).toEqual(['37', '40']);
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '全文を表示')!.click());
    expect(host.textContent).toContain('共通'.repeat(200));
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '同一項目 1件を表示')!.click());
    expect(host.textContent).toContain('＝ 同一項目: ideasEnabled');
    expect(host.innerHTML).toContain('overflow-wrap: anywhere');
    await act(async () => root.render(<ConflictComparison local={{ a: null }} account={{ a: null }} />));
    expect(host.textContent).toContain('実質差分0件');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
it('replaces only raw JSON display at the ownership boundary', () => {
  const source = readFileSync('src/components/OwnershipReconcilePanel.tsx', 'utf8');
  expect(source).toContain('<ConflictComparison local=');
  expect(source).not.toContain('JSON.stringify');
  expect(source).toContain("setChoices(c => ({ ...c, [item.id]: 'local' }))");
  expect(source).toContain("setChoices(c => ({ ...c, [item.id]: 'account' }))");
  expect(source).toContain('commit(choices, { fingerprint: plan.fingerprint, deletedIds })');
});
it('Issue 94 hides the same profile from review and retains explicit choice for a real profile conflict', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const source = { scope: 'anonymous', nodes: {}, profile: { body: 'same', ideasEnabled: true } };
  const metadata = { revision: 8, lastOpId: 'op', lastDeviceId: 'd', lastLocalSeq: 8 };
  const target = { pinnedNote: { ...metadata, value: { body: 'same' } }, features: { ...metadata, value: { ideasEnabled: true } } };
  const callbacks = { review: vi.fn(async () => {}), commit: vi.fn(async () => {}), skip: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  try {
    await act(async () => root.render(<OwnershipReconcilePanel count={1} recovery={false} plan={planOwnershipReconcile(source, {}, undefined, 'account', target)} {...callbacks} />));
    expect(host.textContent).toContain('確認対象: 0件'); expect(host.textContent).not.toContain('ローカルを採用');
    const plan = planOwnershipReconcile({ ...source, profile: { ...source.profile, body: 'different' } }, {}, undefined, 'account', target);
    await act(async () => root.render(<OwnershipReconcilePanel count={1} recovery={false} plan={plan} {...callbacks} />));
    expect(host.textContent).toContain('確認対象: 1件');
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'ローカルを採用')!.click());
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '選択内容を確認して取り込む')!.click());
    expect(callbacks.commit).toHaveBeenCalledWith({ $profile: 'local' }, { fingerprint: plan.fingerprint, deletedIds: [] });
  } finally { await act(async () => root.unmount()); host.remove(); }
});
