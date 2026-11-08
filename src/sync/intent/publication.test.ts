import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { evaluateAcceptance, recordAccepted } from './acceptance';
import { applyPublication, initialClient, makePublication } from './publication';
import { baseline, intent, scope } from './testFixtures';
import type { Intent } from './types';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const binding = { scope, generation: baseline.generation, baselineSeal: baseline.seal,
  incarnation: 'client-1', activationToken: 'activation-a', controlEpoch: 3 };
const on = intent('on', { attribute: 'emphasis', value: true });
const off = intent('off', { attribute: 'emphasis', value: false }, ['on']);
const fresh = () => initialClient(binding, baseline);
const c1 = () => makePublication(baseline, [on], fresh().checkpoint, 3, digest);
const c2 = () => makePublication(baseline, [on, off], { seq: 1, hash: c1().manifest.hash }, 3, digest);

describe('pure publication application — R2-01/02/03/06/08', () => {
  it('OFF then late matching ON checkpoint cannot roll values, watermark or awaiting back', () => {
    let client = fresh();
    client = applyPublication(client, c1(), binding, baseline, digest).client;
    client = applyPublication(client, c2(), binding, baseline, digest).client;
    const result = applyPublication(client, c1(), binding, baseline, digest);
    expect(result.kind).toBe('stale');
    expect(result.client).toBe(client);
    expect(result.client.state.fields.find(f => f.attribute === 'emphasis')?.value).toBe(false);
  });
  it('same checkpoint is no-op; same sequence with different hash is quarantined', () => {
    const current = applyPublication(fresh(), c1(), binding, baseline, digest).client;
    expect(applyPublication(current, c1(), binding, baseline, digest).kind).toBe('noop');
    const fork = makePublication(baseline, [off], fresh().checkpoint, 3, digest);
    expect(applyPublication(current, fork, binding, baseline, digest).kind).toBe('rejected');
    expect(applyPublication(current, fork, binding, baseline, digest).client).toBe(current);
  });
  it('reverse checkpoint arrival is held until its ancestor is installed', () => {
    const ahead = applyPublication(fresh(), c2(), binding, baseline, digest);
    expect(ahead.kind).toBe('pending');
    const first = applyPublication(ahead.client, c1(), binding, baseline, digest);
    expect(applyPublication(first.client, c2(), binding, baseline, digest).client)
      .toEqual(applyPublication(applyPublication(fresh(), c1(), binding, baseline, digest).client, c2(), binding, baseline, digest).client);
  });
  it('persisted JSON restart keeps the high-watermark; delayed checkpoint cannot retire newer pending', () => {
    const current = applyPublication(applyPublication(fresh(), c1(), binding, baseline, digest).client, c2(), binding, baseline, digest).client;
    const restarted = JSON.parse(JSON.stringify({ ...current, ledger: { outbox: [intent('new', { attribute: 'body', value: 'pending' })], awaiting: [off] } }));
    expect(applyPublication(restarted, c1(), binding, baseline, digest).client).toEqual(restarted);
  });
  it('old generation, epoch, account, incarnation and activation callbacks cannot apply', () => {
    for (const foreign of [
      { ...binding, generation: 'old' }, { ...binding, scope: { ...scope, uid: 'other' } },
      { ...binding, controlEpoch: 2 }, { ...binding, incarnation: 'old-client' },
      { ...binding, activationToken: 'retired' },
    ]) expect(applyPublication(fresh(), c1(), foreign, baseline, digest).kind).toBe('rejected');
  });
  it('partial/mixed projection and result cannot apply; no pending record is removed', () => {
    const first = applyPublication(fresh(), c1(), binding, baseline, digest).client;
    const mixed = { ...c2(), state: { ...c2().state, results: c1().state.results } };
    expect(applyPublication(first, mixed, binding, baseline, digest).kind).toBe('rejected');
    const incomplete = { ...c2(), state: { ...c2().state, fields: [] } };
    expect(applyPublication(first, incomplete, binding, baseline, digest).client).toBe(first);
  });
  it('acceptance moves only to awaiting; matching applied result retires awaiting but keeps immutable intent', () => {
    const received = evaluateAcceptance(baseline, [], on);
    if (received.kind !== 'accepted') throw Error('acceptance required');
    const client = { ...fresh(), ledger: recordAccepted({ outbox: [on], awaiting: [] }, received.receipt) };
    expect(client.ledger.awaiting).toEqual([on]);
    const result = applyPublication(client, c1(), binding, baseline, digest);
    expect(result.client.ledger.awaiting).toHaveLength(0);
    expect(result.client.state.intents).toEqual([on]);
  });
  it('accepted conflicts and dependencies are preserved in awaiting, not reported as applied', () => {
    const a = intent('a', { attribute: 'body', value: 'a' });
    const b = intent('b', { attribute: 'body', value: 'b' });
    const missing = intent('missing', { attribute: 'emphasis', value: false }, ['unknown']);
    const pending: Intent[] = [a, b, missing];
    const client = { ...fresh(), ledger: { outbox: [], awaiting: pending } };
    const publication = makePublication(baseline, pending, client.checkpoint, 3, digest);
    const result = applyPublication(client, publication, binding, baseline, digest);
    expect(result.client.ledger.awaiting).toEqual(pending);
    expect(result.client.state.results.map(r => r.status)).toEqual(['conflict', 'conflict', 'dependency-pending']);
  });
  it('new legitimate concurrent intent is published as a newer conflict, not rejected as stale', () => {
    const current = applyPublication(applyPublication(fresh(), c1(), binding, baseline, digest).client, c2(), binding, baseline, digest).client;
    const concurrent = intent('concurrent', { attribute: 'emphasis', value: true });
    const next = makePublication(baseline, [on, off, concurrent], current.checkpoint, 3, digest);
    const result = applyPublication(current, next, binding, baseline, digest);
    expect(result.kind).toBe('applied');
    expect(result.client.state.fields.find(f => f.attribute === 'emphasis')?.candidates).toHaveLength(2);
  });
  it('a newer validly hashed checkpoint cannot drop previously covered operations', () => {
    const current = applyPublication(fresh(), c1(), binding, baseline, digest).client;
    const omission = makePublication(baseline, [], current.checkpoint, 3, digest);
    expect(applyPublication(current, omission, binding, baseline, digest).kind).toBe('rejected');
    expect(applyPublication(current, omission, binding, baseline, digest).client).toBe(current);
  });
});
