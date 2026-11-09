import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { expect, it } from 'vitest';
import { openIsolatedStorage } from '../local/isolatedIndexedDb';
import type { AtomicStorage, LocalContext } from '../local/types';
import { baseline, scope } from '../testFixtures';
import { AuthorityBridge } from './client';
import { MockIdentity, MockAuthority } from './testing/mockAuthority';
import type { AuthorityChannel, Claims, Request, SignedReply } from './protocol';
import { canonical } from '../canonical';
import { evaluateAcceptance } from '../acceptance';
import { makePublication } from '../publication';

const digest = (s: string) => createHash('sha256').update(s).digest('hex');
async function harness(witness: (storage: AtomicStorage) => AtomicStorage = s => s) {
  let time = 1000, counter = 0;
  const keys = generateKeyPairSync('ed25519'), attacker = generateKeyPairSync('ed25519');
  const signer = { keyId: 'pinned-root', sign: (s: string) => sign(null, Buffer.from(s), keys.privateKey).toString('base64') };
  const verifier = { verify: (id: string, text: string, signature: string) => id === 'pinned-root' && verify(null, Buffer.from(text), keys.publicKey, Buffer.from(signature, 'base64')) };
  const now = () => time, identity = new MockIdentity(now);
  const auth = identity.issue(scope, 100000);
  const authority = new MockAuthority({ signer, authenticate: token => identity.authenticate(token), now, digest, ttl: 100 });
  const context: LocalContext = { format: 'phase2a-isolated/1', storageScope: 'synthetic:authority', actorId: 'phone',
    baseline, binding: { scope, generation: baseline.generation, baselineSeal: baseline.seal, incarnation: 'device', activationToken: 'activation', controlEpoch: 1 } };
  const storage = await openIsolatedStorage(new IDBFactory(), context.storageScope);
  await authority.provision('phone', context, witness(storage));
  const create = (channel: AuthorityChannel = authority.channel(auth.token), sessionId = auth.id) => new AuthorityBridge({
    replicaId: 'phone', context, storage, channel, sessionId, verifier, now, digest, nonce: () => `challenge-${++counter}`,
  });
  return { authority, identity, auth, context, storage, create, signer, verifier, attacker,
    now, nonce: () => `challenge-${++counter}`, advance: (n: number) => { time += n; } };
}
const input = { resource: { type: 'node' as const, id: 'task' }, intentKind: 'set-body' as const,
  writes: [{ attribute: 'body' as const, value: 'synthetic' }], observed: [{ resource: { type: 'node' as const, id: 'task' }, attribute: 'body' as const,
    baselineSeal: baseline.seal, heads: [{ kind: 'baseline' as const }] }], readSet: [], dependencies: [], origin: 'synthetic', createdAt: '2026-11-09T00:00:00.000Z' };

it('independent signed head is created and reacquired without accepting a local guard argument', async () => {
  const h = await harness(), client = h.create();
  await client.initialize();
  const op = await client.local(input);
  expect(op.localSeq).toBe(1);
  const reopened = h.create();
  await reopened.open();
  expect(reopened.view()).toEqual(client.view());
  expect(reopened.state().phase).toBe('ready');
});

it('a coherently forged local guard cannot authenticate a changed raw snapshot', async () => {
  const h = await harness(), client = h.create();
  await client.initialize();
  const raw = await h.storage.read();
  await h.storage.writeAtomic(raw.committed, raw.committed! + ' ');
  const original = await h.storage.read();
  await expect(h.create().open()).rejects.toThrow();
  expect(await h.storage.read()).toEqual(original);
});

it('commit success followed by lost response recovers only through an independent witness check', async () => {
  const h = await harness();
  let lose = false;
  const base = h.authority.channel(h.auth.token);
  const client = h.create({ call: async request => {
    const result = await base.call(request);
    if (lose && request.kind === 'commit') { lose = false; throw Error('lost response'); }
    return result;
  } });
  await client.initialize(); lose = true;
  await expect(client.local(input)).rejects.toThrow('lost response');
  expect(client.state().phase).toBe('blocked');
  const original = await h.storage.read();
  await client.recover();
  expect(await h.storage.read()).toEqual(original);
  expect(client.view().nextLocalSeq).toBe(2);
  expect(client.view().snapshot.ledger.outbox).toHaveLength(1);
});

it('two tabs using one head cannot both authorize writes from the stale version', async () => {
  const h = await harness(), a = h.create(), b = h.create();
  await a.initialize(); await b.open();
  const result = await Promise.allSettled([a.local(input), b.local(input)]);
  expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const reader = h.create(); await reader.open();
  expect(reader.view().nextLocalSeq).toBe(2);
});

it('offline authority blocks writes and does not automatically clear the blocked state after reconnection', async () => {
  const h = await harness(); let online = true;
  const base = h.authority.channel(h.auth.token);
  const client = h.create({ call: r => online ? base.call(r) : Promise.reject(Error('offline')) });
  await client.initialize(); const before = await h.storage.read(); online = false;
  await expect(client.local(input)).rejects.toThrow('offline');
  online = true;
  await expect(client.local(input)).rejects.toThrow('not-ready');
  expect(await h.storage.read()).toEqual(before);
  await client.recover();
  expect((await client.local(input)).localSeq).toBe(1);
});

it('a local ServerObservation-shaped DTO cannot manufacture server confirmation', async () => {
  const h = await harness(), client = h.create(); await client.initialize();
  await expect(client.status({ binding: h.context.binding, checkpoint: client.view().snapshot.checkpoint })).rejects.toThrow('untrusted');
});

it.each(['wrong-key', 'backup-root', 'nonce', 'session', 'purpose', 'scope', 'generation', 'epoch', 'incarnation'] as const)(
  'authority proof rejects %s independently of its DTO shape', async kind => {
    const h = await harness(), initial = h.create(); await initial.initialize();
    const before = await h.storage.read(), base = h.authority.channel(h.auth.token);
    const client = h.create({ call: async r => {
      const response = await base.call(r);
      let c: Claims = response.claims;
      if (kind === 'nonce') c = { ...c, nonce: 'copied-old-nonce' };
      if (kind === 'session') c = { ...c, sessionId: 'another-session' };
      if (kind === 'purpose') c = { ...c, purpose: 'observation' };
      if (kind === 'scope') c = { ...c, binding: { ...c.binding, scope: { ...scope, uid: 'other' } } };
      if (kind === 'generation') c = { ...c, binding: { ...c.binding, generation: 'old' } };
      if (kind === 'epoch') c = { ...c, binding: { ...c.binding, controlEpoch: 0 } };
      if (kind === 'incarnation') c = { ...c, binding: { ...c.binding, incarnation: 'other-tab-context' } };
      return { keyId: kind === 'backup-root' ? 'root-from-backup' : response.keyId, claims: c,
        signature: kind === 'wrong-key' ? sign(null, Buffer.from(canonical(c)), h.attacker.privateKey).toString('base64')
          : h.signer.sign(canonical(c)) };
    } });
    await expect(client.open()).rejects.toThrow('authority-proof');
    expect(client.state().phase).toBe('blocked');
    expect(await h.storage.read()).toEqual(before);
  });

it.each(['expired', 'clock-rollback'] as const)('%s proof never installs a head after a delayed response', async kind => {
  const h = await harness(), init = h.create(); await init.initialize();
  const base = h.authority.channel(h.auth.token), before = await h.storage.read();
  const client = h.create({ call: async r => {
    const response = await base.call(r); h.advance(kind === 'expired' ? 101 : -1); return response;
  } });
  await expect(client.open()).rejects.toThrow();
  expect(() => client.view()).toThrow('no-verified');
  expect(await h.storage.read()).toEqual(before);
});

it('revoked/forged/wrong-subject sessions cannot sign or commit a local head', async () => {
  const h = await harness(), client = h.create(); await client.initialize();
  const before = await h.storage.read(); h.identity.revoke(h.auth.token);
  await expect(client.local(input)).rejects.toThrow('auth-expired-or-revoked');
  await expect(h.create(h.authority.channel('forged-token')).open()).rejects.toThrow();
  const other = h.identity.issue({ ...scope, uid: 'different-user' }, 10000);
  await expect(h.create(h.authority.channel(other.token), other.id).open()).rejects.toThrow('auth-scope');
  expect(await h.storage.read()).toEqual(before);
  const renewed = h.identity.issue(scope, 10000), newClient = h.create(h.authority.channel(renewed.token), renewed.id);
  await newClient.open();
  expect(newClient.view()).toEqual(client.view());
});

it('retiring during an in-flight auth response does not install the old context or permit retry', async () => {
  const h = await harness(), init = h.create(); await init.initialize();
  const base = h.authority.channel(h.auth.token);
  let client: AuthorityBridge;
  client = h.create({ call: async r => { const response = await base.call(r); client.retire(); return response; } });
  await expect(client.open()).rejects.toThrow();
  expect(client.state().phase).toBe('retired');
  expect(() => client.view()).toThrow();
  await expect(client.recover()).rejects.toThrow('retired-client');
});

it('the independent witness resolves a local commit whose authority finalize response never existed', async () => {
  let crash = false;
  const h = await harness(storage => ({ scope: storage.scope, read: () => storage.read(), writeAtomic: async (e, v) => {
    await storage.writeAtomic(e, v); if (crash) { crash = false; throw Error('after-local-CAS'); }
  } }));
  const client = h.create(); await client.initialize(); crash = true;
  await expect(client.local(input)).rejects.toThrow('after-local-CAS');
  expect(client.view().nextLocalSeq).toBe(1);
  const raw = await h.storage.read();
  const result = await client.recover();
  expect(result?.localSeq).toBe(1);
  expect(client.view().nextLocalSeq).toBe(2);
  expect(await h.storage.read()).toEqual(raw); // Recovery certifies; it does not rewrite or repair.
});

it('an uncommitted prepared write requires explicit same-id retry, not auto-adoption or new sequence', async () => {
  let abort = false;
  const h = await harness(storage => ({ scope: storage.scope, read: () => storage.read(), writeAtomic: async (e, v) => {
    if (abort) { abort = false; throw Error('before-local-CAS'); } await storage.writeAtomic(e, v);
  } }));
  const client = h.create(); await client.initialize(); const raw = await h.storage.read(); abort = true;
  await expect(client.local(input)).rejects.toThrow('before-local-CAS');
  const pending = client.state().pendingRequest;
  await expect(client.recover()).rejects.toThrow('retry-required');
  expect(await h.storage.read()).toEqual(raw);
  expect(client.state().pendingRequest).toBe(pending);
  const result = await client.retryPrepared();
  expect(result?.localSeq).toBe(1);
  expect(client.view().snapshot.ledger.outbox).toHaveLength(1);
});

it('expired prepared permits are retained and block activation rather than silently disappearing', async () => {
  const h = await harness(), base = h.authority.channel(h.auth.token);
  let expire = false;
  const client = h.create({ call: async r => { const response = await base.call(r);
    if (expire && r.kind === 'prepare') { h.advance(101); expire = false; } return response; } });
  await client.initialize(); expire = true; const before = await h.storage.read();
  await expect(client.local(input)).rejects.toThrow();
  await expect(client.recover()).rejects.toThrow('retry-required');
  await expect(client.retryPrepared()).rejects.toThrow('expired-or-unauthorized-permit');
  await expect(h.authority.activate(scope, 'next-generation', 2)).rejects.toThrow('pending-fence');
  expect(await h.storage.read()).toEqual(before);
});

it.each(['Journal', 'unknown-raw'] as const)('%s is preserved and never promoted into the independent head', async kind => {
  let journal: string | null = null;
  const h = await harness(storage => ({ scope: storage.scope, read: async () => ({ ...await storage.read(), journal }),
    writeAtomic: (e, v) => storage.writeAtomic(e, v) }));
  const client = h.create(); await client.initialize();
  if (kind === 'Journal') journal = '{torn-Journal';
  else { const raw = await h.storage.read(); await h.storage.writeAtomic(raw.committed, raw.committed! + ' '); }
  const before = await h.storage.read();
  await expect(client.local(input)).rejects.toThrow();
  await expect(client.recover()).rejects.toThrow('protected');
  expect(await h.storage.read()).toEqual(before);
  expect(journal).toBe(kind === 'Journal' ? '{torn-Journal' : null);
});

it('two devices keep separate replica heads while an active generation/epoch fence blocks both old contexts', async () => {
  const h = await harness(), phone = h.create(); await phone.initialize();
  const context: LocalContext = { ...h.context, storageScope: 'synthetic:pc', actorId: 'pc',
    binding: { ...h.context.binding, incarnation: 'pc-instance' } };
  const storage = await openIsolatedStorage(new IDBFactory(), context.storageScope);
  await h.authority.provision('pc', context, storage);
  const pc = new AuthorityBridge({ replicaId: 'pc', context, storage, channel: h.authority.channel(h.auth.token),
    sessionId: h.auth.id, verifier: h.verifier, now: h.now, nonce: h.nonce, digest });
  await pc.initialize(); await phone.local(input);
  expect(pc.view().nextLocalSeq).toBe(1);
  const a = await h.storage.read(), b = await storage.read();
  await h.authority.activate(scope, 'next-generation', 2);
  await expect(phone.open()).rejects.toThrow('generation-epoch');
  await expect(pc.local(input)).rejects.toThrow('generation-epoch');
  expect(await h.storage.read()).toEqual(a); expect(await storage.read()).toEqual(b);
});

it('receipt/publication tickets are verified capabilities; duplicate and stale notices preserve Phase 1 conflicts', async () => {
  const h = await harness(), client = h.create(); await client.initialize();
  const a = await client.local(input), decision = evaluateAcceptance(baseline, [], a);
  if (decision.kind !== 'accepted') throw Error('receipt required');
  const p1 = makePublication(baseline, [a], client.view().snapshot.checkpoint, 1, digest);
  const b = { ...a, actorId: 'pc', actorIncarnation: 'pc', opId: 'pc:1', commandId: 'pc:1', writes: [{ attribute: 'body' as const, value: 'parallel' }] };
  const p2 = makePublication(baseline, [a, b], { seq: 1, hash: p1.manifest.hash }, 1, digest);
  await h.authority.publishNotice('phone', 'R', { kind: 'receipt', receipt: decision.receipt });
  await h.authority.publishNotice('phone', 'P1', { kind: 'publication', publication: p1 });
  await h.authority.publishNotice('phone', 'P2', { kind: 'publication', publication: p2 });
  for (const id of ['P2', 'P1', 'R', 'P1', 'R']) { await client.receive(await client.notice(id)); await client.drain(); }
  expect(client.view().snapshot.checkpoint.seq).toBe(2);
  expect(client.view().snapshot.ledger.awaiting).toEqual([]);
  expect(client.view().snapshot.evidence.reflections).toHaveLength(1);
  const status = await client.status(); expect(status.conflict).toBe(2); expect(status.complete).toBe(false);
  const copied = JSON.parse(JSON.stringify(await client.notice('R')));
  const before = await h.storage.read();
  await expect(client.receive(copied)).rejects.toThrow('untrusted');
  expect(await h.storage.read()).toEqual(before);
});

it('expired notice capability must be re-fetched; local status alone cannot advance the server published head', async () => {
  const h = await harness(), client = h.create(); await client.initialize();
  const a = await client.local(input), d = evaluateAcceptance(baseline, [], a);
  if (d.kind !== 'accepted') throw Error('receipt required');
  await h.authority.publishNotice('phone', 'R', { kind: 'receipt', receipt: d.receipt });
  const ticket = await client.notice('R'); h.advance(101);
  const before = await h.storage.read(); await expect(client.receive(ticket)).rejects.toThrow('expired-notice');
  expect(await h.storage.read()).toEqual(before); await client.recover();
  await client.receive(await client.notice('R')); await client.drain();
  expect((await client.status()).awaiting).toBe(1);
  const p = makePublication(baseline, [a], client.view().snapshot.checkpoint, 1, digest);
  await h.authority.publishNotice('phone', 'P', { kind: 'publication', publication: p });
  await client.receive(await client.notice('P')); await client.drain();
  expect((await client.status()).complete).toBe(true); // Separate publisher, fresh signed observation, no local DTO.
});

it('a signed old head bundled with a rolled-back backup fails a fresh challenge and never replaces its raw', async () => {
  const h = await harness(), base = h.authority.channel(h.auth.token);
  let cached: SignedReply | undefined;
  const client = h.create({ call: async r => { const response = await base.call(r); if (r.kind === 'head') cached = response; return response; } });
  await client.initialize(); await client.open(); const old = await h.storage.read(); await client.local(input);
  const latest = await h.storage.read();
  await h.storage.writeAtomic(latest.committed, old.committed!);
  const backup = await h.storage.read();
  await expect(h.create({ call: async () => cached! }).open()).rejects.toThrow('authority-proof');
  await expect(h.create().open()).rejects.toThrow('unconfirmed-recovery-head');
  expect(await h.storage.read()).toEqual(backup);
});

it('nonce reuse and arbitrary guard-approval RPC cannot mint a trustworthy current head', async () => {
  const h = await harness(), initial = h.create(); await initial.initialize();
  const client = new AuthorityBridge({ replicaId: 'phone', context: h.context, storage: h.storage,
    channel: h.authority.channel(h.auth.token), sessionId: h.auth.id, verifier: h.verifier, now: h.now, digest, nonce: () => 'reused' });
  await client.open(); const before = await h.storage.read();
  await expect(client.local(input)).rejects.toThrow('reused-challenge');
  const forged = { kind: 'approveGuard', nonce: 'attack', replicaId: 'phone', guard: client.view().snapshot } as unknown as Request;
  await expect(h.authority.channel(h.auth.token).call(forged)).rejects.toThrow('unknown-authority-request');
  expect(await h.storage.read()).toEqual(before);
});

it('existing unknown local data is never overwritten by bootstrap', async () => {
  const h = await harness();
  await h.storage.writeAtomic(null, '{unknown-original'); const original = await h.storage.read();
  await expect(h.create().initialize()).rejects.toThrow('not-empty');
  await expect(h.create().recover()).rejects.toThrow('protected');
  expect(await h.storage.read()).toEqual(original);
});

it('auth revocation after signed prepare blocks commit; a new session cannot silently reuse the old permit', async () => {
  const h = await harness(), base = h.authority.channel(h.auth.token);
  let revoke = false;
  const client = h.create({ call: async r => {
    const response = await base.call(r); if (revoke && r.kind === 'prepare') h.identity.revoke(h.auth.token); return response;
  } });
  await client.initialize(); const before = await h.storage.read(); revoke = true;
  await expect(client.local(input)).rejects.toThrow('revoked');
  const auth = h.identity.issue(scope, 10000), renewed = h.create(h.authority.channel(auth.token), auth.id);
  await expect(renewed.recover()).rejects.toThrow('retry-required');
  await expect(renewed.retryPrepared()).rejects.toThrow('unauthorized-permit');
  expect(await h.storage.read()).toEqual(before);
});

it('expiry while reading the witness is rechecked before CAS starts', async () => {
  let delay: (() => void) | null = null;
  const h = await harness(storage => ({ scope: storage.scope, read: async () => {
    const raw = await storage.read(); if (delay) { delay(); delay = null; } return raw;
  }, writeAtomic: (e, v) => storage.writeAtomic(e, v) }));
  const client = h.create(); await client.initialize(); const before = await h.storage.read();
  delay = () => h.advance(101);
  await expect(client.local(input)).rejects.toThrow('expired-or-unauthorized-permit');
  expect(await h.storage.read()).toEqual(before);
});

it('bootstrap acknowledgment loss can be explicitly recovered from the independently registered genesis', async () => {
  let fail = true;
  const h = await harness(storage => ({ scope: storage.scope, read: () => storage.read(), writeAtomic: async (e, v) => {
    await storage.writeAtomic(e, v); if (fail) { fail = false; throw Error('bootstrap-ack-lost'); }
  } }));
  const client = h.create(); await expect(client.initialize()).rejects.toThrow('bootstrap-ack-lost');
  const raw = await h.storage.read(); expect(raw.committed).not.toBeNull();
  await client.recover(); expect(await h.storage.read()).toEqual(raw);
  expect((await client.local(input)).localSeq).toBe(1);
});

it('a cloned device identity cannot be provisioned as a second independent writer', async () => {
  const h = await harness();
  const context = { ...h.context, storageScope: 'synthetic:clone' };
  const storage = await openIsolatedStorage(new IDBFactory(), context.storageScope);
  await expect(h.authority.provision('clone', context, storage)).rejects.toThrow('actor-identity');
  expect(await storage.read()).toEqual({ committed: null, journal: null });
});

it('expired authentication cannot fetch a replacement guard even when the persisted local head is valid', async () => {
  const h = await harness(), client = h.create(); await client.initialize();
  const before = await h.storage.read(); h.advance(100001);
  await expect(client.open()).rejects.toThrow('auth-expired');
  await expect(client.recover()).rejects.toThrow('auth-expired');
  expect(await h.storage.read()).toEqual(before);
});

it('an authority that lost its registry cannot self-bootstrap trust from an existing snapshot', async () => {
  const h = await harness(), client = h.create(); await client.initialize(); await client.local(input);
  const before = await h.storage.read();
  const empty = new MockAuthority({ signer: h.signer, authenticate: token => h.identity.authenticate(token), now: h.now, digest, ttl: 100 });
  const disconnected = h.create(empty.channel(h.auth.token));
  await expect(disconnected.open()).rejects.toThrow('unknown-replica');
  await expect(disconnected.recover()).rejects.toThrow('unknown-replica');
  expect(disconnected.state().phase).toBe('blocked');
  expect(await h.storage.read()).toEqual(before);
});

it('an authenticated account switch uses a separate realm/replica and cannot mix identically named receipts', async () => {
  const h = await harness(), first = h.create(); await first.initialize();
  const a = await first.local(input), receipt = evaluateAcceptance(baseline, [], a);
  if (receipt.kind !== 'accepted') throw Error('receipt required');
  await h.authority.publishNotice('phone', 'same-id', { kind: 'receipt', receipt: receipt.receipt });
  const otherScope = { ...scope, uid: 'second-owner' }, otherAuth = h.identity.issue(otherScope, 10000);
  const context: LocalContext = { ...h.context, storageScope: 'synthetic:second-owner',
    baseline: { ...baseline, scope: otherScope }, binding: { ...h.context.binding, scope: otherScope } };
  const storage = await openIsolatedStorage(new IDBFactory(), context.storageScope);
  await h.authority.provision('second-owner-phone', context, storage);
  const second = new AuthorityBridge({ replicaId: 'second-owner-phone', context, storage, channel: h.authority.channel(otherAuth.token),
    sessionId: otherAuth.id, verifier: h.verifier, now: h.now, digest, nonce: h.nonce });
  first.retire(); await second.initialize(); const oldRaw = await h.storage.read();
  const b = await second.local(input), d = evaluateAcceptance(context.baseline, [], b);
  if (d.kind !== 'accepted') throw Error('receipt required');
  await h.authority.publishNotice('second-owner-phone', 'same-id', { kind: 'receipt', receipt: d.receipt });
  await second.receive(await second.notice('same-id')); await second.drain();
  expect(second.view().snapshot.evidence.receipts[0].receipt.scope).toEqual(otherScope);
  expect(await h.storage.read()).toEqual(oldRaw);
  await expect(first.local(input)).rejects.toThrow('retired-client');
});

it('revocation during post-CAS witness read cannot finalize authority until a freshly authenticated explicit recovery', async () => {
  let reads = 0, revoke: (() => void) | null = null;
  const h = await harness(storage => ({ scope: storage.scope, read: async () => {
    const raw = await storage.read(); if (++reads === 2 && revoke) revoke(); return raw;
  }, writeAtomic: (e, v) => storage.writeAtomic(e, v) }));
  const client = h.create(); await client.initialize(); reads = 0; revoke = () => h.identity.revoke(h.auth.token);
  await expect(client.local(input)).rejects.toThrow('revoked');
  const after = await h.storage.read(); expect(after.committed).not.toBeNull();
  revoke = null;
  const auth = h.identity.issue(scope, 10000), newClient = h.create(h.authority.channel(auth.token), auth.id);
  await expect(newClient.open()).rejects.toThrow('unconfirmed-recovery-head');
  const result = await newClient.recover();
  expect(result?.localSeq).toBe(1);
  expect(await h.storage.read()).toEqual(after);
});

it('an outstanding authority check is visibly read-only and never reports cached readiness', async () => {
  const h = await harness(), base = h.authority.channel(h.auth.token);
  let delayed = false, release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const client = h.create({ call: async r => { if (delayed) await gate; return base.call(r); } });
  await client.initialize(); delayed = true;
  const check = client.open(); await Promise.resolve();
  expect(client.state()).toMatchObject({ phase: 'checking', readOnly: true, authorityChecking: true });
  release(); await check;
  expect(client.state()).toMatchObject({ phase: 'ready', readOnly: false });
});

it('publisher aliases cannot register contradictory accepted payloads for the same operation identity', async () => {
  const h = await harness(), client = h.create(); await client.initialize();
  const a = await client.local(input), first = evaluateAcceptance(baseline, [], a);
  if (first.kind !== 'accepted') throw Error('receipt required');
  await h.authority.publishNotice('phone', 'original-receipt', { kind: 'receipt', receipt: first.receipt });
  const altered = evaluateAcceptance(baseline, [], { ...a, writes: [{ attribute: 'body', value: 'contradictory' }] });
  if (altered.kind !== 'accepted') throw Error('syntactically valid altered fixture required');
  await expect(h.authority.publishNotice('phone', 'different-notice-id', { kind: 'receipt', receipt: altered.receipt })).rejects.toThrow('invalid-server-receipt');
  await client.receive(await client.notice('original-receipt')); await client.drain();
  expect(client.view().snapshot.evidence.receipts.map(f => f.receipt)).toEqual([first.receipt]);
});

it('mutating a transport reply cannot mutate the external authority registry through shared references', async () => {
  const h = await harness(), client = h.create(); await client.initialize();
  const reply = await h.authority.channel(h.auth.token).call({ kind: 'head', nonce: 'untrusted-copy', replicaId: 'phone' });
  (reply.claims.binding as { generation: string }).generation = 'mutated-reply-only';
  const reopened = h.create(); await reopened.open();
  expect(reopened.view()).toEqual(client.view());
});
