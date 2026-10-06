import { describe, expect, it } from 'vitest';
import { migrateLocalApplication, decodeLegacyNodes } from './localApplication';
import type { ApplicationJournalPersistence } from './applicationStore';
import { serializeText } from '../textFormat/session';
import fixture from '../../docs/fixtures/text-format-production.json';
import inactiveLegacy from '../../docs/fixtures/local-v1-inactive-legacy.json';
class Memory implements ApplicationJournalPersistence {
  committed: string | null = null; journal: string | null = null; fail = false;
  loadCommitted = async () => this.committed;
  loadJournal = async () => this.journal;
  writeJournal = async (value: string) => { this.journal = value; };
  writeCommitted = async (value: string) => { this.committed = value; };
  clearJournal = async () => { this.journal = null; };
  writeAtomic = async (expected: string | null, value: string) => {
    if (this.fail || this.committed !== expected || this.journal) throw new Error('atomic failed');
    this.committed = value;
  };
}
const raw = JSON.stringify([{ id: 'a', type: 'memo', parentId: null, title: 'A', body: '', memoType: 'task', status: 'active', sortKey: 'a0', deadlineSortKey: 'a1', duePreset: 'none', dueAt: null, createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', deletedAt: null, unknown: { kept: true }, routineHistory: { yesterday: null } }]);
const options = { scope: 'local', deviceId: 'device', source: raw, profile: { body: 'note', ideasEnabled: true } };
describe('Phase B raw local migration', () => {
  it.each(['missing', 'different'] as const)('restart rejects a %s backup without overwriting committed data', async fault => {
    const p = new Memory(), backup = new Memory();
    await migrateLocalApplication(p, { ...options, backup }); const saved = p.committed;
    backup.committed = fault === 'missing' ? null : backup.committed!.replace('"scope":"local"', '"scope":"other"');
    await expect(migrateLocalApplication(p, { ...options, backup })).rejects.toThrow('backup');
    expect(p.committed).toBe(saved); expect(p.journal).toBeNull();
  });
  it('retains the DEV-derived inactive lexical rank losslessly, including on restart and no-edit save', async () => {
    const p = new Memory(), backup = new Memory(); const source = JSON.stringify(inactiveLegacy);
    const store = await migrateLocalApplication(p, { ...options, source, backup });
    expect(Object.values(JSON.parse(p.committed!).domain).map(r => (r as { value: unknown }).value)).toEqual(inactiveLegacy);
    expect(JSON.parse(backup.committed!).backup.source).toBe(source);
    const session = store.beginTextEdit({ scope: 'local', view: 'tree', timeZone: 'Asia/Tokyo', systemRegions: true });
    const plan = store.prepareTextEdit(session, serializeText(session));
    expect(plan.changes).toEqual([]); expect(plan.errors).toEqual([]);
    const saved = p.committed; await store.commitTextEdit(plan); expect(p.committed).toBe(saved);
    expect((await migrateLocalApplication(p, { ...options, source, backup })).nodes[0].sortKey).toBe('c');
    expect(() => decodeLegacyNodes(JSON.stringify([{ ...inactiveLegacy[0], deletedAt: null }]))).toThrow('sortKey');
    expect(() => decodeLegacyNodes(JSON.stringify([{ ...inactiveLegacy[0], sortKey: '-' }]))).toThrow('sortKey');
    expect(() => decodeLegacyNodes(JSON.stringify([{ ...inactiveLegacy[0], sortKey: 3 }]))).toThrow('sortKey');
    expect(() => decodeLegacyNodes(JSON.stringify([{ ...inactiveLegacy[0], type: 'task' }]))).toThrow('type');
    expect(decodeLegacyNodes(JSON.stringify([{ ...inactiveLegacy[0], deletedAt: null, purgedAt: inactiveLegacy[0].deletedAt }]))[0].sortKey).toBe('c');
  });
  it('backs up before validation, rejects failed backup, and retains the raw invalid source', async () => {
    const persistence = new Memory(), backup = new Memory();
    backup.fail = true;
    await expect(migrateLocalApplication(persistence, { ...options, backup })).rejects.toThrow();
    expect(persistence.committed).toBeNull(); backup.fail = false;
    const invalid = 'invalid-json';
    await expect(migrateLocalApplication(persistence, { ...options, source: invalid, backup })).rejects.toThrow();
    expect(JSON.parse(backup.committed!).backup.source).toBe(invalid);
    expect(persistence.committed).toBeNull();
  });
  it('preserves every production-derived raw Node and a no-edit text save', async () => {
    const persistence = new Memory();
    const raw = JSON.stringify(fixture.records.map(r => r.value));
    const store = await migrateLocalApplication(persistence, { ...options, source: raw });
    expect(Object.values(JSON.parse(persistence.committed!).domain).map((r: unknown) => (r as { value: unknown }).value)).toEqual(fixture.records.map(r => r.value));
    const before = persistence.committed;
    const session = store.beginTextEdit({ scope: 'local', view: 'tree', timeZone: 'Asia/Tokyo', systemRegions: true });
    const plan = store.prepareTextEdit(session, serializeText(session));
    expect(plan.errors).toEqual([]); expect(plan.changes).toEqual([]);
    await store.commitTextEdit(plan); expect(persistence.committed).toBe(before);
  });
  it('preserves raw data, backup, IDs and performs one migration', async () => {
    const persistence = new Memory();
    const store = await migrateLocalApplication(persistence, options);
    const saved = persistence.committed!;
    expect(JSON.parse(saved).ownership.migration.source).toBe(raw);
    expect(store.nodes[0]).toMatchObject({ id: 'a', deadlineSortKey: 'a1', unknown: { kept: true } });
    expect(store.outbox).toEqual([]);
    expect(store.historyDepths).toEqual({ past: 0, future: 0 });
    await migrateLocalApplication(persistence, options);
    expect(persistence.committed).toBe(saved);
  });
  it('failed atomic commit leaves no executable journal and retry is safe', async () => {
    const persistence = new Memory(); persistence.fail = true;
    await expect(migrateLocalApplication(persistence, options)).rejects.toThrow();
    expect(persistence.committed).toBeNull(); expect(persistence.journal).toBeNull();
    persistence.fail = false;
    const store = await migrateLocalApplication(persistence, options);
    await store.command('rename', 'update', nodes => nodes.map(n => ({ ...n, title: 'B' })));
    const session = store.beginTextEdit({ scope: 'local', view: 'tree', timeZone: 'Asia/Tokyo' });
    const plan = store.prepareTextEdit(session, serializeText(session).replace(' | B', ' | C'));
    await store.commitTextEdit(plan);
    expect(store.historyDepths.past).toBe(2);
    const restart = await migrateLocalApplication(persistence, options);
    expect(restart.nodes[0].title).toBe('C'); await restart.undo();
    expect(restart.nodes[0].title).toBe('B'); await restart.redo();
    expect(restart.nodes[0].title).toBe('C');
  });
  it('does not silently normalize invalid ranks, duplicate IDs or invalid dates', () => {
    const nodes = JSON.parse(raw);
    expect(() => decodeLegacyNodes(JSON.stringify([...nodes, ...nodes]))).toThrow();
    expect(() => decodeLegacyNodes(JSON.stringify([{ ...nodes[0], sortKey: '-' }]))).toThrow();
    expect(() => decodeLegacyNodes(JSON.stringify([{ ...nodes[0], createdAt: 'bad' }]))).toThrow();
  });
  it('fresh install has no sample data and wrong owner is rejected', async () => {
    const persistence = new Memory();
    const store = await migrateLocalApplication(persistence, { ...options, source: null });
    expect(store.nodes).toEqual([]);
    await expect(migrateLocalApplication(persistence, { ...options, scope: 'other' })).rejects.toThrow();
  });
});
