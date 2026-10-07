// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { generateNKeysBetween } from 'fractional-indexing';
import { OwnershipReconcilePanel } from './OwnershipReconcilePanel';
import { planOwnershipReconcile } from '../sync/ownershipReconcile';
import { TaskMemoV2ApplicationStore } from '../sync/taskMemoApplicationStore';
import type { ApplicationJournalPersistence } from '../sync/applicationStore';
import type { SyncNodeValue } from '../sync/types';
vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Pressable: ({ children, onPress, disabled }: { children: React.ReactNode; onPress: () => void; disabled: boolean }) => <button disabled={disabled} onClick={onPress}>{children}</button>,
}));
vi.mock('../theme/theme', () => ({ useAppTheme: () => ({ colors: { text: '#111', border: '#ddd' } }) }));
const node = (id: string, sortKey: string, title = id) => ({ id, type: 'category', title, parentId: null, sortKey, createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', deletedAt: null });
const record = (value: SyncNodeValue, revision = 1) => ({ value, revision, operationType: 'update' as const, lastDeviceId: 'remote', lastOpId: 'remote:' + revision, lastLocalSeq: revision });
class Memory implements ApplicationJournalPersistence {
  value: string | null = null; journal: string | null = null;
  loadCommitted = async () => this.value; loadJournal = async () => this.journal;
  writeCommitted = async (v: string) => { this.value = v; }; writeJournal = async (v: string) => { this.journal = v; };
  clearJournal = async () => { this.journal = null; };
  writeAtomic = async (expected: string | null, value: string) => { if (this.value !== expected) throw Error('atomic'); this.value = value; };
}
describe('Issue 95 bulk ownership selection', () => {
  it.each(['local', 'account'] as const)('selects 120 conflicts as %s, keeps per-item overrides across rerender, never commits on selection', async side => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const keys = generateNKeysBetween(null, null, 120);
    const nodes = Object.fromEntries(keys.map((k, i) => [String(i), node(String(i), k)]));
    const target = Object.fromEntries(Object.values(nodes).map(n => [n.id, record({ ...n, title: 'remote ' + n.id })]));
    const plan = planOwnershipReconcile({ scope: 'anonymous', nodes, profile: { body: '', ideasEnabled: false } }, target, undefined, 'account');
    const before = JSON.stringify(plan); const commit = vi.fn(async () => {});
    const props = { count: 120, recovery: false, plan, commit, review: vi.fn(async () => {}), skip: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const host = document.createElement('div'); const root = createRoot(host);
    const click = async (name: string) => { await act(async () => { const b = [...host.querySelectorAll('button')].find(b => b.textContent === name); expect(b, name).toBeDefined(); b!.click(); }); };
    try {
      await act(async () => root.render(<OwnershipReconcilePanel {...props} />));
      await click(side === 'local' ? 'すべてローカルを採用' : 'すべてアカウントを採用');
      expect([...host.querySelectorAll('button')].filter(b => b.textContent === (side === 'local' ? '✓ ローカルを採用' : '✓ アカウントを採用'))).toHaveLength(120);
      expect(commit).not.toHaveBeenCalled(); expect(props.skip).not.toHaveBeenCalled(); expect(JSON.stringify(plan)).toBe(before);
      await click(side === 'local' ? 'アカウントを採用' : 'ローカルを採用');
      await act(async () => root.render(<OwnershipReconcilePanel {...props} count={121} />));
      await click('選択内容を確認して取り込む');
      const choices = Object.fromEntries(Object.keys(nodes).map(id => [id, id === '0' ? (side === 'local' ? 'account' : 'local') : side]));
      expect(commit).toHaveBeenCalledWith(choices, { fingerprint: plan.fingerprint, deletedIds: [] });
    } finally { await act(async () => root.unmount()); }
  });
  it('excludes same/add/apply, respects disabled local adoption, includes a real profile conflict', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const nodes = { a: node('a', 'a0'), same: node('same', 'a1'), add: node('add', 'a2'), apply: node('apply', 'a3'), purged: node('purged', 'a4') };
    const plan = planOwnershipReconcile({ scope: 'anonymous', nodes, profile: { body: 'different', ideasEnabled: false } }, { a: record({ ...nodes.a, title: 'remote' }), same: record(nodes.same), purged: record({ ...nodes.purged, deletedAt: '2026-10-03T00:00:00.000Z', purgedAt: '2026-10-04T00:00:00.000Z' }) }, undefined, 'account');
    plan.items.find(i => i.id === 'apply')!.kind = 'apply';
    const commit = vi.fn(async () => {}); const host = document.createElement('div'); const root = createRoot(host);
    const click = async (name: string) => { await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === name)!.click()); };
    try {
      await act(async () => root.render(<OwnershipReconcilePanel count={6} recovery={false} plan={plan} commit={commit} review={async () => {}} skip={async () => {}} close={async () => {}} />));
      await click('すべてローカルを採用');
      expect([...host.querySelectorAll('button')].filter(b => b.textContent === '✓ ローカルを採用')).toHaveLength(2);
      await click('すべてアカウントを採用');
      expect([...host.querySelectorAll('button')].filter(b => b.textContent === '✓ アカウントを採用')).toHaveLength(3);
      expect([...host.querySelectorAll('button')].find(b => b.textContent === '選択内容を確認して取り込む')!.disabled).toBe(true);
      expect(commit).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); }
  });
  it('UI bulk selection leaves durable state untouched and stale remote revision still blocks final commit', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const p = new Memory(); const store = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'account-device' });
    const a = node('a', 'a0'); await store.receive(record({ ...a, title: 'account' }));
    const plan = store.prepareOwnership({ scope: 'anonymous', nodes: { a }, profile: { body: '', ideasEnabled: false } }, 'account');
    const before = p.value; const commit = vi.fn(async (choices: Record<string, 'local' | 'account'>) => { await store.commitOwnership(plan, choices); });
    const host = document.createElement('div'); const root = createRoot(host);
    const click = async (name: string) => { await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === name)!.click()); };
    try {
      await act(async () => root.render(<OwnershipReconcilePanel count={1} recovery={false} plan={plan} commit={commit} review={async () => {}} skip={async () => {}} close={async () => {}} />));
      await click('すべてローカルを採用'); expect(p.value).toBe(before); expect(store.outbox).toEqual([]); expect(store.historyDepths.past).toBe(0);
      await store.receive(record({ ...a, title: 'remote changed' }, 2)); const changed = p.value;
      await click('選択内容を確認して取り込む');
      expect(commit).toHaveBeenCalledOnce(); expect(p.value).toBe(changed); expect(store.outbox).toEqual([]); expect(store.historyDepths.past).toBe(0);
      expect(host.textContent).toMatch(/最新|変わ|変更|無効/);
    } finally { await act(async () => root.unmount()); }
  });
});
