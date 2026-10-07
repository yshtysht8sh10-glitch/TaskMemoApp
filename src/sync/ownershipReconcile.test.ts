import { describe, expect, it } from 'vitest';
import { pendingAnonymousChanges, planOwnershipReconcile, type AnonymousSnapshot, type OwnershipLedger } from './ownershipReconcile';
import type { VersionedNode } from './types';
const value = (id: string, title = id) => ({ id, type: 'category', title, parentId: null, sortKey: id === 'b' ? 'a1' : 'a0', createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', deletedAt: null });
const source: AnonymousSnapshot = { scope: 'anonymous', nodes: { a: value('a') }, profile: { body: '', ideasEnabled: false } };
const record = (id: string, title = id, revision = 20): VersionedNode => ({ value: value(id, title), revision, lastOpId: `remote:${revision}`, lastDeviceId: 'remote', lastLocalSeq: revision, operationType: 'update' });
const ledger: OwnershipLedger = { sourceScope: 'anonymous', targetScope: 'accountA', source, ancestors: { a: value('a') }, state: 'completed' };
describe('Phase C/D ownership reconcile, separate from normal sync', () => {
  it.each([undefined, { ...ledger, source: { ...source, nodes: {}, profile: { body: 'earlier', ideasEnabled: false } } }])('Issue 94 same profile is not reviewable with ledger %j', history => {
    const snapshot = { ...source, nodes: {}, profile: { body: 'same', ideasEnabled: true } };
    for (const revision of [1, 999]) {
      const profile = { pinnedNote: { value: { body: 'same' }, revision, lastOpId: 'p'+revision, lastDeviceId: 'd', lastLocalSeq: revision }, features: { value: { ideasEnabled: true }, revision, lastOpId: 'f'+revision, lastDeviceId: 'd', lastLocalSeq: revision } };
      const plan = planOwnershipReconcile(snapshot, {}, history, 'accountA', profile);
      expect(plan.items).toEqual([{ id: '$profile', local: null, account: null, kind: 'same' }]);
      expect(plan.needsReview).toBe(false);
    }
  });
  it('Issue 94 absent account profile means existing empty/disabled defaults; whitespace and boolean differences are not normalized', () => {
    const snapshot = { ...source, nodes: {}, profile: { body: '', ideasEnabled: false } };
    const history = { ...ledger, source: { ...snapshot, profile: { body: 'previous', ideasEnabled: true } } };
    const plan = planOwnershipReconcile(snapshot, {}, history, 'accountA');
    expect(plan.items[0].kind).toBe('same'); expect(plan.needsReview).toBe(false);
    expect(planOwnershipReconcile({ ...snapshot, profile: { body: ' ', ideasEnabled: false } }, {}, undefined, 'accountA').items[0].kind).toBe('conflict');
  });
  it.each([{ body: 'different', ideasEnabled: true }, { body: 'same', ideasEnabled: false }, { body: 'same ', ideasEnabled: true }])('Issue 94 real profile difference remains conflict: %j', content => {
    const snapshot = { ...source, nodes: {}, profile: { body: 'same', ideasEnabled: true } };
    const metadata = { revision: 7, lastOpId: 'op', lastDeviceId: 'd', lastLocalSeq: 7 };
    expect(planOwnershipReconcile(snapshot, {}, undefined, 'accountA', { pinnedNote: { ...metadata, value: { body: content.body } }, features: { ...metadata, value: { ideasEnabled: content.ideasEnabled } } }).items[0].kind).toBe('conflict');
  });
  it('unchanged anonymous produces no prompt despite cloud changes', () => {
    expect(pendingAnonymousChanges(source, ledger, 'accountA')).toEqual([]);
    const plan = planOwnershipReconcile(source, { a: record('a', 'another device') }, ledger, 'accountA');
    expect(plan.items).toEqual([]); expect(plan.needsReview).toBe(false);
  });
  it('only new anonymous edits are considered, and account B has its own checkpoint', () => {
    const changed = { ...source, nodes: { ...source.nodes, b: value('b') } };
    expect(pendingAnonymousChanges(changed, ledger, 'accountA')).toEqual(['b']);
    expect(pendingAnonymousChanges(changed, ledger, 'accountB')).toEqual(['a', 'b']);
    expect(planOwnershipReconcile(changed, { a: record('a', 'cloud ahead') }, ledger, 'accountA').items.map(i => i.id)).toEqual(['b']);
  });
  it('first same-ID difference is conflict, equal value is no operation', () => {
    expect(planOwnershipReconcile(source, { a: record('a', 'cloud') }, undefined, 'accountA').items[0].kind).toBe('conflict');
    expect(planOwnershipReconcile(source, { a: record('a') }, undefined, 'accountA').items[0].kind).toBe('same');
  });
  it('three-way safe change, both changed, purge, absence and cloud-only are distinct', () => {
    const edited = { ...source, nodes: { a: value('a', 'local') } };
    expect(planOwnershipReconcile(edited, { a: record('a'), b: record('b') }, ledger, 'accountA').items[0].kind).toBe('apply');
    expect(planOwnershipReconcile(edited, { a: record('a', 'cloud') }, ledger, 'accountA').items[0].kind).toBe('conflict');
    const purged = { ...record('a'), value: { ...value('a'), purgedAt: '2026-10-02T00:00:00.000Z' } };
    expect(planOwnershipReconcile(edited, { a: purged }, ledger, 'accountA').items[0].kind).toBe('purged');
    expect(planOwnershipReconcile(source, {}, undefined, 'accountA').items[0].kind).toBe('add');
  });
  it('skip checkpoint suppresses repeat prompt but later anonymous edits prompt', () => {
    const skipped: OwnershipLedger = { ...ledger, ancestors: {}, state: 'skipped' };
    expect(pendingAnonymousChanges(source, skipped, 'accountA')).toEqual([]);
    expect(pendingAnonymousChanges({ ...source, nodes: { a: value('a', 'edited again') } }, skipped, 'accountA')).toEqual(['a']);
  });
});
