import { describe, expect, it } from 'vitest';
import type { Node } from '@/models/node';
import { parseNodeBackup, parseTaskMemoBackup, serializeNodeBackup, serializeTaskMemoBackup } from './nodeBackup';
import type { TaskMemoBackupSettings } from './nodeBackup';

const date = new Date('2026-09-13T00:00:00.000Z');
const category: Node = { id: 'c', type: 'category', parentId: null, sortKey: 'a0', title: 'Category', createdAt: date, updatedAt: date, deletedAt: null, deletionBatchId: null };
const memo: Node = { id: 'm', type: 'memo', memoType: 'task', parentId: 'c', sortKey: 'a0', title: 'Memo', body: 'body', dueAt: date, duePreset: 'custom', status: 'active', completedAt: null, repeatRule: { frequency: 'week', interval: 2, startsOn: '2026-09-13' }, createdAt: date, updatedAt: date, deletedAt: null, deletionBatchId: 'metadata' };
const settings: TaskMemoBackupSettings = { listDisplay: { visibleGroupIds: ['overdue', 'am'], showPinnedNote: false, todayGranularity: 'threePart', pinnedNoteHeight: 180 }, treeDisplay: { showCompletedMemos: true }, reminders: { enabled: true, sameDay: false, dayBefore: true }, theme: 'dark', features: { ideasEnabled: true } };

describe('Node backup', () => {
  it('Task/Idea種別をJSONで往復し、旧バックアップMemoはTaskへ正規化する', () => { const idea = { ...memo, memoType: 'idea' as const }; const { memoType: _memoType, ...legacy } = memo; expect(parseNodeBackup(serializeNodeBackup([category, idea]))[1]).toMatchObject({ memoType: 'idea' }); expect(parseNodeBackup(serializeNodeBackup([category, legacy as Node]))[1]).toMatchObject({ memoType: 'task' }); });
  it('全Node項目とDateを往復する', () => { const restored = parseNodeBackup(serializeNodeBackup([category, memo], date)); expect(restored).toEqual([category, memo]); expect(restored[1].createdAt).toBeInstanceOf(Date); });
  it('完全削除tombstoneをDateとして往復する', () => { const purged = [{ ...category, deletedAt: date, purgedAt: date }, { ...memo, deletedAt: date, purgedAt: date }]; expect(parseNodeBackup(serializeNodeBackup(purged, date))).toEqual(purged); });
  it('壊れたJSONとschemaVersionを拒否する', () => { expect(() => parseNodeBackup('{')).toThrow(/JSON/); expect(() => parseNodeBackup('{"schemaVersion":99,"exportedAt":"2026-01-01T00:00:00Z","nodes":[]}')).toThrow(/対応/); });
  it('存在しない親とMemo親を拒否する', () => { expect(() => parseNodeBackup(serializeNodeBackup([{ ...memo, parentId: 'missing' }]))).toThrow(/親参照/); expect(() => parseNodeBackup(serializeNodeBackup([{ ...memo, parentId: null }, { ...category, parentId: 'm' }]))).toThrow(/親参照/); });
  it('自己参照とcycleを拒否する', () => { expect(() => parseNodeBackup(serializeNodeBackup([{ ...category, parentId: 'c' }]))).toThrow(/親参照/); const a = { ...category, id: 'a', parentId: 'b' }; const b = { ...category, id: 'b', parentId: 'a' }; expect(() => parseNodeBackup(serializeNodeBackup([a, b]))).toThrow(/cycle/); });
  it('schema 3でcontent・常設メモ・全永続設定を往復する', () => {
    const pinnedNote = { body: 'shared pinned note', updatedAt: date };
    const raw = serializeTaskMemoBackup([category, memo], pinnedNote, settings, date);
    expect(parseTaskMemoBackup(raw)).toEqual({ nodes: [category, memo], pinnedNote, settings });
    expect(JSON.parse(raw)).not.toHaveProperty('deviceId');
    expect(JSON.parse(raw)).not.toHaveProperty('outbox');
    expect(JSON.parse(raw)).not.toHaveProperty('history');
    expect(JSON.parse(raw)).not.toHaveProperty('revision');
  });
  it('schema 1/2では存在しないpinnedNote・settingsを現在値維持用nullとして返す', () => {
    const pinnedNote = { body: 'schema 2', updatedAt: date.toISOString() };
    expect(parseTaskMemoBackup(serializeNodeBackup([category], date))).toEqual({ nodes: [category], pinnedNote: null, settings: null });
    expect(parseTaskMemoBackup(JSON.stringify({ schemaVersion: 2, exportedAt: date.toISOString(), nodes: [category], pinnedNote }))).toEqual({ nodes: [category], pinnedNote: { body: 'schema 2', updatedAt: date }, settings: null });
  });
  it('不正な設定値と部分的なschema 3を全体適用前に拒否する', () => {
    const raw = JSON.parse(serializeTaskMemoBackup([category], { body: '', updatedAt: date }, settings, date));
    raw.settings.theme = 'sepia';
    expect(() => parseTaskMemoBackup(JSON.stringify(raw))).toThrow(/設定値/);
    delete raw.settings.reminders;
    expect(() => parseTaskMemoBackup(JSON.stringify(raw))).toThrow(/設定/);
  });
});
