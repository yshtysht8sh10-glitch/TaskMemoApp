import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeText } from '../textFormat/session';
const data = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async (key: string) => data.get(key) ?? null,
  setItem: async (key: string, value: string) => { data.set(key, value); }, removeItem: async (key: string) => { data.delete(key); } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));
const source = JSON.stringify([{ id: 'memo', type: 'memo', title: 'Before', body: '', memoType: 'task', status: 'active', duePreset: 'none', dueAt: null, completedAt: null, parentId: null, sortKey: 'a0', createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', deletedAt: null }]);
describe('Local lifecycle with actual IndexedDB CAS', () => {
  beforeEach(() => { vi.resetModules(); data.clear(); vi.stubGlobal('indexedDB', new IDBFactory()); });
  it('stable identity and migration survive a JS process restart with durable History and Outbox', async () => {
    data.set('@taskmemo/nodes/v1', source);
    const first = await (await import('./localV2Application')).openCommonLocalApplication('development', { body: '', ideasEnabled: false });
    const session = first.store.beginTextEdit({ scope: first.scope, view: 'list', timeZone: 'Asia/Tokyo' });
    await first.store.commitTextEdit(first.store.prepareTextEdit(session, serializeText(session).replace('| Before |', '| After |')));
    expect(data.get('@taskmemo/nodes/v1')).toBe(source);
    vi.resetModules();
    const second = await (await import('./localV2Application')).openCommonLocalApplication('development', { body: '', ideasEnabled: false });
    expect(second.scope).toBe(first.scope); expect(second.store.deviceId).toBe(first.store.deviceId);
    expect(second.store.nodes[0].title).toBe('After'); expect(second.store.historyDepths.past).toBe(1); expect(second.store.outbox).toHaveLength(1);
    await second.store.undo(); expect(second.store.nodes[0].title).toBe('Before');
  });
  it('old V1 writer changes block save without losing either original', async () => {
    data.set('@taskmemo/nodes/v1', source);
    const local = await (await import('./localV2Application')).openCommonLocalApplication('development', { body: '', ideasEnabled: false });
    data.set('@taskmemo/nodes/v1', source.replace('Before', 'Legacy writer'));
    await expect(local.store.command('edit', 'update', nodes => nodes.map(n => ({ ...n, title: 'V2 change' })))).rejects.toThrow('V1 local writer');
    expect(local.store.nodes[0].title).toBe('Before'); expect(data.get('@taskmemo/nodes/v1')).toContain('Legacy writer');
  });
  it('one common writer and separate environment identities', async () => {
    const module = await import('./localV2Application');
    const a = await module.openCommonLocalApplication('development', { body: '', ideasEnabled: false });
    const b = await module.openCommonLocalApplication('development', { body: 'different', ideasEnabled: true });
    expect(a.store).toBe(b.store);
    const other = await module.openCommonLocalApplication('production', { body: '', ideasEnabled: false });
    expect(other.scope).not.toBe(a.scope); expect(other.store).not.toBe(a.store);
  });
  it('old V1 profile writes block Local saves while preserving the original profile backup', async () => {
    data.set('@taskmemo/nodes/v1', source);
    const local = await (await import('./localV2Application')).openCommonLocalApplication('development', { body: '', ideasEnabled: false });
    data.set('@taskmemo/profile/pinned-note/v1', JSON.stringify({ body: 'legacy change' }));
    await expect(local.store.command('edit', 'update', nodes => nodes.map(n => ({ ...n, title: 'blocked' })))).rejects.toThrow('V1 profile writer');
    expect(local.store.nodes[0].title).toBe('Before');
    expect(data.get('@taskmemo/profile/pinned-note/v1')).toContain('legacy change');
  });
});
