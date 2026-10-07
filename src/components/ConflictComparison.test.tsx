// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ConflictComparison } from './ConflictComparison';
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
