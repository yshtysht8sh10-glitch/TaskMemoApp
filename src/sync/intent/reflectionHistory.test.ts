import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { evaluateAcceptance } from './acceptance';
import { applyPublication, initialClient, makePublication, recordClientAccepted } from './publication';
import type { ClientSnapshot } from './publication';
import { baseline, intent, scope } from './testFixtures';
import { reduceIntents } from './reducer';
import type { Intent } from './types';

const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const binding = { scope, generation: baseline.generation, baselineSeal: baseline.seal,
  incarnation: 'rf2', activationToken: 'rf2', controlEpoch: 1 };
const restart = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const orders = [['R', 'P1', 'P2'], ['P1', 'R', 'P2'], ['P1', 'P2', 'R']];
function scenario(kind: 'completion' | 'body' | 'protection') {
  const a = kind === 'body' ? intent('a', { attribute: 'body', value: 'A' })
    : intent('a', { attribute: 'completion', value: { status: 'completed', completedAt: '2026-11-09T01:00:00.000Z' } });
  const b = kind === 'body' ? intent('b', { attribute: 'body', value: 'B' })
    : intent(kind === 'protection' ? 'a' : 'b', { attribute: 'completion', value: { status: 'completed', completedAt: '2026-11-09T02:00:00.000Z' } });
  const other = intent('unsent', { attribute: 'title', value: 'must remain unsent' });
  const fresh = (): ClientSnapshot => ({ ...initialClient(binding, baseline), ledger: { outbox: [a, other], awaiting: [] } });
  const p1 = makePublication(baseline, [a], fresh().checkpoint, 1, digest);
  const p2 = makePublication(baseline, [a, b], { seq: 1, hash: p1.manifest.hash }, 1, digest);
  const decision = evaluateAcceptance(baseline, [], a);
  if (decision.kind !== 'accepted') throw Error('receipt required');
  const step = (current: ClientSnapshot, event: string): ClientSnapshot => restart(event === 'R'
    ? recordClientAccepted(restart(current), restart(decision.receipt), binding)
    : applyPublication(restart(current), restart(event === 'P1' ? p1 : p2), binding, baseline, digest).client);
  return { a, b, other, fresh, p1, p2, receipt: decision.receipt, step };
}

it.each(['completion', 'body', 'protection'] as const)('R-F2: applied -> %s preserves the same complete snapshot across R/P1/P2 orders', kind => {
  const s = scenario(kind);
  const clients = orders.map(order => order.reduce(s.step, s.fresh()));
  for (const client of clients) {
    expect(client.ledger).toEqual({ outbox: [s.other], awaiting: [] });
    expect(client).toEqual(clients[0]);
    expect(['R', 'P1', 'P2', 'R', 'P2'].reduce(s.step, client)).toEqual(client);
    expect(client.evidence.receipts).toEqual([{ binding, receipt: s.receipt }]);
    expect(client.evidence.reflections).toEqual([{ binding, checkpoint: { seq: 1, hash: s.p1.manifest.hash },
      intent: s.a, result: { opId: 'a', status: 'applied', reasons: [] } }]);
    expect(client.evidence.publications.map(f => f.publication)).toEqual(expect.arrayContaining([s.p1, s.p2]));
    if (kind !== 'protection') {
      expect(client.state.results.every(r => r.status === 'conflict')).toBe(true);
      expect(client.state.fields.find(f => f.attribute === s.a.writes[0].attribute)?.candidates).toHaveLength(2);
    } else {
      expect(client.protection?.intents).toHaveLength(2);
      expect(client.checkpoint.seq).toBe(1);
    }
  }
});

function permutations<T>(items: T[]): T[][] {
  return items.length ? items.flatMap((item, i) => permutations(items.filter((_, j) => i !== j)).map(rest => [item, ...rest])) : [[]];
}

it('duplicate R/P1/P2 in 720 labelled orders converge after pending predecessor redelivery, with JSON at every step', () => {
  const s = scenario('completion');
  const expected = ['R', 'P1', 'P2'].reduce(s.step, s.fresh());
  for (const order of permutations(['R', 'P1', 'P2', 'R', 'P1', 'P2'])) {
    const candidate = order.reduce(s.step, s.fresh());
    // No hidden queue is introduced: pending P2 must be redelivered after P1.
    const final = ['P1', 'P2', 'R'].reduce(s.step, candidate);
    expect(final).toEqual(expected);
  }
});

it.each(['conflict', 'dependency-pending'] as const)('initial %s does not count as historical applied just because coverage contains A', status => {
  const s = scenario('body');
  const a = status === 'conflict' ? s.a : intent('a', { attribute: 'body', value: 'waiting' }, ['missing']);
  const initial = { ...initialClient(binding, baseline), ledger: { outbox: [a, s.other], awaiting: [] } };
  const p = makePublication(baseline, status === 'conflict' ? [a, s.b] : [a], initial.checkpoint, 1, digest);
  const d = evaluateAcceptance(baseline, [], a);
  if (d.kind !== 'accepted') throw Error('receipt required');
  const receipt = (c: ClientSnapshot) => restart(recordClientAccepted(restart(c), d.receipt, binding));
  const publish = (c: ClientSnapshot) => restart(applyPublication(restart(c), p, binding, baseline, digest).client);
  const early = publish(receipt(initial)), late = receipt(publish(initial));
  expect(early).toEqual(late);
  expect(late.ledger).toEqual({ outbox: [s.other], awaiting: [a] });
  expect(late.evidence.reflections).toEqual([]);
  expect(late.state.results.find(r => r.opId === 'a')?.status).toBe(status);
});

it('conflict -> explicit resolve preserves both conflicting originals and all result history across late receipts', () => {
  const s = scenario('body');
  const resolve = intent('resolve', { attribute: 'body', value: 'chosen' }, ['a', 'b'], { intentKind: 'resolve' });
  const p3 = makePublication(baseline, [s.a, s.b, resolve], { seq: 2, hash: s.p2.manifest.hash }, 1, digest);
  const final = orders.map(order => {
    const c = order.reduce(s.step, s.fresh());
    return restart(applyPublication(c, p3, binding, baseline, digest).client);
  });
  for (const c of final) {
    expect(c).toEqual(final[0]);
    expect(c.ledger).toEqual({ outbox: [s.other], awaiting: [] });
    expect(c.state.fields.find(f => f.attribute === 'body')?.value).toBe('chosen');
    expect(c.state.intents).toHaveLength(3);
    expect(c.evidence.publications).toHaveLength(3);
    expect(c.evidence.publications.find(f => f.publication.manifest.seq === 2)?.publication.state.results.every(r => r.status === 'conflict')).toBe(true);
    expect(c.evidence.reflections.some(f => f.checkpoint.seq === 1 && f.intent.opId === 'a')).toBe(true);
  }
  const noEarlyReceipt = ['P1', 'P2'].reduce(s.step, s.fresh());
  const resolved = applyPublication(noEarlyReceipt, p3, binding, baseline, digest).client;
  expect(s.step(resolved, 'R')).toEqual(final[0]);
});

it('protected publication results cannot create reflected evidence for a different covered operation', () => {
  const s = scenario('protection');
  const covered = intent('covered', { attribute: 'body', value: 'not normally applied' });
  const initial = { ...initialClient(binding, baseline), ledger: { outbox: [s.a, covered], awaiting: [] } };
  const p = makePublication(baseline, [s.a, s.b, covered], initial.checkpoint, 1, digest);
  const d = evaluateAcceptance(baseline, [], covered);
  if (d.kind !== 'accepted') throw Error('receipt required');
  const receipt = (c: ClientSnapshot) => recordClientAccepted(restart(c), d.receipt, binding);
  const pub = (c: ClientSnapshot) => applyPublication(restart(c), p, binding, baseline, digest).client;
  expect(pub(receipt(initial))).toEqual(receipt(pub(initial)));
  expect(receipt(pub(initial)).ledger.awaiting).toEqual([covered]);
  expect(receipt(pub(initial)).evidence.reflections).toEqual([]);
  expect(receipt(pub(initial)).protection).not.toBeNull();
});

it('initial conflict retires awaiting only after a verified explicit resolve, not after conflict coverage', () => {
  const s = scenario('body');
  const conflict = makePublication(baseline, [s.a, s.b], s.fresh().checkpoint, 1, digest);
  const resolve = intent('resolve', { attribute: 'body', value: 'chosen' }, ['a', 'b'], { intentKind: 'resolve' });
  const solved = makePublication(baseline, [s.a, s.b, resolve], { seq: 1, hash: conflict.manifest.hash }, 1, digest);
  const step = (c: ClientSnapshot, event: string) => event === 'R' ? s.step(c, event)
    : restart(applyPublication(restart(c), event === 'P1' ? conflict : solved, binding, baseline, digest).client);
  const unresolved = ['R', 'P1'].reduce(step, s.fresh());
  expect(unresolved.ledger.awaiting).toEqual([s.a]);
  expect(unresolved.evidence.reflections).toEqual([]);
  const results = orders.map(order => order.reduce(step, s.fresh()));
  for (const c of results) {
    expect(c).toEqual(results[0]);
    expect(c.ledger).toEqual({ outbox: [s.other], awaiting: [] });
    expect(c.evidence.reflections.every(f => f.checkpoint.seq === 2)).toBe(true);
    expect(c.evidence.publications).toHaveLength(2);
    expect(c.state.fields.find(f => f.attribute === 'body')?.value).toBe('chosen');
  }
});

it('historical facts never authorize a foreign binding, generation, account or changed immutable receipt', () => {
  const s = scenario('body');
  const current = ['P1', 'P2'].reduce(s.step, s.fresh());
  for (const receipt of [{ ...s.receipt, generation: 'old' }, { ...s.receipt, scope: { ...scope, uid: 'other' } },
    { ...s.receipt, canonicalIntent: s.receipt.canonicalIntent + ' ' }]) {
    expect(recordClientAccepted(current, receipt, binding)).toBe(current);
  }
  for (const foreign of [{ ...binding, incarnation: 'old' }, { ...binding, controlEpoch: 9 }, { ...binding, activationToken: 'retired' }])
    expect(recordClientAccepted(current, s.receipt, foreign)).toBe(current);
});

it('multiple receipts normalize their complete evidence and awaiting order without retiring an unreceived operation', () => {
  const s = scenario('body');
  const d = evaluateAcceptance(baseline, [], s.b);
  if (d.kind !== 'accepted') throw Error('receipt required');
  const initial = { ...s.fresh(), ledger: { outbox: [s.a, s.b, s.other], awaiting: [] } };
  const step = (c: ClientSnapshot, event: string) => event === 'RB'
    ? restart(recordClientAccepted(restart(c), d.receipt, binding)) : s.step(c, event);
  const expected = ['R', 'RB', 'P1', 'P2'].reduce(step, initial);
  for (const order of permutations(['R', 'RB', 'P1', 'P2']))
    expect(['P1', 'P2'].reduce(step, order.reduce(step, initial))).toEqual(expected);
  expect(expected.ledger).toEqual({ outbox: [s.other], awaiting: [s.b] });
  expect(expected.evidence.receipts).toHaveLength(2);
});

it('720 six-operation prefix deliveries preserve cancellation, OFF, concurrent body candidates and original evidence', () => {
  const s = scenario('completion');
  const cancel = intent('cancel', { attribute: 'completion', value: { status: 'active', completedAt: null } }, ['a']);
  const on = intent('on', { attribute: 'emphasis', value: true });
  const off = intent('off', { attribute: 'emphasis', value: false }, ['on']);
  const ops = [s.a, cancel, on, off, intent('body-a', { attribute: 'body', value: 'A' }), intent('body-b', { attribute: 'body', value: 'B' })];
  const expected = reduceIntents(baseline, ops);
  for (const order of permutations(ops)) {
    let prefix: readonly Intent[] = [];
    for (const op of order) prefix = restart(reduceIntents(baseline, [...prefix, op, op]).intents);
    expect(reduceIntents(baseline, prefix)).toEqual(expected);
  }
  expect(expected.fields.find(f => f.attribute === 'completion')?.value).toEqual({ status: 'active', completedAt: null });
  expect(expected.fields.find(f => f.attribute === 'emphasis')?.value).toBe(false);
  expect(expected.fields.find(f => f.attribute === 'body')?.candidates).toHaveLength(2);
});
