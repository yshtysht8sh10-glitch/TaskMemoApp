import { expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { generateNKeysBetween } from 'fractional-indexing';
import { spec } from './specTestSupport';
import { parseText } from './parser';
import { validateText, parseRoutine } from './validator';
import { createTextSession, serializeText } from './session';
import { planTextEdit } from './planner';
import { resolveDeadline } from './deadlines';
import { closeTextChoices, listEditProjection, listTextSnapshot, renderTextView, textCellCandidates, textHighlights, TEXT_DETAIL_LABELS } from './presentation';
import { TEXT_TYPES, RELATIVE_DUE_VALUES, COMPLETION_VALUES, ROUTINE_ALIASES, canonical } from './syntax';
import { nodeFromV2Value } from '../sync/nodeV2Codec';
import { TaskMemoV2ApplicationStore } from '../sync/taskMemoApplicationStore';
import type { ApplicationJournalPersistence } from '../sync/applicationStore';
import type { VersionedNode } from '../sync/types';
import { createNode, updateNode, completeMemo, softDeleteNode, duplicateMemo, moveNode } from '../domain/nodeOperations';
import { deadlineGroups, deadlineDisplayGroups } from '../domain/deadlineView';
import { flattenVisibleNodes, UNASSIGNED_GROUP_ID } from '../domain/treeView';
import { initialRoutineFrequency, routineRuleForSave } from '../utils/routineEditor';
import { dueDateForPreset } from '../utils/dueDates';

const now = '2026-10-06T16:00:00.000Z'; // Tokyo next day: host date must not decide Routine completion.
const context = { now, timeZone: 'Asia/Tokyo' };
const record = (id: string, parentId: string | null, sortKey = 'a0', type = 'memo'): VersionedNode => ({
  value: { id, type, title: id, parentId, sortKey, createdAt: now, updatedAt: now, deletedAt: null,
    ...(type === 'memo' ? { memoType: 'task', body: 'body', dueAt: null, duePreset: 'none', status: 'active', completedAt: null, repeatRule: null,
      deadlineSortKey: sortKey, routineHistory: { '2026-10-05': now }, routineDueOverrides: { '2026-10-05': now }, future: { nested: ['keep'] } } : {}) },
  revision: 7, lastOpId: 'remote:7', lastDeviceId: 'remote', lastLocalSeq: 7, operationType: 'update',
});
const seed = () => {
  const root = record('routine-root', null, 'a1', 'category'); root.value.categoryKind = 'routineRoot';
  const routine = record('r', root.value.id); routine.value.repeatRule = routineRuleForSave('day', '1', '2026-10-05');
  return [record('cat', null, 'a0', 'category'), record('a', 'cat'), record('b', 'cat', 'a1'), root, routine];
};
const session = (current = seed(), view: 'tree' | 'list' = 'tree') => createTextSession(current, { id: 'spec', scope: 'local', view, ...context, systemRegions: view === 'tree', ...(view === 'list' ? { orderedIds: ['a', 'b'], listGroups: { a: 'none', b: 'none' } } : {}) });
const plan = (edit: (text: string) => string, current = seed(), view: 'tree' | 'list' = 'tree') => {
  const s = session(current, view); return planTextEdit(s, edit(serializeText(s)), current);
};
const renamed = () => plan(text => text.replace('| a |', '| renamed |')).changes.find(c => c.id === 'a')!;
const invalid = (text: string, code: string) => {
  const errors = validateText(parseText(text, 'tree'), context).errors;
  expect(errors).toContainEqual(expect.objectContaining({ code }));
};
spec('TW-FMT-005', () => {
  expect(parseText(String.raw`Task | A\|B | | | a\\b\n\r\t`, 'tree').rows[0]).toMatchObject({ title: 'A|B', body: 'a\\b\n\r\t' });
});
spec('TW-FMT-006', () => expect(parseText('\n\nTask | A\n\n', 'tree').rows).toHaveLength(1));
spec('TW-FMT-007', () => {
  const p = plan(text => text.replace('| a | 期限なし | 未完了 | body |', '| a | 期限なし | 未完了 | |'));
  expect(p.errors).toEqual([]); expect(p.changes.find(c => c.id === 'a')!.after.body).toBe('');
});
spec('TW-FMT-008', () => {
  const p = plan(text => text.replace('\n\n@routine', '\n  Task | fresh\n\n@routine'));
  expect(p.errors).toEqual([]); expect(p.changes.find(c => !c.before)!.after).toMatchObject({ dueAt: null, duePreset: 'none', body: '', status: 'active', repeatRule: null });
});
spec('TW-FMT-009', () => { for (const text of ['# 今日', '// comment', '- Task']) expect(parseText(text, 'tree').errors.length).toBeGreaterThan(0); });
spec('TW-VAL-003', () => invalid('Idea | A | 今日', 'protected'));
spec('TW-VAL-004', () => invalid('Task | A | | yes', 'completion'));
spec('TW-VAL-005', () => { for (const text of ['Category | A | 今日', 'Category | A | | 完了', 'Category | A | | | body', 'Category | A | | | | daily']) invalid(text, 'protected'); });
spec('TW-VAL-006', () => { for (const rule of ['day interval=0 startsOn=2026-10-07', 'day interval=9007199254740992 startsOn=2026-10-07', 'week interval=1 startsOn=2026-02-30']) invalid(`Task | A | | | | ${rule}`, 'routine'); });
spec('TW-REF-002', () => expect(plan(t => t.replace('@n3', '@n2')).errors).toContainEqual(expect.objectContaining({ code: 'ref' })));
spec('TW-REF-003', () => expect(plan(t => t.replace('@n2', '@n99')).errors).toContainEqual(expect.objectContaining({ code: 'ref' })));
spec('TW-REF-004', () => { const p = plan(t => t.replace('@n2 | ', '')); expect(p.errors).toContainEqual(expect.objectContaining({ code: 'identity' })); expect(p.changes).toEqual([]); });
spec('TW-TREE-005', () => expect(parseText('Task | A\n  Task | B', 'tree').errors).toContainEqual(expect.objectContaining({ code: 'hierarchy' })));
spec('TW-TREE-006', () => expect(parseText('Category | A\n    Task | B', 'tree').errors).toContainEqual(expect.objectContaining({ code: 'hierarchy' })));
spec('TW-TREE-007', () => expect(() => session([record('orphan', 'missing')])).toThrow('孤立'));
spec('TW-TREE-008', () => expect(() => session([record('c1', 'c2', 'a0', 'category'), record('c2', 'c1', 'a0', 'category')])).toThrow('循環'));
spec('TW-LIST-006', () => expect(plan(t => t.split('\n').map((line, i) => ' '.repeat(i * 3 + 1) + line).join('\n'), seed(), 'list')).toMatchObject({ errors: [], changes: [] }));
spec('TW-LIST-007', () => expect(plan(t => t + '\nCategory | new', seed(), 'list').errors).toContainEqual(expect.objectContaining({ code: 'protected' })));
spec('TW-LIST-008', () => { const s = session(seed(), 'list'); expect(s.orderedIds).toEqual(['a', 'b']); expect(s.listGroups).toEqual({ a: 'none', b: 'none' }); expect(serializeText(s)).not.toContain('Category'); });
spec('TW-LIST-009', () => {
  const current = seed(), s = createTextSession(current, { id: 'hidden', scope: 'local', view: 'list', ...context, orderedIds: ['a'], listGroups: { a: 'visible' } });
  expect(Object.values(s.refs)).toEqual(['a']); expect(planTextEdit(s, serializeText(s), current).deletedIds).toEqual([]);
});
spec('TW-DUE-006', () => { for (const due of ['4/25', '2027/4/25', '4/25 17:00', '2027/4/25 17:00:12.345', '2027-04-25T08:00:12.345Z']) expect(resolveDeadline(due, context)).not.toBeNull(); });
spec('TW-DUE-007', () => { const current = seed(); Object.assign(current[1].value, { dueAt: '2026-01-01T14:59:00.000Z', duePreset: 'today' }); expect(plan(t => t, current)).toMatchObject({ errors: [], changes: [] }); });
spec('TW-DUE-008', () => {
  const current = seed(); Object.assign(current[1].value, resolveDeadline('今日', context)); expect(serializeText(session(current))).toContain('| 今日 |');
  current[1].value.dueAt = '2026-01-01T14:59:00.000Z'; expect(serializeText(session(current))).toContain('| 2026/1/1 |');
});
spec('TW-OCC-002', () => { const current = seed(); current[4].value.routineOccurrenceKey = '2026-10-05'; expect(() => session(current)).toThrow('projection'); });
spec('TW-OCC-003', () => { const p = plan(t => t + '\n  @routine-overdue:r:2026-10-05 | Task | virtual'); expect(p.errors.length).toBeGreaterThan(0); expect(p.changes).toEqual([]); });
spec('TW-OCC-004', () => { const p = plan(() => '', seed(), 'list'); expect(p.deletedIds).toEqual(['a', 'b']); expect(p.changes.some(c => c.id === 'r')).toBe(false); });
spec('TW-HL-002', () => { const s = session(), h = textHighlights(s, serializeText(s).replace('\n\n@routine', '\n  Task | new\n\n@routine')); expect(h.rows.find(r => r.row.title === 'new')).toMatchObject({ isNew: true, changed: [false, false, false] }); });
spec('TW-HL-003', () => { const s = session(), ref = Object.keys(s.refs).find(ref => s.refs[ref] === 'b')!; const h = textHighlights(s, serializeText(s).split('\n').filter(line => !line.includes(ref + ' |')).join('\n')); expect(h.deleted).toEqual([ref]); });
spec('TW-HL-004', () => { const s = session(); const h = textHighlights(s, serializeText(s).replace('    @n2', '  @n2')); expect(h.rows.find(r => r.row.ref === '@n2')!.structureChanged).toBe(true); });
spec('TW-HL-005', () => {
  expect(textCellCandidates(0)).toEqual([]); expect(textCellCandidates(1)).toEqual(TEXT_TYPES); expect(textCellCandidates(2)).toEqual([]);
  expect(textCellCandidates(3)).toEqual(RELATIVE_DUE_VALUES); expect(textCellCandidates(4)).toEqual(COMPLETION_VALUES); expect(textCellCandidates(5)).toEqual([]); expect(textCellCandidates(6)).toEqual(['なし', ...Object.keys(ROUTINE_ALIASES)]);
});
spec('TW-CLOSE-002', () => expect(closeTextChoices(true, false)).toEqual(['continue', 'save', 'discard']));
spec('TW-CLOSE-003', () => { expect(closeTextChoices(false, false)).toEqual(['close']); expect(closeTextChoices(false, true)).toEqual(['close']); });
class Memory implements ApplicationJournalPersistence {
  value: string | null = null;
  loadCommitted = async () => this.value; loadJournal = async () => null;
  writeCommitted = async (v: string) => { this.value = v; }; writeJournal = async () => {}; clearJournal = async () => {};
  writeAtomic = async (expected: string | null, v: string) => { if (this.value !== expected) throw new Error('CAS'); this.value = v; };
}
spec('TW-CLOSE-004', async () => {
  const p = new Memory(), store = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'local' }); await store.ensureRoutineRoot();
  const s = store.beginTextEdit({ scope: 'local', view: 'tree', systemRegions: true, timeZone: context.timeZone }); const before = p.value;
  store.discardTextEdit(s); expect(p.value).toBe(before); expect(() => store.prepareTextEdit(s, 'invalid')).toThrow('session');
});
const mass = (size: number, changed: number) => {
  const source = generateNKeysBetween(null, null, size).map((key, i) => record('task' + i, null, key));
  const s = session(source), text = serializeText(s).split('\n').map((line, i) => i > 0 && i <= changed ? line.replace(/\| task\d+ \|/, '| edit |') : line).join('\n');
  return planTextEdit(s, text, source);
};
spec('TW-GUARD-003', () => { expect(mass(1000, 49).requiresConfirmation).toBe(false); expect(mass(1000, 50).requiresConfirmation).toBe(true); });
spec('TW-GUARD-004', () => { expect(mass(20, 5).requiresConfirmation).toBe(false); expect(mass(20, 6).requiresConfirmation).toBe(true); });
spec('TW-GUARD-005', () => { const p = plan(t => t.replace('| a |', '| edit |')); expect(p.errors).toEqual([]); expect(p.requiresConfirmation).toBe(false); });
spec('TW-GUARD-006', () => { const p = plan(t => t.split('\n').filter(line => !line.includes('@n3 |')).join('\n')); expect(p.deletedIds).toEqual(['b']); expect(p.requiresConfirmation).toBe(true); });
spec('TW-META-002', () => { const c = renamed(); expect(c.after.id).toBe(c.before!.id); expect(c.after.createdAt).toBe(c.before!.createdAt); });
spec('TW-META-003', () => expect(renamed().after.future).toEqual({ nested: ['keep'] }));
spec('TW-META-004', () => expect(renamed().after.deadlineSortKey).toBe('a0'));
spec('TW-META-005', () => expect(renamed().after.routineHistory).toEqual(seed()[1].value.routineHistory));
spec('TW-META-006', () => expect(renamed().after.routineDueOverrides).toEqual(seed()[1].value.routineDueOverrides));
spec('TW-META-007', () => { const c = renamed(); expect(c.after.sortKey).toBe(c.before!.sortKey); });
spec('TW-CON-004', () => { const current = seed(), s = session(current); current[1].value.title = 'remote'; expect(planTextEdit(s, serializeText(s), current).errors).toContainEqual(expect.objectContaining({ code: 'conflict' })); });
spec('TW-CON-005', () => { const current = seed(), s = session(current); current.push(record('remote-new', null, 'a2')); expect(planTextEdit(s, serializeText(s), current).errors).toContainEqual(expect.objectContaining({ code: 'conflict' })); });
spec('TW-RTN-010', () => { const p = plan(t => t.replace('day interval=1 startsOn=2026-10-05', 'なし')); expect(p.errors).toContainEqual(expect.objectContaining({ code: 'routine' })); expect(p.changes).toEqual([]); });
spec('TW-RTN-011', () => { for (const [alias, frequency] of Object.entries(ROUTINE_ALIASES)) expect(parseRoutine(alias, '2026-10-07')).toEqual({ frequency, interval: 1, startsOn: '2026-10-07' }); });
spec('TW-RTN-012', () => { const p = plan(t => t.replace('| r | 期限なし | 未完了', '| r | 期限なし | 完了')); expect(p.errors).toEqual([]); expect(p.changes.find(c => c.id === 'r')!.after.routineHistory).toMatchObject({ '2026-10-07': now }); });
const view = () => listTextSnapshot(seed().map(r => nodeFromV2Value(r.value)), [{ key: 'today', label: '今日', memos: [nodeFromV2Value(seed()[1].value) as import('../models/node').MemoNode] }], new Date(now));
spec('TW-VIEW-002', () => { const nodes = seed().map(r => nodeFromV2Value(r.value)), a = nodes[1] as import('../models/node').MemoNode, b = nodes[2] as typeof a; expect(renderTextView(listTextSnapshot(nodes, [{ key: 'month', label: '今月', memos: [b, a] }, { key: 'today', label: '今日', memos: [a] }], new Date(now)), [])).toBe('今月\n  b\n  a\n今日\n  a'); });
spec('TW-VIEW-003', () => expect(renderTextView(view(), [])).toBe('今日\n  a'));
spec('TW-VIEW-004', () => { expect(renderTextView(view(), ['due'])).toBe('今日\n  a\n    - 期限なし'); expect(renderTextView(view(), [])).not.toContain('期限なし'); });
spec('TW-VIEW-005', () => { expect(renderTextView(view(), ['body'])).toBe('今日\n  a\n    - body'); expect(renderTextView(view(), [])).not.toContain('body'); });
spec('TW-VIEW-006', () => { expect(renderTextView(view(), ['type'])).toBe('今日\n  a\n    - Task'); expect(renderTextView(view(), [])).not.toContain('Task'); });
spec('TW-VIEW-007', () => { expect(renderTextView(view(), ['completion'])).toBe('今日\n  a\n    - 未完了'); expect(renderTextView(view(), [])).not.toContain('未完了'); });
spec('TW-VIEW-008', () => { expect(renderTextView(view(), ['category'])).toBe('今日\n  a\n    - cat'); expect(renderTextView(view(), [])).not.toContain('cat'); });
spec('TW-VIEW-009', () => { expect(renderTextView(view(), ['routine'])).toBe('今日\n  a\n    - なし'); expect(renderTextView(view(), [])).not.toContain('なし'); });
spec('TW-VIEW-010', () => { expect(renderTextView(view(), ['body'], true)).toContain('- 自由入力（本文）: body'); expect(renderTextView(view(), ['body'], false)).not.toContain(TEXT_DETAIL_LABELS.body); });
spec('TW-VIEW-011', () => expect(renderTextView(view(), ['body', 'type'])).toBe('今日\n  a\n    - body\n    - Task'));
spec('TW-VIEW-012', () => expect(renderTextView(view(), ['body', 'type', 'due', 'completion', 'category', 'routine'], true)).not.toMatch(/@n\d|@root|@routine|remote:7|sortKey|revision|routine-root/));
spec('TW-VIEW-013', () => { const records = seed(), nodes = records.map(r => nodeFromV2Value(r.value)), before = canonical(nodes); listTextSnapshot(nodes, [], new Date(now)); renderTextView(view(), ['body']); expect(canonical(nodes)).toBe(before); });
spec('TW-VIEW-014', () => { const snapshot = view(); snapshot.rows[1].details.body = '@n1 | user text\nrevision'; expect(renderTextView(snapshot, ['body'])).toContain('@n1 | user text\n      revision'); });

/** Actual ordinary Domain commands + the same recurrence form boundary used by EditorModal. No hand-built valid Memo fixture. */
async function ordinaryUIFixture(scope: string) {
  const persistence = new Memory();
  const store = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: scope, now: () => new Date(now) });
  const parent = await store.ensureRoutineRoot(), date = new Date(now);
  const create = async (id: string, type: 'memo' | 'category', draft: Parameters<typeof createNode>[2]) => store.command('ordinary create', 'create', nodes => createNode(nodes, type, draft, date, id));
  await create('cat', 'category', { title: 'Category', parentId: null });
  await create('nested', 'category', { title: 'Nested', parentId: 'cat' });
  for (const [i, duePreset] of ['today', 'tomorrow', 'thisWeek', 'thisMonth', 'thisYear', 'none', 'custom'].entries()) {
    const dueAt = duePreset === 'custom' ? new Date('2027-04-25T08:00:12.345Z') : dueDateForPreset(duePreset as import('../models/node').DuePreset, new Date('2026-10-01T03:00:00.000Z'));
    await create(`task${i}`, 'memo', { parentId: 'nested', title: '同名 | Task', body: ' text\r\n本文\n', dueAt, duePreset: duePreset as import('../models/node').DuePreset, memoType: 'task' });
  }
  await create('idea', 'memo', { parentId: null, title: 'Idea', body: 'idea body', memoType: 'idea', dueAt: null, duePreset: 'none' });
  await store.command('ordinary complete', 'complete', nodes => completeMemo(nodes, 'task0', date));
  expect(initialRoutineFrequency(null, true)).toBe('day');
  for (const frequency of ['day', 'week', 'month', 'year'] as const) {
    await create('routine-' + frequency, 'memo', { parentId: parent, title: 'Routine ' + frequency, dueAt: new Date('2026-10-01T08:00:00.000Z'), duePreset: 'custom', repeatRule: routineRuleForSave(frequency, '1', '2026-09-01') });
  }
  await store.command('ordinary completion', 'complete', nodes => completeMemo(nodes, 'routine-day', date));
  await store.command('ordinary body update', 'update', nodes => updateNode(nodes, 'routine-week', { body: 'Routine\n本文 | quoted' }, date));
  await store.command('ordinary duplicate', 'create', nodes => duplicateMemo(nodes, 'task1', date, 'duplicate'));
  await store.command('ordinary move', 'update', nodes => moveNode(nodes, 'duplicate', null, undefined, date));
  await store.command('ordinary delete', 'softDelete', nodes => softDeleteNode(nodes, 'task2', false, date));
  return { store, persistence };
}
function invariant(store: TaskMemoV2ApplicationStore, scope: string, view: 'tree' | 'list') {
  const nodes = store.nodes, date = new Date(now);
  const projection = view === 'list' ? listEditProjection(nodes, deadlineDisplayGroups(deadlineGroups(nodes, date), date)) : null;
  const orderedIds = view === 'tree' ? flattenVisibleNodes(nodes, new Set(nodes.filter(n => n.type === 'category').map(n => n.id).concat(UNASSIGNED_GROUP_ID)), true).filter(row => !row.virtual).map(row => row.node.id) : projection!.orderedIds;
  const s = store.beginTextEdit({ scope, view, timeZone: context.timeZone, systemRegions: view === 'tree', orderedIds, listGroups: projection?.listGroups });
  const text = serializeText(s), p = store.prepareTextEdit(s, text);
  expect(p.errors, `${scope}/${view}\n${text}`).toEqual([]); expect(p.changes).toEqual([]); expect(p.deletedIds).toEqual([]);
  return p;
}
spec('TW-INV-001', async () => { const { store } = await ordinaryUIFixture('local'); invariant(store, 'local', 'tree'); });
spec('TW-INV-002', async () => { const { store } = await ordinaryUIFixture('local'); invariant(store, 'local', 'list'); });
spec('TW-INV-003', async () => {
  for (const scope of ['local', 'account']) {
    const { persistence } = await ordinaryUIFixture(scope);
    const store = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: 'ignored' });
    for (const view of ['tree', 'list'] as const) {
      const before = persistence.value, depths = store.historyDepths, outbox = canonical(store.outbox);
      await store.commitTextEdit(invariant(store, scope, view));
      expect(persistence.value).toBe(before); expect(store.historyDepths).toEqual(depths); expect(canonical(store.outbox)).toBe(outbox);
    }
  }
});
spec('TW-SCOPE-002', async () => {
  const local = await TaskMemoV2ApplicationStore.open(new Memory(), seed().map(r => nodeFromV2Value(r.value)), { deviceId: 'local' });
  const p = new Memory(), account = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'account' });
  const s = local.beginTextEdit({ scope: 'local', view: 'tree', systemRegions: true, timeZone: context.timeZone });
  const reviewed = local.prepareTextEdit(s, serializeText(s).replace('| a |', '| changed |')), before = p.value;
  await expect(account.commitTextEdit(reviewed)).rejects.toThrow('session'); expect(p.value).toBe(before); expect(account.outbox).toEqual([]);
});
spec('TW-CON-006', async () => {
  const p = new Memory(), store = await TaskMemoV2ApplicationStore.open(p, seed().map(r => nodeFromV2Value(r.value)), { deviceId: 'local' });
  const s = store.beginTextEdit({ scope: 'local', view: 'tree', systemRegions: true, timeZone: context.timeZone });
  const reviewed = store.prepareTextEdit(s, serializeText(s).split('\n').filter(line => !line.includes('@n3 |')).join('\n'));
  const before = p.value;
  await expect(store.commitTextEdit(reviewed, { deletedIds: reviewed.deletedIds, fingerprint: reviewed.fingerprint + 'tampered' })).rejects.toThrow('確認'); expect(p.value).toBe(before);
});
spec('TW-RANK-003', () => { const source = seed(); source[2].value.sortKey = 'a0'; const p = plan(t => t.replace('\n\n@routine', '\n    Task | fresh\n\n@routine'), source); expect(p.errors).toContainEqual(expect.objectContaining({ code: 'protected' })); expect(p.changes).toEqual([]); });
spec('TW-META-008', () => { const source = seed(); source[1].value.dayPart = 'legacy-pm'; const p = plan(t => t.replace('| a |', '| changed |'), source); expect(p.errors).toEqual([]); expect(p.changes[0].after.dayPart).toBe('legacy-pm'); });
spec('TW-SER-003', () => { const source = [record('private-node-id-12345', null)]; source[0].value.title = 'Public title'; const text = serializeText(session(source)); expect(text).toContain('@n1'); for (const internal of ['private-node-id-12345', 'remote:7', 'revision', 'future', 'routineHistory']) expect(text).not.toContain(internal); });
spec('TW-INV-004', () => {
  // Assert the real ordinary UI uses the boundaries exercised by the cross-feature fixture.
  // A helper-only fixture would miss a future disconnection of EditorModal from these helpers.
  const source = ts.createSourceFile('index.tsx', readFileSync('src/app/index.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initial = '', saved = '';
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === '[repeatFrequency, setRepeatFrequency]') initial = node.initializer?.getText(source) ?? '';
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'routineRuleForSave') saved = node.arguments.map(arg => arg.getText(source)).join(',');
    ts.forEachChild(node, visit);
  }; visit(source);
  expect(initial).toContain('initialRoutineFrequency(initialMemo, !!routineCategory)');
  expect(saved).toBe('repeatFrequency,repeatInterval,repeatStartsOn');
});
spec('TW-ARCH-001', () => {
  for (const file of ['parser', 'validator', 'deadlines', 'session', 'planner', 'presentation']) {
    const source = ts.createSourceFile(file + '.ts', readFileSync(`src/textFormat/${file}.ts`, 'utf8'), ts.ScriptTarget.Latest, true);
    const imports = source.statements.filter(ts.isImportDeclaration).map(statement => statement.moduleSpecifier.getText(source));
    expect(imports.join('\n')).not.toMatch(/react|firebase|storage|applicationStore|expo-/i);
  }
});
