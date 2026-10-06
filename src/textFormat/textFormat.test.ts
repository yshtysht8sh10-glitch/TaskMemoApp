import { describe, expect, it } from 'vitest';
import fixture from '../../docs/fixtures/text-format-production.json';
import { generateNKeysBetween } from 'fractional-indexing';
import { nodeToV2Value } from '../sync/nodeV2Codec';
import type { Node } from '../models/node';
import type { VersionedNode } from '../sync/types';
import { resolveDeadline } from './deadlines';
import { parseText } from './parser';
import { createTextSession, serializeText } from './session';
import { planTextEdit } from './planner';
import { validateText } from './validator';
import { canonical, RELATIVE_DUE_VALUES } from './syntax';

const now = '2026-10-02T03:00:00.000Z';
const context = { now, timeZone: 'Asia/Tokyo' };
const category: Node = { id: 'cat', type: 'category', title: '仕事', parentId: null, sortKey: 'a0', createdAt: new Date(now), updatedAt: new Date(now), deletedAt: null };
const memo: Node = { ...category, id: 'memo', type: 'memo', parentId: 'cat', title: '同名', body: 'body', dueAt: new Date('2026-09-30T08:12:34.567Z'), duePreset: 'today', status: 'active', completedAt: null, deadlineSortKey: 'a0', routineHistory: { '2026-09-30': now, '2026-09-29': null }, routineDueOverrides: { '2026-09-30': now }, repeatRule: null };
export const records = (nodes: Node[]): VersionedNode[] => nodes.map(node => ({ value: nodeToV2Value(node), revision: 7, lastOpId: 'remote:7', lastDeviceId: 'remote', lastLocalSeq: 7, operationType: 'update' }));
const seed = () => records([category, memo, { ...memo, id: 'memo2', sortKey: 'a1', deadlineSortKey: 'a1' }]);
const sessionFor = (source = seed(), view: 'tree' | 'list' = 'tree') => createTextSession(source, { id: 'test-session', scope: 'test-account', view, ...context });

describe('Text Format parser / validator', () => {
  it('[TW-FMT-001] parses the Issue pipe example and hierarchy', () => {
    const doc = parseText('@n1 | Category | 仕事\n  @n2 | Category | 開発\n    @n3 | Task | #59を実装 | 今日 | 未完了\n    Idea | AI連携', 'tree');
    expect(doc.errors).toEqual([]); expect(doc.rows[2].parentRow).toBe(1); expect(doc.rows[3].ref).toBeNull();
    expect(validateText(doc, context).errors).toEqual([]);
  });
  it('[TW-ERR-001] exposes source cells for live errors / highlights', () => {
    const doc = parseText('@n1 | Task | A | 不正な期限 | 未完了', 'tree');
    expect(doc.rows[0].cells[3].start).toBeGreaterThan(1);
    expect(validateText(doc, context).errors).toMatchObject([{ code: 'due', line: 1, cell: 4 }]);
  });
  it('[TW-FMT-002] supports JSON strings and explicit escaped separators', () => {
    const doc = parseText('Task | " A | B " | 期限なし | 未完了 | "one\n\ntwo"'.replace('one\n\ntwo', 'one\\n\\ntwo'), 'tree');
    expect(doc.errors).toEqual([]); expect(doc.rows[0].title).toBe(' A | B '); expect(doc.rows[0].body).toBe('one\n\ntwo');
    expect(parseText('Task | A\\|B | 期限なし | 未完了 | a\\\\b', 'tree').rows[0].title).toBe('A|B');
  });
  it.each(['Task', 'Task | "open', 'Task | A\\q', 'Task | A\\', '@id | Task | A', 'Task | A | x | y | z | w | extra', '\tTask | A'])('[TW-FMT-003] rejects invalid syntax: %s', text => expect(parseText(text, 'tree').errors.length).toBeGreaterThan(0));
  it('[TW-VAL-001] classifies an empty title as semantic validation, not a missing delimiter', () => expect(validateText(parseText('Task |', 'tree'), context).errors).toMatchObject([{ code: 'title' }]));
  it.each(['今日くらい', '来週くらい', '月末あたり', 'なるべく早く', '2026/2/30', '2/29', '4/25 25:00', '2026-02-30T12:00:00Z'])('[TW-DUE-001] rejects invalid dates: %s', value => expect(resolveDeadline(value, context)).toBeNull());
  it.each(RELATIVE_DUE_VALUES)('[TW-DUE-002] resolves only declared relative deadline %s', value => expect(resolveDeadline(value, context)).not.toBeNull());
  it('[TW-DUE-003] uses the frozen session timezone/year and calendar boundaries', () => {
    expect(resolveDeadline('今日', context)).toEqual({ dueAt: '2026-10-02T14:59:00.000Z', duePreset: 'today' });
    expect(resolveDeadline('4/25 17:00', context)?.dueAt).toBe('2026-04-25T08:00:00.000Z');
    expect(resolveDeadline('来月', context)?.dueAt).toBe('2026-11-30T14:59:00.000Z');
  });
  it('[TW-DUE-004] rejects DST gaps/ambiguity and accepts an explicit offset', () => {
    const tz = { now, timeZone: 'America/New_York' };
    expect(resolveDeadline('2026/3/8 02:30', tz)).toBeNull();
    expect(resolveDeadline('2026/11/1 01:30', tz)).toBeNull();
    expect(resolveDeadline('2026-11-01T01:30:00-04:00', tz)?.dueAt).toBe('2026-11-01T05:30:00.000Z');
  });
  it('ignores list indentation but rejects a Memo tree parent', () => {
    const text = '@n1 | Task | A\n  @n2 | Task | B';
    expect(parseText(text, 'tree').errors).toMatchObject([{ code: 'hierarchy' }]);
    expect(parseText(text, 'list').rows.map(r => r.parentRow)).toEqual([null, null]);
  });
  it('rejects semantic completion / routine / category attributes', () => {
    expect(validateText(parseText('Task | A | 今日 | yes | | day interval=0 startsOn=2026-01-01', 'tree'), context).errors.map(e => e.code)).toEqual(['completion', 'routine']);
    expect(validateText(parseText('Category | A | 今日', 'tree'), context).errors).toMatchObject([{ code: 'protected' }]);
  });
});

describe('Text sessions / planner', () => {
  it.each(['tree', 'list'] as const)('[TW-SER-001] no-edit %s round-trip is exactly zero, including old preset and metadata', view => {
    const current = seed(), session = sessionFor(current, view), text = serializeText(session);
    expect(text).not.toContain('remote:7'); expect(text).not.toContain('memo2');
    const plan = planTextEdit(session, text, current);
    expect(plan.errors).toEqual([]); expect(plan.changes).toEqual([]);
    expect(planTextEdit(session, text, JSON.parse(JSON.stringify(current))).changes).toEqual([]);
  });
  it('[TW-TREE-001] preserves explicit entrance tree ordering including unassigned root Memos', () => {
    const current = records([category, memo, { ...memo, id: 'unassigned', parentId: null, sortKey: 'a1' }]);
    const session = createTextSession(current, { id: 'entrance', scope: 'account', view: 'tree', ...context, orderedIds: ['unassigned', 'cat', 'memo'] });
    expect(serializeText(session).split('\n')[0]).toContain('@n1 | Task');
    expect(planTextEdit(session, serializeText(session), current)).toMatchObject({ errors: [], changes: [] });
    expect(() => createTextSession(current, { id: 'bad', scope: 'account', view: 'tree', ...context, orderedIds: ['memo', 'cat', 'unassigned'] })).toThrow('階層');
  });
  it('[TW-SER-002] preserves exact strings including pipe, CRLF, trailing newline, leading whitespace', () => {
    const current = records([category, { ...memo, title: ' A | B ', body: ' a\r\nb\n' }]);
    const session = sessionFor(current);
    expect(planTextEdit(session, serializeText(session), current)).toMatchObject({ errors: [], changes: [] });
  });
  it('[TW-ID-001] patches one same-name Node by ref without touching sibling metadata', () => {
    const current = seed(); current[1].value.futureMetadata = { nested: [1, null, 'keep'] };
    const session = sessionFor(current), text = serializeText(session).replace('@n2 | Task | 同名', '@n2 | Task | 改名');
    const plan = planTextEdit(session, text, current);
    expect(plan.errors).toEqual([]); expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0].id).toBe('memo');
    expect(plan.changes[0].after).toMatchObject({ deadlineSortKey: 'a0', routineHistory: memo.routineHistory, routineDueOverrides: memo.routineDueOverrides, futureMetadata: { nested: [1, null, 'keep'] }, createdAt: now, sortKey: 'a0' });
    expect(plan.changes[0].fields.sort()).toEqual(['title', 'updatedAt']);
  });
  it('[TW-ID-002] adds a new Node with deterministic fresh identity', () => {
    const current = seed(), session = sessionFor(current);
    const text = serializeText(session) + '\n  Task | 新規 | 明日 | 完了';
    const plan = planTextEdit(session, text, current);
    expect(plan.errors).toEqual([]); expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({ type: 'create', before: null, after: { parentId: 'cat', status: 'completed' } });
    expect(planTextEdit(session, text, current).fingerprint).toBe(plan.fingerprint);
  });
  it('[TW-TREE-002] moves an existing Memo to root without replacing its ID', () => {
    const current = seed(), session = sessionFor(current);
    const lines = serializeText(session).split('\n');
    const text = [lines[0], lines[2], lines[1].trimStart()].join('\n');
    const plan = planTextEdit(session, text, current);
    expect(plan.errors).toEqual([]); expect(plan.changes.find(c => c.id === 'memo')?.after.parentId).toBeNull();
  });
  it('[TW-TREE-003] reorders tree siblings, preserving deadline order', () => {
    const current = seed(), session = sessionFor(current), lines = serializeText(session).split('\n');
    const plan = planTextEdit(session, [lines[0], lines[2], lines[1]].join('\n'), current);
    expect(plan.errors).toEqual([]); expect(plan.changes.length).toBeGreaterThan(0);
    for (const c of plan.changes) expect(c.after.deadlineSortKey).toBe(c.before?.deadlineSortKey);
  });
  it('[TW-LIST-001] list reorder affects deadline ranks, not tree parents or ranks', () => {
    const current = seed(), session = sessionFor(current, 'list'), lines = serializeText(session).split('\n');
    const plan = planTextEdit(session, '        ' + [lines[1], lines[0]].join('\n'), current);
    expect(plan.errors).toEqual([]); expect(plan.changes.length).toBeGreaterThan(0);
    for (const c of plan.changes) { expect(c.after.parentId).toBe(c.before?.parentId); expect(c.after.sortKey).toBe(c.before?.sortKey); }
  });
  it('[TW-DEL-001] partial list deletion never touches unlisted Nodes or Categories', () => {
    const current = seed();
    const session = createTextSession(current, { id: 'partial', scope: 'account', view: 'list', ...context, orderedIds: ['memo'] });
    const plan = planTextEdit(session, '', current);
    expect(plan.errors).toEqual([]); expect(plan.changes.map(c => c.id)).toEqual(['memo']);
  });
  it('[TW-LIST-002] projection group positions never become parents, and different groups do not reorder each other', () => {
    const current = seed();
    const session = createTextSession(current, { id: 'groups', scope: 'account', view: 'list', ...context, orderedIds: ['memo', 'memo2'], listGroups: { memo: 'today', memo2: 'month' } });
    const lines = serializeText(session).split('\n');
    expect(planTextEdit(session, [lines[1], '      ' + lines[0]].join('\n'), current)).toMatchObject({ errors: [], changes: [] });
  });
  it('[TW-LIST-003] list creation uses explicit newParentId independently of indentation', () => {
    const current = seed(); const session = createTextSession(current, { id: 'list-new', scope: 'account', view: 'list', ...context, newParentId: 'cat' });
    const plan = planTextEdit(session, serializeText(session) + '\n      Task | 新規', current);
    expect(plan.errors).toEqual([]); expect(plan.changes[0].after.parentId).toBe('cat');
  });
  it('[TW-LIST-004] list newParentId never reparents an existing root Memo during no-edit save', () => {
    const current = records([category, { ...memo, parentId: null }]);
    const session = createTextSession(current, { id: 'list-root', scope: 'account', view: 'list', ...context, newParentId: 'cat' });
    expect(planTextEdit(session, serializeText(session), current)).toMatchObject({ errors: [], changes: [] });
  });
  it('[TW-DEL-002] soft deletes only missing visible refs, protecting hidden tombstones', () => {
    const current = [...seed(), ...records([{ ...memo, id: 'deleted', deletedAt: new Date(now) }, { ...memo, id: 'purged', deletedAt: new Date(now), purgedAt: new Date(now) }])];
    const session = sessionFor(current);
    const text = serializeText(session).split('\n').filter(line => !line.includes('@n2 ')).join('\n');
    const plan = planTextEdit(session, text, current);
    expect(plan.errors).toEqual([]); expect(plan.deletedIds).toEqual(['memo']);
    expect(plan.changes).toHaveLength(1); expect(plan.changes[0]).toMatchObject({ type: 'softDelete', after: { deletedAt: now } });
  });
  it('[TW-TREE-004] rejects deletion of a parent while retaining its children', () => {
    const current = seed(), session = sessionFor(current);
    expect(planTextEdit(session, serializeText(session).split('\n').slice(1).join('\n'), current).errors.length).toBeGreaterThan(0);
  });
  it('[TW-DEL-003] groups category subtree deletions but not independent Memo deletions for trash restore', () => {
    const current = seed(), session = sessionFor(current);
    const subtree = planTextEdit(session, '', current);
    expect(subtree.errors).toEqual([]);
    expect(new Set(subtree.changes.map(c => c.after.deletionBatchId)).size).toBe(1);
    const leaves = planTextEdit(session, serializeText(session).split('\n')[0], current);
    expect(leaves.errors).toEqual([]); expect(leaves.changes.map(c => c.after.deletionBatchId)).toEqual([null, null]);
  });
  it.each(['duplicate', 'unknown', 'lost'] as const)('[TW-REF-001] rejects %s refs without partial changes', kind => {
    const current = seed(), session = sessionFor(current);
    const text = serializeText(session).replace('@n2', kind === 'duplicate' ? '@n3' : kind === 'unknown' ? '@n99' : '');
    const plan = planTextEdit(session, text, current);
    expect(plan.errors.length).toBeGreaterThan(0); expect(plan.changes).toEqual([]);
  });
  it('[TW-CON-001] stops on any remote value / revision / new Node change', () => {
    const current = seed(), session = sessionFor(current);
    current[0].revision++; expect(planTextEdit(session, serializeText(session), current).errors).toMatchObject([{ code: 'conflict' }]);
  });
  it('[TW-VAL-002] requires all semantic errors to be fixed, never emits partial patches', () => {
    const current = seed(), session = sessionFor(current);
    const text = serializeText(session).replace('同名', '改名').replace('2026/9/30 17:12:34.567', '来週くらい');
    const plan = planTextEdit(session, text, current); expect(plan.errors.length).toBeGreaterThan(0); expect(plan.changes).toEqual([]);
  });
  it('[TW-RTN-001] supports frozen-day Routine completion and preserves overrides / status', () => {
    const current = records([{ ...category, categoryKind: 'routineRoot' }, { ...memo, dueAt: null, duePreset: 'none', repeatRule: { frequency: 'day', interval: 1, startsOn: '2026-09-17' } }]);
    const session = sessionFor(current);
    const plan = planTextEdit(session, serializeText(session).replace('未完了', '完了'), current);
    expect(plan.errors).toEqual([]); expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0].after.routineHistory).toEqual({ ...memo.routineHistory, '2026-10-02': now });
    expect(plan.changes[0].after.status).toBe('active'); expect(plan.changes[0].after.routineDueOverrides).toEqual(memo.routineDueOverrides);
  });
  it('[TW-RTN-002] cancels Routine occurrence with null and retains unrelated history', () => {
    const current = records([{ ...category, categoryKind: 'routineRoot' }, { ...memo, routineHistory: { ...memo.routineHistory, '2026-10-02': now } }]);
    const session = sessionFor(current), plan = planTextEdit(session, serializeText(session).replace('完了', '未完了'), current);
    expect(plan.errors).toEqual([]); expect(plan.changes[0].after.routineHistory).toEqual({ ...memo.routineHistory, '2026-10-02': null });
  });
  it('[TW-RTN-003] does not confuse Routine occurrence completion with status during a move', () => {
    const current = records([{ ...category, categoryKind: 'routineRoot' }, memo]);
    const session = sessionFor(current);
    expect(planTextEdit(session, serializeText(session).replace('  @n2', '@n2'), current).errors).toMatchObject([{ code: 'protected', cell: 5 }]);
    const text = serializeText(session).replace('  @n2', '@n2').replace('| 未完了 |', '| |');
    const plan = planTextEdit(session, text, current);
    expect(plan.errors).toEqual([]); expect(plan.changes.map(c => c.id)).toEqual(['memo']);
    expect(plan.changes[0].after.routineHistory).toEqual(memo.routineHistory);
  });
  it('[TW-RTN-004] retains expanded repeatRule selectors on unrelated edits and rejects rule replacement', () => {
    const current = records([{ ...category, categoryKind: 'routineRoot' }, { ...memo, repeatRule: { frequency: 'week', interval: 1, startsOn: '2026-09-17', weekdays: [1, 3] } }]);
    const session = sessionFor(current), text = serializeText(session);
    expect(planTextEdit(session, text, current).changes).toEqual([]);
    expect(planTextEdit(session, text.replace('同名', '改名'), current).changes[0].after.repeatRule).toEqual(current[1].value.repeatRule);
    expect(planTextEdit(session, text.replace('interval=1', 'interval=2'), current).errors).toMatchObject([{ code: 'protected' }]);
  });
  it('[TW-TYPE-001] allows non-destructive Task/Idea conversion while retaining deadlineSortKey', () => {
    const current = records([category, { ...memo, dueAt: null, duePreset: 'none', routineHistory: {}, routineDueOverrides: {} }]);
    const session = sessionFor(current), plan = planTextEdit(session, serializeText(session).replace('| Task |', '| Idea |'), current);
    expect(plan.errors).toEqual([]); expect(plan.changes[0].after).toMatchObject({ memoType: 'idea', deadlineSortKey: 'a0', id: 'memo' });
  });
  it('[TW-TYPE-002] rejects destructive type conversions and system root deletion', () => {
    const current = seed(), session = sessionFor(current);
    expect(planTextEdit(session, serializeText(session).replace('@n2 | Task', '@n2 | Idea'), current).errors.length).toBeGreaterThan(0);
    const root = records([{ ...category, categoryKind: 'routineRoot' }]), rootSession = sessionFor(root);
    expect(planTextEdit(rootSession, '', root).errors).toMatchObject([{ code: 'protected' }]);
  });
  it('[TW-FMT-004] keeps metadata/absence even when optional cells are omitted', () => {
    const current = seed(), session = sessionFor(current);
    expect(planTextEdit(session, '@n1 | Category | 仕事\n  @n2 | Task | 同名\n  @n3 | Task | 同名', current)).toMatchObject({ errors: [], changes: [] });
  });
  it('[TW-ID-003] rejects fresh ID collisions with deleted/purged Nodes', () => {
    const current = seed(); current.push({ ...current[1], value: { ...current[1].value, id: 'text-test-session-4', purgedAt: now, deletedAt: now } });
    const session = sessionFor(current);
    expect(planTextEdit(session, serializeText(session) + '\nTask | 新規', current).errors).toMatchObject([{ code: 'ref' }]);
  });
  it('[TW-RANK-001] does not normalize an unchanged legacy invalid sortKey', () => {
    const current = seed(); current[1].value.sortKey = 'zzzz'; const session = sessionFor(current);
    expect(planTextEdit(session, serializeText(session), current).changes).toEqual([]);
    const plan = planTextEdit(session, serializeText(session) + '\n  Task | 新規', current);
    expect(plan.errors).toMatchObject([{ code: 'protected' }]); expect(plan.changes).toEqual([]);
  });
  it('[TW-GUARD-001] handles large deletion with a complete explicit plan', () => {
    const keys = generateNKeysBetween(null, null, 60);
    const current = records(keys.map((sortKey, i) => ({ ...category, id: `c${i}`, sortKey })));
    const session = sessionFor(current), plan = planTextEdit(session, '', current);
    expect(plan.errors).toEqual([]); expect(plan.deletedIds).toHaveLength(60); expect(plan.requiresConfirmation).toBe(true);
  });
  it.each(['tree', 'list'] as const)('[TW-FIX-001] production-derived fixture %s round-trip is completely zero', view => {
    const current = fixture.records as VersionedNode[];
    const session = sessionFor(current, view);
    const before = canonical(current), plan = planTextEdit(session, serializeText(session), current);
    expect(plan.errors).toEqual([]); expect(plan.changes).toEqual([]); expect(canonical(current)).toBe(before);
    expect(current.length).toBeGreaterThan(100);
  });
});
