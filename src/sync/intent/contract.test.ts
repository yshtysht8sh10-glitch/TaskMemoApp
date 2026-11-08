import { describe, expect, it } from 'vitest';

import { evaluateAcceptance, recordAccepted } from './acceptance';
import { reduceIntents } from './reducer';
import type { Baseline, Intent, Write } from './types';

import { baseline, intent, observation, scope } from './testFixtures';

const complete = () => intent('complete', { attribute: 'completion', value: { status: 'completed', completedAt: '2026-11-08T01:00:00.000Z' } });
const body = () => intent('body', { attribute: 'body', value: 'edited' });
const on = () => intent('on', { attribute: 'emphasis', value: true });
const off = () => intent('off', { attribute: 'emphasis', value: false }, ['on']);
const field = (ops: Intent[], attribute: Write['attribute']) => reduceIntents(baseline, ops).fields.find(f => f.attribute === attribute)!;
function permutations<T>(items: T[]): T[][] {
  return items.length ? items.flatMap((item, i) => permutations(items.filter((_, j) => j !== i)).map(rest => [item, ...rest])) : [[]];
}

describe('intent-v1 Phase 1 — approved design 212461c', () => {
  it('Q1/Q6, S3/S4, R2-05: completion and body compose in both orders', () => {
    for (const ops of permutations([complete(), body()])) {
      expect(field(ops, 'completion').value).toEqual(complete().writes[0].value);
      expect(field(ops, 'body').value).toBe('edited');
      expect(reduceIntents(baseline, ops).results.every(r => r.status === 'applied')).toBe(true);
    }
  });
  it('S3/S4: completion and emphasis compose without copying completion into emphasis', () => {
    for (const ops of permutations([complete(), on()])) {
      expect(field(ops, 'completion').value).toEqual(complete().writes[0].value);
      expect(field(ops, 'emphasis').value).toBe(true);
    }
  });
  it('S5, R2-01/05: OFF dominates its observed ON including child-first delivery', () => {
    expect(reduceIntents(baseline, [off()]).results[0].status).toBe('dependency-pending');
    for (const ops of permutations([on(), off(), body()])) {
      expect(field(ops, 'emphasis').value).toBe(false);
      expect(field(ops, 'emphasis').candidates.map(c => c.head)).toEqual([{ kind: 'operation', opId: 'off' }]);
    }
  });
  it('Q3, R2-04: cancellation supersedes observed completion, including late replay', () => {
    const cancel = intent('cancel', { attribute: 'completion', value: { status: 'active', completedAt: null } }, ['complete']);
    for (const ops of permutations([cancel, complete(), complete()])) {
      expect(field(ops, 'completion').value).toEqual({ status: 'active', completedAt: null });
      expect(reduceIntents(baseline, ops).intents).toHaveLength(2);
    }
  });
  it('Q4/Q5/Q7: placement and completion compose without restoring obsolete membership', () => {
    const move = intent('move', { attribute: 'placement', value: { parentId: 'new-queue', sortKey: 'a3', membershipEpoch: 'm2' } });
    for (const ops of permutations([move, complete(), body()])) {
      expect(field(ops, 'placement').value).toEqual(move.writes[0].value);
      expect(field(ops, 'completion').value).toEqual(complete().writes[0].value);
    }
  });
  it('preserves same-attribute concurrent candidates; opId and clocks cannot choose business winners', () => {
    const other = intent('other', { attribute: 'emphasis', value: false }, [], { createdAt: '2000-01-01T00:00:00.000Z' });
    const a = reduceIntents(baseline, [on(), other]);
    expect(a).toEqual(reduceIntents(baseline, [other, on()]));
    expect(field([on(), other], 'emphasis').value).toBeUndefined();
    expect(field([on(), other], 'emphasis').candidates).toHaveLength(2);
    expect(a.results.every(r => r.status === 'conflict')).toBe(true);
  });
  it('explicit resolution observes every known head and retains historical intents', () => {
    const other = intent('other', { attribute: 'emphasis', value: false });
    const resolve = intent('resolve', { attribute: 'emphasis', value: false }, ['on', 'other'], { intentKind: 'resolve' });
    for (const ops of permutations([resolve, other, on()])) {
      expect(field(ops, 'emphasis').value).toBe(false);
      expect(reduceIntents(baseline, ops).intents).toHaveLength(3);
    }
    const late = intent('late', { attribute: 'emphasis', value: true });
    expect(field([on(), other, resolve, late], 'emphasis').candidates).toHaveLength(2);
  });
  it('equal values do not erase independent operation identities', () => {
    const second = intent('second', { attribute: 'body', value: 'edited' });
    expect(field([body(), second], 'body').candidates).toHaveLength(2);
  });
  it('R2-08: duplicate payloads deduplicate; opId collisions preserve both and block dependents', () => {
    expect(reduceIntents(baseline, [on(), on()])).toEqual(reduceIntents(baseline, [on()]));
    const collision = { ...on(), writes: [{ attribute: 'emphasis', value: false }] } as Intent;
    const result = reduceIntents(baseline, [on(), collision, off()]);
    expect(result).toEqual(reduceIntents(baseline, [off(), collision, on()]));
    expect(result.intents).toHaveLength(3);
    expect(result.results.find(r => r.opId === 'on')?.status).toBe('rejected');
    expect(result.results.find(r => r.opId === 'off')?.status).toBe('dependency-pending');
  });
  it('R2-06: retired generation, foreign account, wrong baseline, wrong attribute references reject', () => {
    const variants: Intent[] = [
      { ...on(), generation: 'retired' }, { ...on(), scope: { ...scope, uid: 'other' } },
      { ...on(), observed: [{ ...observation('emphasis'), baselineSeal: 'wrong' }] },
      { ...off(), observed: [observation('emphasis', ['body'])] },
    ];
    for (const bad of variants) expect(reduceIntents(baseline, [body(), bad]).results.find(r => r.opId === bad.opId)?.status).toBe('rejected');
  });
  it('completion status and timestamp are validated as one atomic value', () => {
    const bad = intent('bad', { attribute: 'completion', value: { status: 'active', completedAt: '2026-11-08T01:00:00.000Z' } } as unknown as Write);
    expect(reduceIntents(baseline, [bad]).results[0].status).toBe('rejected');
    expect(field([bad], 'completion').value).toEqual({ status: 'active', completedAt: null });
  });
  it('causal cycles stay preserved and never apply', () => {
    const a = intent('a', { attribute: 'body', value: 'a' }, ['b']);
    const b = intent('b', { attribute: 'body', value: 'b' }, ['a']);
    const r = reduceIntents(baseline, [a, b]);
    expect(r.intents).toHaveLength(2);
    expect(r.results.every(x => x.status !== 'applied')).toBe(true);
  });
  it('readSet noncommutativity blocks both commands, regardless of arrival order', () => {
    const dependent = intent('dependent', { attribute: 'title', value: 'computed' }, [], { readSet: [observation('body')] });
    for (const ops of permutations([dependent, body()])) {
      const r = reduceIntents(baseline, ops);
      expect(r.results.every(x => x.status === 'conflict')).toBe(true);
      expect(r.fields.find(f => f.attribute === 'title')?.value).toBeUndefined();
    }
  });
  it('multi-attribute commands are held together on conflict', () => {
    const atomic = intent('atomic', { attribute: 'title', value: 'new title' }, [], {
      intentKind: 'atomic-edit', writes: [{ attribute: 'title', value: 'new title' }, { attribute: 'body', value: 'atomic body' }],
      observed: [observation('title'), observation('body')],
    });
    const r = reduceIntents(baseline, [atomic, body()]);
    expect(r.fields.find(f => f.attribute === 'title')?.value).toBeUndefined();
    expect(r.intents).toHaveLength(2);
  });
  it('readSet dependency that was already stale cannot silently apply', () => {
    const bad = intent('dependent', { attribute: 'title', value: 'computed' }, [], { readSet: [observation('body')], dependencies: ['body'] });
    expect(reduceIntents(baseline, [body(), bad]).results.find(x => x.opId === 'dependent')?.status).toBe('conflict');
  });
  it('R1-02/03 pure subset: typed pinnedNote/features use the same candidate contract', () => {
    const pinned = { type: 'pinnedNote' as const, id: 'main' };
    const features = { type: 'features' as const, id: 'main' };
    const b: Baseline = { ...baseline, resources: [
      { resource: pinned, fields: [{ attribute: 'body', value: 'cloud' }] },
      { resource: features, fields: [{ attribute: 'ideasEnabled', value: false }] },
    ] };
    const p = (id: string, value: string) => intent(id, { attribute: 'body', value }, [], {
      resource: pinned, observed: [{ ...observation('body'), resource: pinned }],
    });
    const feature = intent('feature', { attribute: 'ideasEnabled', value: true }, [], {
      resource: features, observed: [{ ...observation('ideasEnabled'), resource: features }],
    });
    const r = reduceIntents(b, [p('phone', ''), p('pc', 'dirty'), feature]);
    expect(r.fields.find(f => f.resource.type === 'pinnedNote')?.candidates.map(x => x.value)).toEqual(['dirty', '']);
    expect(r.fields.find(f => f.resource.type === 'features')?.value).toBe(true);
  });
  it('all permutations, duplicate deliveries and JSON restart converge without modifying inputs', () => {
    const ops = [on(), off(), complete(), body()];
    const original = JSON.stringify({ baseline, ops });
    const expected = reduceIntents(baseline, ops);
    for (const order of permutations(ops)) {
      expect(reduceIntents(baseline, [...order, order[0]])).toEqual(expected);
      expect(reduceIntents(JSON.parse(JSON.stringify(baseline)), JSON.parse(JSON.stringify(order)))).toEqual(expected);
    }
    expect(JSON.stringify({ baseline, ops })).toBe(original);
  });
  it('a small actor sequence is not a delivery watermark that can drop valid offline work', () => {
    const high = intent('high', { attribute: 'body', value: 'high sequence' }, [], { actorId: 'device', localSeq: 100 });
    const low = intent('low', { attribute: 'emphasis', value: true }, [], { actorId: 'device', localSeq: 1 });
    expect(reduceIntents(baseline, [high, low])).toEqual(reduceIntents(baseline, [low, high]));
    expect(field([high, low], 'emphasis').value).toBe(true);
  });
  it('an omitted emphasis value is not an explicit OFF operation', () => {
    const missing = { ...off(), writes: [{ attribute: 'emphasis' }] } as unknown as Intent;
    expect(reduceIntents(baseline, [on(), missing]).results.find(r => r.opId === 'off')?.status).toBe('rejected');
    expect(field([on(), missing], 'emphasis').value).toBe(true);
  });
  it('a causal dependent reading the updated attribute is safe; stale write observations are held', () => {
    const causal = intent('causal', { attribute: 'title', value: 'computed' }, [], { readSet: [observation('body', ['body'])] });
    expect(reduceIntents(baseline, [causal, body()]).results.every(r => r.status === 'applied')).toBe(true);
    const stale = intent('stale', { attribute: 'emphasis', value: false }, [], { dependencies: ['on'] });
    expect(reduceIntents(baseline, [on(), stale]).results.find(r => r.opId === 'stale')?.status).toBe('conflict');
  });
  it('cannot manufacture a frontier containing both an ancestor and its descendant', () => {
    const bad = intent('bad', { attribute: 'emphasis', value: true }, ['on', 'off']);
    expect(reduceIntents(baseline, [on(), off(), bad]).results.find(r => r.opId === 'bad')?.status).toBe('rejected');
  });
  it('an unresolved atomic command cannot leak a successful partial descendant', () => {
    const atomic = intent('atomic', { attribute: 'title', value: 'new' }, [], {
      intentKind: 'atomic-edit', writes: [{ attribute: 'title', value: 'new' }, { attribute: 'body', value: 'atomic' }],
      observed: [observation('title'), observation('body')],
    });
    const child = intent('child', { attribute: 'title', value: 'descendant' }, ['atomic']);
    for (const ops of permutations([atomic, body(), child])) {
      const state = reduceIntents(baseline, ops);
      expect(state.fields.find(f => f.attribute === 'title')?.value).toBeUndefined();
      expect(state.results.find(r => r.opId === 'child')?.status).toBe('conflict');
    }
  });
  it('actor sequence collisions and unsupported split commands preserve evidence, not partial writes', () => {
    for (const extra of [{ commandId: 'same' }, { actorId: 'same-device' }]) {
      const a = intent('a', { attribute: 'body', value: 'a' }, [], extra);
      const b = intent('b', { attribute: 'title', value: 'b' }, [], extra);
      const state = reduceIntents(baseline, [a, b]);
      expect(state.intents).toHaveLength(2);
      expect(state.results.every(r => r.status === 'rejected')).toBe(true);
    }
  });
  it('120 delivery permutations keep the same full evidence, candidates and results', () => {
    const competing = intent('competing', { attribute: 'emphasis', value: true });
    const ops = [on(), off(), complete(), body(), competing];
    const expected = reduceIntents(baseline, ops);
    for (const order of permutations(ops)) expect(reduceIntents(baseline, order)).toEqual(expected);
  });
});

describe('receipt acceptance is separate from application (pure decisions only)', () => {
  it('R2-08: accepted receipt alone cannot mark intent applied or remove its evidence', () => {
    const decision = evaluateAcceptance(baseline, [], on());
    expect(decision.kind).toBe('accepted');
    if (decision.kind !== 'accepted') throw Error('expected accepted');
    const ledger = recordAccepted({ outbox: [on()], awaiting: [] }, decision.receipt);
    expect(ledger.outbox).toHaveLength(0);
    expect(ledger.awaiting).toEqual([on()]);
    expect(decision.receipt).not.toHaveProperty('applied');
  });
  it('duplicate receipt is idempotent and collision/foreign receipts cannot retire outbox', () => {
    const accepted = evaluateAcceptance(baseline, [], on());
    if (accepted.kind !== 'accepted') throw Error('expected accepted');
    expect(evaluateAcceptance(baseline, [accepted.receipt], on()).kind).toBe('duplicate');
    expect(evaluateAcceptance(baseline, [accepted.receipt], { ...on(), createdAt: '2026-01-01T00:00:00.000Z' }).kind).toBe('rejected');
    const ledger = { outbox: [on()], awaiting: [] };
    expect(recordAccepted(ledger, { ...accepted.receipt, generation: 'old' })).toEqual(ledger);
    expect(recordAccepted(recordAccepted(ledger, accepted.receipt), accepted.receipt)).toEqual(recordAccepted(ledger, accepted.receipt));
  });
});
