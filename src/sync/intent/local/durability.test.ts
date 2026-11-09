import { createHash } from 'node:crypto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { expect, it, vi } from 'vitest';
import { canonical } from '../canonical';
import { evaluateAcceptance } from '../acceptance';
import { makePublication } from '../publication';
import { baseline, intent, scope } from '../testFixtures';
import { openIsolatedStorage } from './isolatedIndexedDb';
import { LocalIntentStore } from './store';
import type { LocalContext, AtomicStorage, RawPair, Envelope, Notice } from './types';

const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const binding = { scope, generation: baseline.generation, baselineSeal: baseline.seal,
  incarnation: 'phase2a', activationToken: 'synthetic-token', controlEpoch: 1 };
const context: LocalContext = { format: 'phase2a-isolated/1', storageScope: 'synthetic:durability', actorId: 'phone', binding, baseline };
async function setup() {
  const storage = await openIsolatedStorage(new IDBFactory(), context.storageScope);
  const opened = await LocalIntentStore.open(storage, context, digest, null);
  if (opened.kind !== 'ready') throw Error(opened.reason);
  return { storage, store: opened.store };
}
const bodyInput = { resource: { type: 'node' as const, id: 'task' }, intentKind: 'set-body' as const,
  writes: [{ attribute: 'body' as const, value: 'local' }], observed: [{ resource: { type: 'node' as const, id: 'task' },
    attribute: 'body' as const, baselineSeal: baseline.seal, heads: [{ kind: 'baseline' as const }] }],
  readSet: [], dependencies: [], origin: 'synthetic', createdAt: '2026-11-09T00:00:00.000Z' };

it('atomic local allocation and complete snapshot survive restart without touching legacy storage', async () => {
  const { storage, store } = await setup();
  const op = await store.local(bodyInput);
  expect(op.localSeq).toBe(1);
  expect(store.view().snapshot.ledger.outbox).toEqual([op]);
  const reopened = await LocalIntentStore.open(storage, context, digest, store.guard());
  if (reopened.kind !== 'ready') throw Error(reopened.reason);
  expect(reopened.store.view()).toEqual(store.view());
});

it('quota/abort failure does not advance memory, sequence or retire Outbox', async () => {
  const { storage, store } = await setup();
  const old = store.view(), floor = store.guard();
  const fault: AtomicStorage = { scope: context.storageScope, read: () => storage.read(), writeAtomic: async () => { throw new DOMException('full', 'QuotaExceededError'); } };
  const opened = await LocalIntentStore.open(fault, context, digest, floor);
  if (opened.kind !== 'ready') throw Error(opened.reason);
  await expect(opened.store.local(bodyInput)).rejects.toThrow();
  expect(opened.store.view()).toEqual(old);
  const restarted = await LocalIntentStore.open(storage, context, digest, floor);
  if (restarted.kind !== 'ready') throw Error(restarted.reason);
  expect((await restarted.store.local(bodyInput)).localSeq).toBe(1);
});

it('receipt and reverse publication inbox are durable before processing and redeliver after restart', async () => {
  const { storage, store } = await setup();
  const a = await store.local(bodyInput);
  const d = evaluateAcceptance(baseline, [], a);
  if (d.kind !== 'accepted') throw Error('receipt required');
  const p1 = makePublication(baseline, [a], store.view().snapshot.checkpoint, 1, digest);
  const b = intent('b', { attribute: 'body', value: 'concurrent' });
  const p2 = makePublication(baseline, [a, b], { seq: 1, hash: p1.manifest.hash }, 1, digest);
  await store.receive({ kind: 'publication', binding, publication: p2 });
  const resumed = await LocalIntentStore.open(storage, context, digest, store.guard());
  if (resumed.kind !== 'ready') throw Error(resumed.reason);
  await resumed.store.drain();
  expect(resumed.store.view().inbox.publications[0].status).toBe('pending');
  await resumed.store.receive({ kind: 'publication', binding, publication: p1 });
  await resumed.store.receive({ kind: 'receipt', binding, receipt: d.receipt });
  await resumed.store.drain();
  expect(resumed.store.view().snapshot.checkpoint.seq).toBe(2);
  expect(resumed.store.view().snapshot.ledger.awaiting).toEqual([]);
  expect(resumed.store.status().conflict).toBe(2);
  expect(resumed.store.status().complete).toBe(false);
});

it('non-null/torn Journal and corrupt/unknown snapshot preserve both original raw strings and stop', async () => {
  const { storage, store } = await setup();
  const raw = await storage.read();
  for (const pair of [ { ...raw, journal: '{interrupted' }, { ...raw, journal: raw.committed },
    { committed: '{broken', journal: null }, { committed: canonical({ version: 'unknown' }), journal: null } ]) {
    const fixture: AtomicStorage = { scope: context.storageScope, read: async () => pair, writeAtomic: async () => { throw Error('must never write'); } };
    const result = await LocalIntentStore.open(fixture, context, digest, store.guard());
    expect(result.kind).toBe('protected');
    if (result.kind === 'protected') {
      expect(result.original).toEqual(pair);
      expect(result.reason).not.toBe('unconfirmed-recovery-head'); // Journal/format validation runs before head pinning.
    }
  }
});

it('old snapshot and foreign generation require trusted recovery guard, never inferred evidence', async () => {
  const { storage, store } = await setup();
  const old: RawPair = await storage.read();
  await store.local(bodyInput);
  const oldStorage: AtomicStorage = { scope: context.storageScope, read: async () => old, writeAtomic: async () => { throw Error('must never write'); } };
  expect((await LocalIntentStore.open(oldStorage, context, digest, store.guard())).kind).toBe('protected');
  expect((await LocalIntentStore.open(storage, { ...context, binding: { ...binding, generation: 'foreign' } }, digest, store.guard())).kind).toBe('protected');
  expect((await LocalIntentStore.open(storage, context, digest, null)).kind).toBe('protected');
});

it('raw CAS rejects a second writer without replacing its sequence or complete state', async () => {
  const { storage, store } = await setup();
  const second = await LocalIntentStore.open(storage, context, digest, store.guard());
  if (second.kind !== 'ready') throw Error(second.reason);
  const before = second.store.view();
  await store.local(bodyInput);
  await expect(second.store.local(bodyInput)).rejects.toThrow('raw-CAS');
  expect(second.store.view()).toEqual(before);
  expect(second.store.status().protection).toBe(true);
  expect((await storage.read()).committed).toBe(canonical(store.view()));
});

it.each(['before', 'after-put', 'quota'] as const)('IndexedDB %s abort rolls back the complete candidate', async kind => {
  const { storage, store } = await setup();
  const before = await storage.read(), memory = store.view(), controller = new AbortController();
  if (kind === 'before') controller.abort();
  const put = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
    if (kind === 'quota') throw new DOMException('synthetic quota', 'QuotaExceededError');
    const request = put.apply(this, args);
    if (kind === 'after-put') controller.abort();
    return request;
  });
  try { await expect(store.local(bodyInput, controller.signal)).rejects.toThrow(); }
  finally { spy.mockRestore(); }
  expect(await storage.read()).toEqual(before);
  expect(store.view()).toEqual(memory);
  const restored = await LocalIntentStore.open(storage, context, digest, store.guard());
  if (restored.kind !== 'ready') throw Error(restored.reason);
  expect((await restored.store.local(bodyInput)).localSeq).toBe(1);
});

it('crash after durable commit but before success notification refuses an unconfirmed successor instead of reusing sequence', async () => {
  const { storage, store } = await setup();
  const floor = store.guard();
  const fault: AtomicStorage = { scope: context.storageScope, read: () => storage.read(), writeAtomic: async (expected, raw) => {
    await storage.writeAtomic(expected, raw); throw Error('crash-after-commit');
  } };
  const open = await LocalIntentStore.open(fault, context, digest, floor);
  if (open.kind !== 'ready') throw Error(open.reason);
  await expect(open.store.local(bodyInput)).rejects.toThrow('crash-after-commit');
  expect(open.store.view().nextLocalSeq).toBe(1);
  expect(open.store.status().protection).toBe(true);
  const restart = await LocalIntentStore.open(storage, context, digest, floor);
  expect(restart.kind).toBe('protected');
  if (restart.kind === 'protected') {
    expect(restart.reason).toBe('unconfirmed-recovery-head');
    expect(JSON.parse(restart.original.committed!).nextLocalSeq).toBe(2);
    expect(restart.original).toEqual(await storage.read());
  }
});

it('a Journal arriving after hydration blocks CAS, including redundant and torn WAL bytes', async () => {
  const { storage, store } = await setup();
  const row = await storage.read();
  for (const journal of ['{torn-write', row.committed]) {
    let pair: RawPair = row;
    const guarded: AtomicStorage = { scope: context.storageScope, read: async () => pair, writeAtomic: async (expected, raw) => {
      if (pair.committed !== expected || pair.journal !== null) throw Error('Journal-present');
      pair = { committed: raw, journal: null };
    } };
    const s = await LocalIntentStore.open(guarded, context, digest, store.guard());
    if (s.kind !== 'ready') throw Error(s.reason);
    pair = { ...row, journal };
    await expect(s.store.local(bodyInput)).rejects.toThrow('Journal-present');
    expect(pair).toEqual({ ...row, journal });
    expect(s.store.view()).toEqual(store.view());
  }
});

async function reflected() {
  const s = await setup(), a = await s.store.local(bodyInput), floor = s.store.guard();
  const decision = evaluateAcceptance(baseline, [], a);
  if (decision.kind !== 'accepted') throw Error('receipt required');
  const p = makePublication(baseline, [a], s.store.view().snapshot.checkpoint, 1, digest);
  await s.store.receive({ kind: 'receipt', binding, receipt: decision.receipt });
  await s.store.receive({ kind: 'publication', binding, publication: p });
  await s.store.drain();
  return { ...s, a, floor, p, receipt: decision.receipt };
}

it.each(['reflection', 'reflection-binding', 'manifest', 'member', 'ancestor', 'payload', 'ledger', 'next-seq', 'unknown'] as const)(
  'hydration rejects %s tampering even after the attacker recomputes the outer checksum', async kind => {
    const s = await reflected(), original = await s.storage.read();
    const parsed = JSON.parse(original.committed!) as Envelope;
    const mutable = parsed as unknown as Record<string, unknown>;
    const snap = parsed.snapshot as unknown as { evidence: { reflections: unknown[] }; ledger: { outbox: unknown[] } };
    if (kind === 'reflection') snap.evidence.reflections = [];
    if (kind === 'reflection-binding') (snap.evidence.reflections[0] as { binding: { generation: string } }).binding.generation = 'foreign';
    if (kind === 'manifest' || kind === 'member' || kind === 'ancestor') {
      const event = parsed.events.find(e => e.kind === 'notification' && e.notice.kind === 'publication');
      if (!event || event.kind !== 'notification' || event.notice.kind !== 'publication') throw Error('publication missing');
      const p = event.notice.publication as unknown as { manifest: { hash: string; previous: { hash: string } }; state: { fields: unknown[] } };
      if (kind === 'manifest') p.manifest.hash = '0'.repeat(64);
      if (kind === 'member') p.state.fields = [];
      if (kind === 'ancestor') p.manifest.previous.hash = 'forged-ancestor';
    }
    if (kind === 'payload') {
      const event = parsed.events.find(e => e.kind === 'notification' && e.notice.kind === 'receipt');
      if (!event || event.kind !== 'notification' || event.notice.kind !== 'receipt') throw Error('receipt missing');
      (event.notice.receipt as { canonicalIntent: string }).canonicalIntent = '{}';
    }
    if (kind === 'ledger') snap.ledger.outbox = [s.a];
    if (kind === 'next-seq') mutable.nextLocalSeq = 500;
    if (kind === 'unknown') mutable.unrecognized = true;
    const { checksum: _checksum, ...body } = parsed;
    const raw = canonical({ ...body, checksum: digest(canonical(body)) });
    const pair = { committed: raw, journal: null };
    const fixture: AtomicStorage = { scope: context.storageScope, read: async () => pair, writeAtomic: async () => { throw Error('no writes allowed'); } };
    const result = await LocalIntentStore.open(fixture, context, digest, s.store.guard());
    expect(result.kind).toBe('protected');
    if (result.kind === 'protected') expect(result.original).toEqual(pair);
  });

it('durable notification processing abort keeps the captured inbox and Outbox for retry', async () => {
  const { storage, store } = await setup();
  const a = await store.local(bodyInput), d = evaluateAcceptance(baseline, [], a);
  if (d.kind !== 'accepted') throw Error('receipt required');
  await store.receive({ kind: 'receipt', binding, receipt: d.receipt });
  const before = store.view(), floor = store.guard();
  const fault: AtomicStorage = { scope: context.storageScope, read: () => storage.read(), writeAtomic: async () => { throw Error('abort'); } };
  const s = await LocalIntentStore.open(fault, context, digest, floor);
  if (s.kind !== 'ready') throw Error(s.reason);
  await expect(s.store.drain()).rejects.toThrow('abort');
  expect(s.store.view()).toEqual(before);
  expect(before.snapshot.ledger.outbox).toEqual([a]);
  const restart = await LocalIntentStore.open(storage, context, digest, floor);
  if (restart.kind !== 'ready') throw Error(restart.reason);
  await restart.store.drain();
  expect(restart.store.view().snapshot.ledger.awaiting).toEqual([a]);
});

it.each(['conflict', 'completion-conflict', 'protected'] as const)('durable R/P1/P2 %s converges after every-stage restart and duplicate delivery', async kind => {
  let expected;
  const orders = [['R', 'P1', 'P2'], ['P1', 'R', 'P2'], ['P1', 'P2', 'R'], ['P2', 'R', 'P1']];
  for (const order of orders) {
    const { storage, store } = await setup();
    let current = store;
    const a = await current.local(kind === 'completion-conflict' ? { ...bodyInput, intentKind: 'set-completed',
      writes: [{ attribute: 'completion', value: { status: 'completed', completedAt: '2026-11-09T01:00:00.000Z' } }],
      observed: [{ ...bodyInput.observed[0], attribute: 'completion' }] } : bodyInput);
    const extra = await current.local({ ...bodyInput, intentKind: 'set-title', writes: [{ attribute: 'title', value: 'unsent' }],
      observed: [{ ...bodyInput.observed[0], attribute: 'title' }] });
    const b = kind === 'protected' ? { ...a, origin: 'colliding-payload' } : kind === 'completion-conflict'
      ? intent('b', { attribute: 'completion', value: { status: 'completed', completedAt: '2026-11-09T02:00:00.000Z' } })
      : intent('b', { attribute: 'body', value: 'parallel' });
    const d = evaluateAcceptance(baseline, [], a);
    if (d.kind !== 'accepted') throw Error('receipt required');
    const p1 = makePublication(baseline, [a], current.view().snapshot.checkpoint, 1, digest);
    const p2 = makePublication(baseline, [a, b], { seq: 1, hash: p1.manifest.hash }, 1, digest);
    const notices: Record<string, Notice> = { R: { kind: 'receipt', binding, receipt: d.receipt },
      P1: { kind: 'publication', binding, publication: p1 }, P2: { kind: 'publication', binding, publication: p2 } };
    for (const event of [...order, 'P1', 'P2', 'R']) {
      await current.receive(notices[event]);
      await current.receive(notices[event]);
      let open = await LocalIntentStore.open(storage, context, digest, current.guard());
      if (open.kind !== 'ready') throw Error(open.reason);
      current = open.store;
      await current.drain();
      open = await LocalIntentStore.open(storage, context, digest, current.guard());
      if (open.kind !== 'ready') throw Error(open.reason);
      current = open.store;
    }
    const value = current.view();
    expect(value.snapshot.ledger).toEqual({ outbox: [extra], awaiting: [] });
    expect(value.snapshot.evidence.receipts).toHaveLength(1);
    expect(value.snapshot.evidence.reflections).toHaveLength(1);
    expect(current.status().complete).toBe(false);
    if (kind !== 'protected') expect(current.status().conflict).toBe(2);
    else expect(current.status().protection).toBe(true);
    const logical = { snapshot: value.snapshot, inbox: value.inbox, nextLocalSeq: value.nextLocalSeq };
    if (expected) expect(logical).toEqual(expected);
    expected = logical;
  }
}, 20000);

it('sync status separates historical applied from every current blocking condition and server confirmation', async () => {
  const { store } = await reflected();
  expect(store.status()).toMatchObject({ awaiting: 0, conflict: 0, serverConfirmed: false, complete: false });
  expect(store.status({ binding, checkpoint: store.view().snapshot.checkpoint }).complete).toBe(true); // synthetic trusted observation only
  expect(store.status({ binding, checkpoint: { seq: 0, hash: baseline.seal } }).complete).toBe(false);
  const missing = intent('missing', { attribute: 'emphasis', value: false }, ['not-arrived']);
  const next = makePublication(baseline, [...store.view().snapshot.state.intents, missing], store.view().snapshot.checkpoint, 1, digest);
  await store.receive({ kind: 'publication', binding, publication: next });
  expect(store.status().inboxPending).toBe(1);
  await store.drain();
  expect(store.status({ binding, checkpoint: next.manifest }).dependencyPending).toBe(1);
  expect(store.status({ binding, checkpoint: { seq: next.manifest.seq, hash: next.manifest.hash } }).complete).toBe(false);
});

it.each(['conflict', 'dependency-pending', 'protected'] as const)('initial %s remains unresolved after durable receipt and hydration', async kind => {
  const { storage, store } = await setup();
  const a = await store.local(kind === 'dependency-pending' ? { ...bodyInput,
    observed: [{ ...bodyInput.observed[0], heads: [{ kind: 'operation', opId: 'missing' }] }] } : bodyInput);
  const d = evaluateAcceptance(baseline, [], a);
  if (d.kind !== 'accepted') throw Error('receipt required');
  const values = kind === 'dependency-pending' ? [a] : [a, kind === 'protected' ? { ...a, origin: 'collision' }
    : intent('b', { attribute: 'body', value: 'parallel' })];
  const p = makePublication(baseline, values, store.view().snapshot.checkpoint, 1, digest);
  await store.receive({ kind: 'publication', binding, publication: p });
  await store.receive({ kind: 'receipt', binding, receipt: d.receipt });
  await store.drain();
  const s = await LocalIntentStore.open(storage, context, digest, store.guard());
  if (s.kind !== 'ready') throw Error(s.reason);
  expect(s.store.view().snapshot.evidence.reflections).toEqual([]);
  expect(s.store.view().snapshot.ledger.awaiting).toEqual([a]);
  expect(s.store.status({ binding, checkpoint: s.store.view().snapshot.checkpoint }).complete).toBe(false);
});

it('a fully hashed fork is stopped by ancestry checks, retains raw inbox and never clears itself on restart', async () => {
  const { storage, store, a } = await reflected();
  const before = store.view().snapshot;
  const p = makePublication(baseline, [a, intent('b', { attribute: 'title', value: 'valid payload' })],
    { seq: before.checkpoint.seq, hash: 'wrong-ancestor' }, 1, digest);
  await store.receive({ kind: 'publication', binding, publication: p });
  await store.drain();
  expect(store.view().halt).toBe('publication-fork');
  expect(store.status().inboxRejected).toBe(1);
  expect(store.view().snapshot).toEqual(before);
  await expect(store.local(bodyInput)).rejects.toThrow();
  const s = await LocalIntentStore.open(storage, context, digest, store.guard());
  if (s.kind !== 'ready') throw Error(s.reason);
  expect(s.store.view().halt).toBe('publication-fork');
  expect(s.store.status().protection).toBe(true);
  expect(s.store.view().events.at(-1)).toEqual({ kind: 'notification', notice: { kind: 'publication', binding, publication: p } });
});

it('local inputs, exposed snapshots and context cannot mutate an in-flight atomic candidate', async () => {
  const { storage, store } = await setup();
  const input = JSON.parse(JSON.stringify(bodyInput));
  const promise = store.local(input);
  input.writes[0].value = 'late mutation';
  expect((await promise).writes[0].value).toBe('local');
  const view = store.view() as unknown as { nextLocalSeq: number };
  view.nextLocalSeq = 999;
  expect(store.view().nextLocalSeq).toBe(2);
  const foreign = { ...storage, scope: 'synthetic:wrong-scope' };
  expect((await LocalIntentStore.open(foreign, context, digest, store.guard())).kind).toBe('protected');
});

it.each(['{partial-Journal', 'redundant'] as const)('actual isolated IndexedDB preserves %s across crash and refuses CAS', async wal => {
  const factory = new IDBFactory(), storage = await openIsolatedStorage(factory, context.storageScope);
  const s = await LocalIntentStore.open(storage, context, digest, null);
  if (s.kind !== 'ready') throw Error(s.reason);
  const before = await storage.read(), journal = wal === 'redundant' ? before.committed : wal;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = factory.open('taskmemo-intent-phase2a-isolated-test', 1);
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('synthetic-scopes', 'readwrite');
    tx.objectStore('synthetic-scopes').put({ scope: context.storageScope, committed: before.committed, journal });
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
  });
  db.close();
  const raw = await storage.read();
  expect(raw).toEqual({ ...before, journal });
  expect((await LocalIntentStore.open(storage, context, digest, s.store.guard())).kind).toBe('protected');
  await expect(storage.writeAtomic(before.committed, before.committed!)).rejects.toThrow('Journal');
  expect(await storage.read()).toEqual(raw);
});

it('two queued local commands serialize sequence allocation only after each successful CAS', async () => {
  const { store } = await setup();
  const [a, b] = await Promise.all([store.local(bodyInput), store.local(bodyInput)]);
  expect([a.localSeq, b.localSeq]).toEqual([1, 2]);
  expect(store.view().snapshot.ledger.outbox).toEqual([a, b]);
  expect(store.view().nextLocalSeq).toBe(3);
});

it('an ambiguous initial commit never authorizes self-derived recovery or reinitialization', async () => {
  const storage = await openIsolatedStorage(new IDBFactory(), context.storageScope);
  const fault: AtomicStorage = { scope: context.storageScope, read: () => storage.read(), writeAtomic: async (expected, raw) => {
    await storage.writeAtomic(expected, raw); throw Error('crash before initialization acknowledgment');
  } };
  expect((await LocalIntentStore.open(fault, context, digest, null)).kind).toBe('protected');
  const before = await storage.read();
  expect(before.committed).not.toBeNull();
  expect((await LocalIntentStore.open(storage, context, digest, null)).kind).toBe('protected');
  expect(await storage.read()).toEqual(before);
});

it('synthetic scope isolation and validation failures never overwrite another scope or acknowledge bad input', async () => {
  const factory = new IDBFactory();
  const storage = await openIsolatedStorage(factory, context.storageScope);
  const first = await LocalIntentStore.open(storage, context, digest, null);
  if (first.kind !== 'ready') throw Error(first.reason);
  const secondStorage = await openIsolatedStorage(factory, 'synthetic:second');
  const second = await LocalIntentStore.open(secondStorage, { ...context, storageScope: 'synthetic:second' }, digest, null);
  if (second.kind !== 'ready') throw Error(second.reason);
  const before = await storage.read();
  await second.store.local(bodyInput);
  expect(await storage.read()).toEqual(before);
  const p = makePublication(baseline, [], first.store.view().snapshot.checkpoint, 1, digest);
  await expect(first.store.receive({ kind: 'publication', binding: { ...binding, generation: 'foreign' }, publication: p })).rejects.toThrow('binding');
  expect(await storage.read()).toEqual(before);
  expect(first.store.status().protection).toBe(true);
  await expect(openIsolatedStorage(factory, 'account:user')).rejects.toThrow('synthetic');
});
