import { beforeEach, expect, it, vi } from 'vitest';
import { loadListDisplayPreferences, saveListDisplayPreferences, reconcileListDisplayAccount } from './viewPreferences';
import { saveBackupSettings } from './backupSettingsStorage';
const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
  getAllKeys: vi.fn(async () => [...storage.keys()]),
  multiSet: vi.fn(async (entries: [string, string][]) => { entries.forEach(([k,v]) => storage.set(k,v)); }),
} }));
const key = '@taskmemo/view/list-display/v1';
beforeEach(() => { storage.clear(); vi.unstubAllGlobals(); });
it('initializes clean installs ON and persists the decision through reload', async () => {
  const prefs = await loadListDisplayPreferences();
  expect(prefs.visibleGroupIds).toEqual(expect.arrayContaining(['nextMonth', 'nextYear']));
  await expect(loadListDisplayPreferences()).resolves.toEqual(prefs);
});
it.each(['@taskmemo/nodes/v1','@taskmemo/sync-v2/taskmemo-application/v2/account:old','@taskmemo/settings/features/v1'])('detects existing usage from %s even without list settings', async evidence => {
  storage.set(evidence, '{}');
  const prefs = await loadListDisplayPreferences();
  expect(prefs.visibleGroupIds).not.toContain('nextMonth'); expect(prefs.visibleGroupIds).not.toContain('nextYear');
  expect(storage.get(evidence)).toBe('{}');
});
it('detects migrated IndexedDB without opening or changing the database', async () => {
  const open = vi.fn(); vi.stubGlobal('indexedDB', { databases: async () => [{ name: 'taskmemo-v2-local-application' }], open });
  expect((await loadListDisplayPreferences()).visibleGroupIds).not.toContain('nextMonth'); expect(open).not.toHaveBeenCalled();
});
it('preserves old explicit settings exactly and never turns OFF groups ON through account sync', async () => {
  const old = { visibleGroupIds: ['today', 'later'], showPinnedNote: false, todayGranularity: 'today', pinnedNoteHeight: 200 };
  storage.set(key, JSON.stringify(old));
  await expect(loadListDisplayPreferences()).resolves.toEqual(old);
  await expect(reconcileListDisplayAccount('2020-01-01')).resolves.toBeNull();
  expect(JSON.parse(storage.get(key)!)).toEqual(old);
});
it('new installation login to an older account changes only automatic initial defaults once', async () => {
  const fresh = await loadListDisplayPreferences();
  const adjusted = await reconcileListDisplayAccount('2020-01-01');
  expect(adjusted!.visibleGroupIds).toEqual(fresh.visibleGroupIds.filter(id => !['nextMonth','nextYear'].includes(id)));
  await expect(reconcileListDisplayAccount('2020-01-01')).resolves.toBeNull();
  await expect(loadListDisplayPreferences()).resolves.toEqual(adjusted);
});
it('keeps genuinely new accounts ON and explicit choices override automatic account adjustment', async () => {
  const fresh = await loadListDisplayPreferences();
  await expect(reconcileListDisplayAccount('2099-01-01')).resolves.toBeNull();
  await saveListDisplayPreferences(fresh);
  await expect(reconcileListDisplayAccount('2020-01-01')).resolves.toBeNull();
  await expect(loadListDisplayPreferences()).resolves.toEqual(fresh);
});
it('does not turn new-account defaults OFF because Auth time has only second precision', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-27T00:00:00.950Z'));
  try {
    const fresh = await loadListDisplayPreferences();
    await expect(reconcileListDisplayAccount('Tue, 27 Oct 2026 00:00:00 GMT')).resolves.toBeNull();
    await expect(loadListDisplayPreferences()).resolves.toEqual(fresh);
  } finally { vi.useRealTimers(); }
});
it('backup restore removes initial-default provenance and preserves imported OFF settings', async () => {
  await loadListDisplayPreferences();
  const prefs = { visibleGroupIds: ['later' as const], showPinnedNote: false, todayGranularity: 'today' as const, pinnedNoteHeight: 150 };
  await saveBackupSettings({ listDisplay: prefs, treeDisplay: { showCompletedMemos: true }, reminders: { enabled: false, sameDay: false, dayBefore: false }, theme: 'dark', features: { ideasEnabled: true } });
  await expect(reconcileListDisplayAccount('2020-01-01')).resolves.toBeNull();
  await expect(loadListDisplayPreferences()).resolves.toEqual(prefs);
});
it('corrupt settings do not silently opt existing users into new groups or overwrite raw data', async () => {
  storage.set(key, 'broken');
  expect((await loadListDisplayPreferences()).visibleGroupIds).not.toContain('nextMonth');
  expect(storage.get(key)).toBe('broken');
});
