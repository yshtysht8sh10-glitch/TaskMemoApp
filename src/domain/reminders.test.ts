import { describe, expect, it } from 'vitest';
import type { MemoNode } from '../models/node';
import { reminderPlans } from './reminders';

const memo = (overrides: Partial<MemoNode> = {}): MemoNode => ({ id: 'm', type: 'memo', parentId: null, sortKey: 'a', title: '提出する', body: '', createdAt: new Date(0), updatedAt: new Date(0), deletedAt: null, dueAt: new Date(2026, 8, 20, 23, 59), duePreset: 'today', status: 'active', completedAt: null, ...overrides });

describe('reminderPlans', () => {
  it('前日と当日の午前9時を予定する', () => expect(reminderPlans([memo()], { enabled: true, sameDay: true, dayBefore: true }, new Date(2026, 8, 18))).toMatchObject([{ key: 'm:day-before', triggerAt: new Date(2026, 8, 19, 9) }, { key: 'm:same-day', triggerAt: new Date(2026, 8, 20, 9) }]));
  it('日時指定は当日の通知を指定時刻にする', () => expect(reminderPlans([memo({ duePreset: 'custom', dueAt: new Date(2026, 8, 20, 15) })], { enabled: true, sameDay: true, dayBefore: false }, new Date(2026, 8, 18))[0].triggerAt).toEqual(new Date(2026, 8, 20, 15)));
  it('完了・削除・ルーティーンは通知しない', () => expect(reminderPlans([memo({ status: 'completed' }), memo({ id: 'd', deletedAt: new Date() }), memo({ id: 'r', repeatRule: { frequency: 'day', interval: 1, startsOn: '2026-09-01' } })], { enabled: true, sameDay: true, dayBefore: true }, new Date(2026, 8, 18))).toEqual([]));
});
