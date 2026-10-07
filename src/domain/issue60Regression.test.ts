import { expect, it } from 'vitest';
import type { MemoNode } from '../models/node';
import { deadlineDisplayGroups, deadlineGroupDefinitions, deadlineGroups, hiddenDeadlineSummary } from './deadlineView';

it.each([new Date(2026, 9, 3, 8), new Date(2026, 8, 26, 8), new Date(2026, 11, 26, 8)])('[60-WEEK] Saturday forward containment preserves Monday through Sunday (%s)', now => {
  const visible = new Set(deadlineGroupDefinitions('today').map(g => g.id).filter(id => !['tomorrow', 'twoThreeDays'].includes(id)));
  const nodes: MemoNode[] = [0, 1, 2, 3, 8].map(offset => ({ id: `${offset}`, type: 'memo', parentId: null, sortKey: `a${offset}`, title: 'fixture', body: '', duePreset: 'custom', dueAt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 12), status: 'active', completedAt: null, deletedAt: null, createdAt: now, updatedAt: now }));
  const original = structuredClone(nodes);
  const groups = deadlineDisplayGroups(deadlineGroups(nodes, now, visible, 'today'), now, 'today');
  expect(groups.find(g => g.key === 'today')?.memos.map(m => m.id)).toEqual(['0']);
  expect(groups.find(g => g.key === 'thisWeek')?.memos.map(m => m.id)).toEqual(['1']);
  expect(groups.find(g => g.key === 'nextWeek')?.memos.map(m => m.id)).toEqual(['2', '3', '8']);
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
  const sunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 8);
  const label = groups.find(g => g.key === 'nextWeek')!.label;
  expect(label).toContain(`${monday.getMonth()+1}/${monday.getDate()}`);
  expect(label).toContain(`${sunday.getMonth()+1}/${sunday.getDate()}`);
  expect(hiddenDeadlineSummary(nodes, now, visible, 'today').total).toBe(0);
  expect(nodes).toEqual(original);
});

it.each([new Date(2026, 9, 3, 8), new Date(2026, 9, 4, 8), new Date(2026, 11, 31, 8)])('[60-FILTERS] every future visibility combination respects semantic endpoints (%s)', now => {
  const keys = ['tomorrow', 'twoThreeDays', 'thisWeek', 'nextWeek', 'thisMonth', 'thisYear', 'later'];
  const definitions = deadlineGroupDefinitions('today');
  for (let mask = 0; mask < 128; mask++) {
    const visible = new Set(definitions.filter(g => !keys.includes(g.id) || !!(mask & (1 << keys.indexOf(g.id)))).map(g => g.id));
    const nodes: MemoNode[] = Array.from({ length: 40 }, (_, offset) => ({ id: `${offset}`, type: 'memo', parentId: null, sortKey: 'a0', title: 'fixture', body: '', duePreset: 'custom', dueAt: new Date(now.getFullYear(), now.getMonth(), now.getDate()+offset, 12), status: 'active', completedAt: null, deletedAt: null, createdAt: now, updatedAt: now }));
    const raw = deadlineGroups(nodes, now, visible, 'today');
    const before = raw.map(g => ({ ...g, memos: [...g.memos] }));
    const display = deadlineDisplayGroups(raw, now, 'today');
    expect(raw).toEqual(before);
    expect(display.flatMap(g => g.memos).length + hiddenDeadlineSummary(nodes, now, visible, 'today').total).toBe(nodes.length);
    for (const group of display) {
      const range = /（([^）]+)）$/.exec(group.label)?.[1];
      if (!range) continue;
      const [from, to] = range.split('〜');
      const parse = (value: string) => {
        const parts = value.split('/').map(Number);
        return parts.length === 3 ? new Date(parts[0], parts[1]-1, parts[2]) : new Date(now.getFullYear(), parts[0]-1, parts[1]);
      };
      const start = parse(from), end = to === '' ? null : parse(to ?? from);
      end?.setHours(23, 59, 59, 999);
      expect(group.memos.every(m => m.dueAt! >= start && (!end || m.dueAt! <= end)), group.label).toBe(true);
    }
    for (const group of raw) {
      const end = group.create?.dueAt(now);
      if (!end || !['thisWeek', 'nextWeek', 'thisMonth', 'thisYear'].includes(group.key)) continue;
      expect(group.memos.every(m => m.dueAt! <= end)).toBe(true);
    }
  }
});
