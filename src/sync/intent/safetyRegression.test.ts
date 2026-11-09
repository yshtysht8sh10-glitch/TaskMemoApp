import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import * as publication from './publication';
import { evaluateAcceptance, recordAccepted } from './acceptance';
import { baseline, intent, scope } from './testFixtures';
import { reduceIntents } from './reducer';
import type { Intent } from './types';

const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const binding = { scope, generation: baseline.generation, baselineSeal: baseline.seal,
  incarnation: 'review', activationToken: 'review', controlEpoch: 1 };
const fresh = () => publication.initialClient(binding, baseline);
const a = intent('a', { attribute: 'completion', value: { status: 'completed', completedAt: '2026-11-08T01:00:00.000Z' } });
const p1 = () => publication.makePublication(baseline, [a], fresh().checkpoint, 1, digest);
const completed = () => publication.applyPublication(fresh(), p1(), binding, baseline, digest).client;

it('F1: opId collision protects an applied completion instead of publishing baseline active', () => {
  const current = completed();
  const other = { ...a, ...intent('a', { attribute: 'completion', value: { status: 'active', completedAt: null } }) };
  const next = publication.makePublication(baseline, [a, other], current.checkpoint, 1, digest);
  const result = publication.applyPublication(current, next, binding, baseline, digest);
  expect(result.kind).toBe('protected');
  expect(result.client.state).toEqual(current.state);
  expect(result.client.checkpoint).toEqual(current.checkpoint);
});

it('F1: split command cannot invalidate an applied completion into ordinary baseline', () => {
  const current = completed();
  const other = intent('b', { attribute: 'body', value: 'new body' }, [], { commandId: a.commandId });
  const next = publication.makePublication(baseline, [a, other], current.checkpoint, 1, digest);
  const result = publication.applyPublication(current, next, binding, baseline, digest);
  expect(result.kind).toBe('protected');
  expect(result.client.state).toEqual(current.state);
});

it('F2: publication-before-accepted settles exactly the same ledger without a new checkpoint', () => {
  const receipt = evaluateAcceptance(baseline, [], a);
  if (receipt.kind !== 'accepted') throw Error('expected receipt');
  const pending = { ...fresh(), ledger: { outbox: [a], awaiting: [] } };
  const first = publication.applyPublication({ ...pending, ledger: recordAccepted(pending.ledger, receipt.receipt) }, p1(), binding, baseline, digest).client;
  const second = publication.applyPublication(pending, p1(), binding, baseline, digest).client;
  const settled = publication.recordClientAccepted(second, receipt.receipt, binding);
  expect(settled.ledger).toEqual(first.ledger);
});

function permutations<T>(items: T[]): T[][] {
  return items.length ? items.flatMap((item, i) => permutations(items.filter((_, j) => j !== i)).map(rest => [item, ...rest])) : [[]];
}

it.each(['opId', 'commandId', 'actorSequence'] as const)('%s evidence is order independent, sticky and retained after restart', kind => {
  const other = kind === 'opId' ? intent('a', { attribute: 'completion', value: { status: 'active', completedAt: null } })
    : intent('b', { attribute: 'body', value: 'other' }, [], kind === 'commandId'
      ? { commandId: a.commandId } : { actorId: a.actorId, actorIncarnation: a.actorIncarnation, localSeq: a.localSeq });
  let quarantine;
  for (const ops of permutations([a, other])) {
    const reduced = reduceIntents(baseline, ops);
    expect(reduced.protection).toHaveLength(1);
    expect(reduced.fields.every(f => !('value' in f))).toBe(true);
    const current = completed();
    const candidate = publication.makePublication(baseline, ops, current.checkpoint, 1, digest);
    const result = publication.applyPublication(current, candidate, binding, baseline, digest);
    expect(result.kind).toBe('protected');
    expect(result.client.ledger).toEqual(current.ledger);
    expect(result.client.state).toEqual(current.state);
    expect(result.client.protection?.intents).toHaveLength(2);
    if (quarantine) expect(result.client.protection).toEqual(quarantine);
    quarantine = result.client.protection;
    const restarted = JSON.parse(JSON.stringify(result.client));
    const clean = publication.makePublication(baseline, [a], restarted.checkpoint, 1, digest);
    const retry = publication.applyPublication(restarted, clean, binding, baseline, digest);
    expect(retry.kind).toBe('protected');
    expect(retry.client.protection).toEqual(quarantine);
    const conflictFirst = publication.applyPublication(fresh(), publication.makePublication(baseline, ops, fresh().checkpoint, 1, digest), binding, baseline, digest);
    expect(conflictFirst.kind).toBe('protected');
    expect(conflictFirst.client.protection).toEqual(quarantine);
  }
});

it('all 120 incremental deliveries preserve the same evidence, candidates and results', () => {
  const on = intent('on', { attribute: 'emphasis', value: true });
  const off = intent('off', { attribute: 'emphasis', value: false }, ['on']);
  const cancel = intent('cancel', { attribute: 'completion', value: { status: 'active', completedAt: null } }, ['a']);
  const body = intent('body', { attribute: 'body', value: 'new body' });
  const ops = [a, cancel, on, off, body];
  const expected = reduceIntents(baseline, ops);
  for (const order of permutations(ops)) {
    let state = reduceIntents(baseline, []);
    for (const op of order) state = reduceIntents(baseline, [...JSON.parse(JSON.stringify(state.intents)), op, op]);
    expect(state).toEqual(expected);
    expect(state.fields.find(f => f.attribute === 'completion')?.value).toEqual({ status: 'active', completedAt: null });
    expect(state.fields.find(f => f.attribute === 'emphasis')?.value).toBe(false);
  }
});

it('accepted/publication duplicates in every order settle after JSON restart while preserving new pending', () => {
  const decision = evaluateAcceptance(baseline, [], a);
  if (decision.kind !== 'accepted') throw Error('receipt required');
  const extra = intent('later', { attribute: 'body', value: 'unsent' });
  let expected;
  for (const order of permutations(['accepted', 'publication', 'accepted', 'publication'])) {
    let client: publication.ClientSnapshot = { ...fresh(), ledger: { outbox: [a, extra], awaiting: [] as Intent[] } };
    for (const event of order) {
      client = JSON.parse(JSON.stringify(client));
      client = event === 'accepted' ? publication.recordClientAccepted(client, decision.receipt, binding)
        : publication.applyPublication(client, p1(), binding, baseline, digest).client;
    }
    expect(client.ledger).toEqual({ outbox: [extra], awaiting: [] });
    if (expected) expect(client).toEqual(expected);
    expected = client;
  }
});

it('foreign, retired and mismatched accepted notifications never retire evidence', () => {
  const decision = evaluateAcceptance(baseline, [], a);
  if (decision.kind !== 'accepted') throw Error('receipt required');
  const current = { ...completed(), ledger: { outbox: [a], awaiting: [] } };
  for (const receipt of [
    { ...decision.receipt, generation: 'old' },
    { ...decision.receipt, scope: { ...scope, uid: 'other' } },
    { ...decision.receipt, canonicalIntent: 'different' },
  ]) expect(publication.recordClientAccepted(current, receipt, binding)).toBe(current);
  expect(publication.recordClientAccepted(current, decision.receipt, { ...binding, activationToken: 'retired' })).toBe(current);
});

it('late acceptance retains conflicts, missing dependencies, rejected operations and protected evidence', () => {
  const other = intent('b', { attribute: 'completion', value: { status: 'active', completedAt: null } });
  const missing = intent('missing', { attribute: 'body', value: 'pending' }, ['absent']);
  const invalid = { ...a, opId: 'invalid', generation: 'old' };
  const current = { ...fresh(), ledger: { outbox: [a, missing, invalid], awaiting: [] } };
  let client = publication.applyPublication(current, publication.makePublication(baseline, [a, other, missing, invalid], current.checkpoint, 1, digest), binding, baseline, digest).client;
  for (const op of [a, missing]) {
    const receipt = evaluateAcceptance(baseline, [], op);
    if (receipt.kind !== 'accepted') throw Error('receipt required');
    client = publication.recordClientAccepted(client, receipt.receipt, binding);
  }
  expect(client.ledger.awaiting).toEqual([a, missing]);
  expect(client.ledger.outbox).toEqual([invalid]);
  const pending = { ...completed(), ledger: { outbox: [a], awaiting: [] } };
  const protectedClient = publication.applyPublication(pending, publication.makePublication(baseline, [a, { ...a, commandId: 'collision' }], pending.checkpoint, 1, digest), binding, baseline, digest).client;
  const receipt = evaluateAcceptance(baseline, [], a);
  if (receipt.kind !== 'accepted') throw Error('receipt required');
  const received = publication.recordClientAccepted(protectedClient, receipt.receipt, binding);
  // R-F2: P1 already confirmed this exact payload. Protection must not erase that fact.
  expect(received.ledger.awaiting).toEqual([]);
  expect(received.evidence.reflections.some(f => f.intent.opId === a.opId && f.checkpoint.seq === 1)).toBe(true);
  expect(received.evidence.receipts.map(f => f.receipt)).toEqual([receipt.receipt]);
  expect(received.evidence.publications.some(f => f.outcome === 'protected')).toBe(true);
  expect(received.protection).toEqual(protectedClient.protection);
});
