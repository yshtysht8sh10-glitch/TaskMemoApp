import { describe, expect, it } from 'vitest';
import fixture from '../../docs/fixtures/text-format-production.json';
import type { VersionedNode } from '../sync/types';
import { nodeFromV2Value } from '../sync/nodeV2Codec';
import { deadlineGroups, deadlineDisplayGroups } from '../domain/deadlineView';
import { completionHistoryGroups } from '../domain/completionHistory';
import { createTextSession, serializeText } from './session';
import { planTextEdit } from './planner';
import { parseText } from './parser';
import { closeTextChoices, listEditProjection, listTextSnapshot, renderTextView, textHighlights, textCellCandidates, treeTextSnapshot } from './presentation';
import { flattenVisibleNodes, UNASSIGNED_GROUP_ID } from '../domain/treeView';

const now = '2026-10-02T03:00:00.000Z';
const record = (id: string, parentId: string | null, category = false): VersionedNode => ({ value: { id, type: category ? 'category' : 'memo', title: id, parentId, sortKey: id === 'root' ? 'a2' : id === 'r' ? 'a1' : 'a0', createdAt: now, updatedAt: now, deletedAt: null,
  ...(category ? {} : { body: '', status: 'active', dueAt: '2026-10-01T14:59:00.000Z', duePreset: 'today', completedAt: null, repeatRule: null, routineHistory: { '2026-10-01': null }, routineDueOverrides: { '2026-10-01': now }, unknown: { keep: true } }) }, revision: 7, lastOpId: 'test7', lastDeviceId: 'test', lastLocalSeq: 7, operationType: 'update' });
const seed = () => {
  const root = record('root', null, true); root.value.categoryKind = 'routineRoot';
  const r = record('r', 'root'); r.value.repeatRule = { frequency: 'day', interval: 1, startsOn: '2026-09-30' };
  return [record('t', null), root, r];
};
const session = (source = seed()) => createTextSession(source, { id: 'ui', scope: 'test', view: 'tree', now, timeZone: 'Asia/Tokyo', systemRegions: true });

describe('system regions and Routine editing', () => {
  it('[TW-SYS-001] serializes reserved headers without root Node refs; no-edit is zero changes', () => {
    const source = seed(), s = session(source), text = serializeText(s);
    expect(text).toContain('@root\n  @n1 | Task'); expect(text).toContain('@routine\n  @n2 | Task');
    expect(Object.values(s.refs)).not.toContain('root');
    expect(planTextEdit(s, text, source)).toMatchObject({ changes: [], errors: [] });
    expect(parseText(text, 'tree').rows).toHaveLength(2);
  });
  it('[TW-RTN-005] moves Task into Routine only with explicit valid rule and keeps unknown/history/overrides', () => {
    const source = seed(), s = session(source);
    const plan = planTextEdit(s, '@root\n@routine\n  @n1 | Task | t | 今日 | 未完了 | | daily\n  @n2 | Task | r | 2026/10/1 | 未完了 | | day interval=1 startsOn=2026-09-30', source);
    expect(plan.errors).toEqual([]);
    const t = plan.changes.find(c => c.id === 't')!.after;
    expect(t.parentId).toBe('root'); expect(t.repeatRule).toEqual({ frequency: 'day', interval: 1, startsOn: '2026-10-02' });
    expect(t.routineHistory).toEqual(source[0].value.routineHistory); expect(t.routineDueOverrides).toEqual(source[0].value.routineDueOverrides); expect(t.unknown).toEqual({ keep: true });
  });
  it('[TW-RTN-006] rejects membership-only Routineization atomically', () => {
    const source = seed(), s = session(source);
    const plan = planTextEdit(s, serializeText(s).replace('@root\n', '@root\n@routine\n').replace('\n@routine\n', '\n'), source);
    // Explicit invalid move, independent of serializer whitespace.
    const invalid = planTextEdit(s, '@root\n@routine\n  @n1 | Task | t | 今日 | 未完了\n  @n2 | Task | r | | 未完了 | | daily', source);
    expect(invalid.errors).toContainEqual(expect.objectContaining({ code: 'routine', cell: 7 })); expect(invalid.changes).toEqual([]);
    expect(plan.changes).toEqual([]);
  });
  it('[TW-RTN-007] removes Routine only with both move out and omitted rule, preserving history/overrides', () => {
    const source = seed(), s = session(source);
    const plan = planTextEdit(s, '@root\n  @n1 | Task | t\n  @n2 | Task | r | | 未完了\n@routine', source);
    expect(plan.errors).toEqual([]);
    const r = plan.changes.find(c => c.id === 'r')!.after;
    expect(r.parentId).toBeNull(); expect(r.repeatRule).toBeNull(); expect(r.routineHistory).toEqual(source[2].value.routineHistory); expect(r.routineDueOverrides).toEqual(source[2].value.routineDueOverrides);
    const invalid = planTextEdit(s, '@root\n  @n1 | Task | t\n  @n2 | Task | r | | 未完了 | | daily\n@routine', source);
    expect(invalid.errors).toContainEqual(expect.objectContaining({ code: 'routine' })); expect(invalid.changes).toEqual([]);
  });
  it.each(['@routine\n  @n2 | Task | r', '@routine\n  @n2 | Task | r | | | | invalid', '@routine\n  Category | fake', '@root\n@root', '  @root'])('[TW-SYS-002] rejects ambiguous/system misuse: %s', text => {
    const source = seed(); expect(planTextEdit(session(source), text, source).errors.length).toBeGreaterThan(0);
  });
  it('[TW-LIST-005] rejects list region headers and preserves affiliation despite indentation', () => {
    const source = seed(); const s = createTextSession(source, { id: 'list', scope: 'test', view: 'list', now, timeZone: 'Asia/Tokyo', orderedIds: ['t'] });
    expect(planTextEdit(s, '        ' + serializeText(s), source)).toMatchObject({ errors: [], changes: [] });
    expect(planTextEdit(s, '@routine\n' + serializeText(s), source).errors.length).toBeGreaterThan(0);
    expect(planTextEdit(s, serializeText(s).replace('なし', 'daily'), source).errors.length).toBeGreaterThan(0);
  });
  it('[TW-SYS-003] supports empty Domain without creating reserved Nodes', () => {
    const s = session([]); expect(serializeText(s)).toBe('@root\n\n@routine'); expect(planTextEdit(s, serializeText(s), [])).toMatchObject({ errors: [], changes: [] });
  });
  it('[TW-SYS-004] keeps ordinary root Tasks in @root when the Domain has no Routine backing root', () => {
    const source = [record('t', null)], s = session(source);
    expect(serializeText(s)).toContain('@root\n  @n1 | Task');
    expect(planTextEdit(s, serializeText(s), source)).toMatchObject({ errors: [], changes: [] });
  });
  it.each(['constructor', 'toString', '__proto__'])('[TW-RTN-008] rejects inherited object names as Routine aliases: %s', value => {
    const source = seed(), s = session(source);
    const text = '@root\n  @n1 | Task | t\n@routine\n  @n2 | Task | r | | 未完了 | | ' + value;
    const plan = planTextEdit(s, text, source);
    expect(plan.errors).toContainEqual(expect.objectContaining({ code: 'routine', cell: 7 })); expect(plan.changes).toEqual([]);
  });
  it('[TW-FIX-002] production-derived reserved-region round-trip retains exact deadlines and every envelope', () => {
    const source = fixture.records as VersionedNode[], before = JSON.stringify(source), s = session(source);
    const plan = planTextEdit(s, serializeText(s), source);
    expect(plan.errors).toEqual([]); expect(plan.changes).toEqual([]); expect(JSON.stringify(source)).toBe(before);
  });
  it('[TW-RTN-009] a matching short Routine form retains the existing anchor exactly', () => {
    const source = seed(), s = session(source);
    expect(planTextEdit(s, serializeText(s).replace('day interval=1 startsOn=2026-09-30', 'daily'), source)).toMatchObject({ errors: [], changes: [] });
  });
  it('[TW-RANK-002] new root ranks do not collide with the hidden Routine backing node', () => {
    const source = seed(); source[1].value.sortKey = 'a1'; const s = session(source);
    const text = serializeText(s).replace('\n\n@routine', '\n  Task | 新規\n\n@routine');
    const plan = planTextEdit(s, text, source);
    expect(plan.errors).toEqual([]);
    expect(plan.changes.some(c => c.id === 'root')).toBe(false);
    expect((plan.changes.find(c => !c.before)!.after.sortKey as string) < 'a1').toBe(true);
  });
  it('[TW-FIX-003] production-derived current list projection is a zero-change plan including excluded Routine metadata', () => {
    const source = fixture.records as VersionedNode[], nodes = source.map(r => nodeFromV2Value(r.value)), date = new Date(now);
    const groups = deadlineDisplayGroups(deadlineGroups(nodes, date), date), projection = listEditProjection(nodes, groups);
    const s = createTextSession(source, { id: 'production-list', scope: 'test', view: 'list', now, timeZone: 'Asia/Tokyo', orderedIds: projection.orderedIds, listGroups: projection.listGroups });
    expect(planTextEdit(s, serializeText(s), source)).toMatchObject({ errors: [], changes: [], deletedIds: [] });
    expect(projection.excluded).toBeGreaterThan(0);
  });
});
describe('read-only projections and editor presentation', () => {
  it('[TW-OCC-001] excludes today source-ID Routine AND overdue virtual occurrences from list writes, keeps them in reading', () => {
    const nodes = seed().map(r => nodeFromV2Value(r.value)), date = new Date(now);
    const groups = deadlineDisplayGroups(deadlineGroups(nodes, date), date);
    const projection = listEditProjection(nodes, groups);
    expect(projection.orderedIds).toEqual(['t']); expect(projection.excluded).toBeGreaterThan(1);
    const snapshot = listTextSnapshot(nodes, groups, date), basic = renderTextView(snapshot, []);
    expect(basic).toContain('t'); expect(snapshot.rows.filter(r => r.title === 'r').length).toBeGreaterThan(1);
    expect(basic).not.toMatch(/@n|@root|@routine|routine-overdue|sortKey|revision/);
    const full = renderTextView(snapshot, ['due', 'body', 'type', 'completion', 'category', 'routine'], true);
    expect(full).toContain('- Task / Idea: Task'); expect(full).toContain('締め切り:'); expect(full).toContain('未完了分');
    expect(completionHistoryGroups(nodes, 'completedAt')).toEqual([]);
  });
  it('[TW-VIEW-001] uses current visible tree hierarchy/order with human-readable unassigned/Routine', () => {
    const nodes = seed().map(r => nodeFromV2Value(r.value));
    const rows = flattenVisibleNodes(nodes, new Set([UNASSIGNED_GROUP_ID, 'root']), true);
    const snapshot = treeTextSnapshot(nodes, rows, new Date(now));
    expect(renderTextView(snapshot, [])).toBe('無所属\n  t\nRoutine\n  r');
    expect(renderTextView(snapshot, ['type'])).toContain('  - Task');
  });
  it('[TW-HL-001] highlights changed cells over syntax; new/deleted have separate identities', () => {
    const s = session(); const baseline = textHighlights(s, serializeText(s));
    expect(baseline.rows.flatMap(r => r.changed).some(Boolean)).toBe(false);
    const h = textHighlights(s, '@root\n  @n1 | Task | renamed\n  Idea | new\n@routine');
    expect(h.rows[0].changed).toEqual([false, false, true]); expect(h.rows[1].isNew).toBe(true); expect(h.deleted).toEqual(['@n2']);
  });
  it('[TW-CLOSE-001] permits escape from invalid dirty edits; save is only a valid-edit choice', () => {
    expect(closeTextChoices(true, true)).toEqual(['continue', 'discard']); expect(closeTextChoices(true, false)).toEqual(['continue', 'save', 'discard']); expect(closeTextChoices(false, true)).toEqual(['close']);
    expect(textCellCandidates(3)).toContain('明後日'); expect(textCellCandidates(6)).toContain('daily'); expect(textCellCandidates(2)).toEqual([]);
  });
});
