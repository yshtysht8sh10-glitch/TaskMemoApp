import { describe, expect, it } from 'vitest';
import { decide, GATE, validateRequest } from './decision.js';
const input = { uid: 'new', projectId: 'taskmemoapp-dev', authCreatedAt: 1000, provider: 'password',
  policy: { schemaVersion: 1, enabled: true, protocol: 2, policyVersion: 'v1', eligibleCreatedAfter: 900, writerFenceVersion: 1 },
  global: { schemaVersion: 1, writesEnabled: true }, gate: null, receipt: null, nonempty: false, lifecycle: null };
describe('new Account provisioning trust boundary', () => {
  it('creates only a verified fresh empty Account', () => expect(decide(input)).toBe('create'));
  it('rejects client identity and old protocol requests', () => {
    expect(() => validateRequest({ schemaVersion: 1, protocol: 1 })).toThrow();
    expect(() => validateRequest({ schemaVersion: 1, protocol: 2, uid: 'other' })).toThrow();
  });
  it.each([{ nonempty: true }, { authCreatedAt: 800 }, { provider: 'anonymous' }, { lifecycle: { state: 'migration' } },
    { policy: { ...input.policy, writerFenceVersion: 0 } }, { global: { schemaVersion: 1, writesEnabled: false } },
    { gate: { ...GATE, v1WritesAllowed: true } }, { receipt: { uid: 'new' } }])('fails closed on %j', patch => {
    expect(() => decide({ ...input, ...patch })).toThrow();
  });
  it('does not require a fresh empty baseline for existing valid gates', () => {
    expect(decide({ ...input, gate: GATE, nonempty: true, authCreatedAt: 800 })).toBe('existing');
  });
});
