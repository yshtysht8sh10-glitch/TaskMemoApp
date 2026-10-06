import { describe, expect, it } from 'vitest';
import { integrateOwnershipSortKeys } from './ownershipSortKeys';
import { planOwnershipReconcile } from './ownershipReconcile';
import type { SyncNodeValue, VersionedNode } from './types';
const node = (id: string, sortKey: string, parentId: string | null = null): SyncNodeValue => ({ id, sortKey, parentId, type: 'category', title: id, createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', deletedAt: null });
const record = (value: SyncNodeValue): VersionedNode => ({ value, revision: 4, lastOpId: 'remote:4', lastDeviceId: 'remote', lastLocalSeq: 4, operationType: 'update' });
const make = (local: SyncNodeValue[], account: SyncNodeValue[]) => planOwnershipReconcile({ scope: 'anonymous', nodes: Object.fromEntries(local.map(n => [n.id, n])), profile: { body: '', ideasEnabled: false } }, Object.fromEntries(account.map(n => [n.id, record(n)])), undefined, 'account');
const localChoices = (nodes: SyncNodeValue[]) => Object.fromEntries(nodes.map(n => [n.id, 'local' as const]));
describe('ownership independent order-space integration', () => {
  it('changes only colliding adopted keys, deterministically, bounded by the next local original', () => {
    const local = [node('L0', 'a0'), node('L1', 'a0G'), node('L2', 'a1'), node('L3', 'a2')];
    const account = [node('A0', 'a0'), node('A1', 'a1'), node('A3', 'a3')];
    const plan = make(local, account), original = JSON.stringify(plan);
    const result = integrateOwnershipSortKeys(plan, localChoices(local));
    expect(result.adjustments.map(a => a.id)).toEqual(['L0', 'L2']);
    expect(result.nodes.L0.sortKey! > 'a0' && result.nodes.L0.sortKey! < 'a0G').toBe(true);
    expect(result.nodes.L2.sortKey! > 'a1' && result.nodes.L2.sortKey! < 'a2').toBe(true);
    expect(result.nodes.L1).toEqual(local[1]); expect(result.nodes.L3).toEqual(local[3]);
    for (const n of account) expect(result.nodes[n.id]).toEqual(n);
    expect(JSON.stringify(plan)).toBe(original);
    expect(integrateOwnershipSortKeys(plan, localChoices(local))).toEqual(result);
    expect(integrateOwnershipSortKeys(make([...local].reverse(), [...account].reverse()), localChoices(local)).nodes).toEqual(result.nodes);
  });
  it('integrates Category children separately, with deleted/purged legacy ranks untouched', () => {
    const parent = node('parent', 'a0');
    const local = [parent, node('child-local', 'a0', 'parent'), { ...node('deleted', 'c', 'parent'), deletedAt: '2026-10-01T00:00:00Z' }, { ...node('purged', 'd'), purgedAt: '2026-10-01T00:00:00Z' }];
    const account = [parent, node('child-account', 'a0', 'parent'), node('root-account', 'a1')];
    const result = integrateOwnershipSortKeys(make(local, account), { 'child-local': 'local', deleted: 'local', purged: 'account' });
    expect(result.adjustments).toEqual([{ id: 'child-local', before: 'a0', after: 'a1' }]);
    expect(result.nodes.deleted).toEqual(local[2]); expect(result.nodes.purged).toBeUndefined();
    expect(result.nodes['root-account']).toEqual(account[2]);
  });
  it('supports selected existing-ID changes/moves, and makes no adjustment for account choices', () => {
    const local = [node('shared', 'a0'), node('new', 'a1')];
    const account = [node('shared', 'a2'), node('anchor', 'a0')];
    const plan = make(local, account);
    expect(integrateOwnershipSortKeys(plan, { shared: 'account', new: 'account' }).adjustments).toEqual([]);
    const result = integrateOwnershipSortKeys(plan, localChoices(local));
    expect(result.adjustments.map(a => a.id)).toEqual(['shared']);
    expect(result.nodes.shared.sortKey! > 'a0' && result.nodes.shared.sortKey! < 'a1').toBe(true);
  });
  it('fails closed for actual source/account internal duplicates, invalid ranks and invalid merged parents', () => {
    expect(() => integrateOwnershipSortKeys(make([node('a', 'a0'), node('b', 'a0')], []), { a: 'local', b: 'local' })).toThrow('重複');
    expect(() => integrateOwnershipSortKeys(make([], [node('a', 'a0'), node('b', 'a0')]), {})).toThrow('重複');
    expect(() => integrateOwnershipSortKeys(make([node('a', 'c')], []), { a: 'local' })).toThrow('検証');
    const plan = make([node('p', 'a0'), node('child', 'a0', 'p')], []);
    expect(() => integrateOwnershipSortKeys(plan, { p: 'account', child: 'local' })).toThrow('親構造');
  });
  it('rejects obsolete policy and purged resurrection without modifying input', () => {
    const plan = make([node('a', 'a0')], [{ ...node('a', 'a0'), purgedAt: '2026-10-01T00:00:00Z' }]);
    const before = JSON.stringify(plan);
    expect(() => integrateOwnershipSortKeys(plan, { a: 'local' })).toThrow('purged');
    expect(JSON.stringify(plan)).toBe(before);
    expect(() => integrateOwnershipSortKeys({ ...plan, orderPolicy: 'obsolete' as typeof plan.orderPolicy }, {})).toThrow('仕様');
  });
  it('preserves all non-sortKey fields including routine/deadline/unknown metadata', () => {
    const local = { ...node('routine-local', 'a0'), type: 'memo', body: 'content', status: 'active', memoType: 'task', duePreset: 'today', dueAt: '2026-10-02T01:00:00Z', repeatRule: { frequency: 'daily' }, routineHistory: { '2026-10-01': ['done'] }, routineDueOverrides: { '2026-10-02': null }, completionHistory: ['keep'], deadlineSortKey: 'z9', opaque: { nested: [1, null] } };
    const result = integrateOwnershipSortKeys(make([local], [node('account', 'a0')]), { [local.id]: 'local' });
    expect(result.nodes[local.id]).toEqual({ ...local, sortKey: 'a1' });
    const malformed = make([node('a', 'a0')], []);
    malformed.source.nodes = { wrong: node('a', 'a0') };
    expect(() => integrateOwnershipSortKeys(malformed, {})).toThrow('ID対応');
  });
});
