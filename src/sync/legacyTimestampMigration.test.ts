import { expect, it } from 'vitest';
import { decodeLegacyNodes } from './legacyLocalCodec';
import { migrateLocalApplication } from './localApplication';
import type { ApplicationJournalPersistence } from './applicationStore';
import fixture from './fixtures/productionLegacyTimestamp.json';
import { decodeLegacyDate } from './legacyDateCodec';

class Memory implements ApplicationJournalPersistence {
  committed: string | null = null;
  loadCommitted = async () => this.committed;
  loadJournal = async () => null;
  writeCommitted = async () => { throw new Error('atomic only'); };
  writeJournal = async () => { throw new Error('no journal'); };
  clearJournal = async () => {};
  writeAtomic = async (expected: string | null, value: string) => {
    if (this.committed !== expected) throw new Error('CAS');
    this.committed = value;
  };
}
const timestamp = { type: 'firestore/timestamp/1.0', seconds: 1789569222, nanoseconds: 945000000 };
const iso = '2026-09-16T14:33:42.945Z';
const source = JSON.stringify(fixture.nodes);
const options = { scope: 'local', deviceId: 'fixture-device', source, profile: { body: '', ideasEnabled: true } };
const node = { id: 'a', type: 'category', parentId: null, sortKey: 'a0', title: 'A', createdAt: iso, updatedAt: iso, deletedAt: null };

it('migrates all 120 Production-derived Nodes losslessly, retains four purged tombstones, raw backup and restart', async () => {
  const p = new Memory(), backup = new Memory();
  const store = await migrateLocalApplication(p, { ...options, backup });
  const expected = fixture.nodes.map(n => ({ ...n, ...('purgedAt' in n ? { purgedAt: iso } : {}) }));
  expect(Object.values(JSON.parse(p.committed!).domain).map((r: unknown) => (r as { value: unknown }).value)).toEqual(expected);
  expect(store.nodes).toHaveLength(120);
  expect(store.nodes.map(n => n.id)).toEqual(fixture.nodes.map(n => n.id));
  expect(store.nodes.filter(n => n.purgedAt).map(n => n.id)).toEqual(['system-routine-daily', 'system-routine-monthly', 'system-routine-weekly', 'system-routine-yearly']);
  for (const n of store.nodes.filter(n => n.purgedAt)) {
    expect(n.purgedAt?.toISOString()).toBe(iso); expect(n.deletedAt?.toISOString()).toBe(iso);
  }
  expect(JSON.parse(backup.committed!).backup.source).toBe(source);
  expect(JSON.parse(p.committed!).ownership.migration.source).toBe(source);
  expect(store.outbox).toEqual([]); expect(store.historyDepths).toEqual({ past: 0, future: 0 });
  const saved = p.committed;
  expect((await migrateLocalApplication(p, { ...options, backup })).nodes).toEqual(store.nodes);
  expect(p.committed).toBe(saved); expect(JSON.stringify(fixture.nodes)).toBe(source);
});

it.each(['createdAt', 'updatedAt', 'deletedAt', 'purgedAt', 'dueAt', 'completedAt'])('decodes Timestamp consistently for %s without touching unknown metadata', field => {
  const input = { ...node, [field]: timestamp, unknown: { timestamp }, deletionBatchId: 'keep' };
  const raw = JSON.stringify([input]);
  expect(decodeLegacyNodes(raw)).toEqual([{ ...input, [field]: iso }]);
  expect(JSON.stringify([input])).toBe(raw);
});

const invalid = [null, {}, [], { ...timestamp, type: 'firestore/timestamp/2.0' },
  { seconds: timestamp.seconds, nanoseconds: 0 }, { ...timestamp, seconds: '1789569222' },
  { ...timestamp, nanoseconds: '945000000' }, { ...timestamp, seconds: NaN },
  { ...timestamp, seconds: Infinity }, { ...timestamp, seconds: -62135596801 },
  { ...timestamp, seconds: 253402300800 }, { ...timestamp, seconds: 1.5 },
  { ...timestamp, nanoseconds: -1 }, { ...timestamp, nanoseconds: 1000000000 },
  { ...timestamp, nanoseconds: NaN }, { ...timestamp, nanoseconds: Infinity },
  { ...timestamp, nanoseconds: 1.5 }, { ...timestamp, nanoseconds: 1 },
  { type: timestamp.type, seconds: 0 }, { ...timestamp, extra: true },
  { _seconds: timestamp.seconds, _nanoseconds: timestamp.nanoseconds },
].slice(1);
it.each(invalid)('rejects malformed or non-lossless Timestamp %# before V2 commit', async value => {
  const p = new Memory(), backup = new Memory();
  const raw = JSON.stringify([{ ...node, purgedAt: value }]);
  expect(() => decodeLegacyNodes(raw)).toThrow('purgedAt');
  await expect(migrateLocalApplication(p, { ...options, source: raw, backup })).rejects.toThrow('purgedAt');
  expect(p.committed).toBeNull(); expect(JSON.parse(backup.committed!).backup.source).toBe(raw);
});

it.each([
  [-62135596800, 0, '0001-01-01T00:00:00.000Z'],
  [253402300799, 999000000, '9999-12-31T23:59:59.999Z'],
  [-1, 999000000, '1969-12-31T23:59:59.999Z'],
  [0, 0, '1970-01-01T00:00:00.000Z'],
])('preserves valid Timestamp boundary %s / %s', (seconds, nanoseconds, expected) => {
  expect(decodeLegacyNodes(JSON.stringify([{ ...node, createdAt: { ...timestamp, seconds, nanoseconds } }]))[0].createdAt).toBe(expected);
});

it.each([NaN, Infinity, -Infinity, true, '0', undefined])('rejects non-integer seconds/nanoseconds directly: %s', value => {
  expect(() => decodeLegacyDate({ ...timestamp, seconds: value }, 'createdAt')).toThrow('createdAt');
  expect(() => decodeLegacyDate({ ...timestamp, nanoseconds: value }, 'purgedAt')).toThrow('purgedAt');
});
it('preserves existing ISO/null/absent dates and rejects non-JSON objects and missing seconds', () => {
  expect(decodeLegacyDate(iso, 'createdAt')).toBe(iso);
  expect(decodeLegacyDate(null, 'deletedAt')).toBeNull();
  expect(decodeLegacyDate(undefined, 'purgedAt')).toBeUndefined();
  expect(() => decodeLegacyDate(new Date(iso), 'createdAt')).toThrow();
  expect(() => decodeLegacyDate({ type: timestamp.type, nanoseconds: 0 }, 'createdAt')).toThrow();
});
