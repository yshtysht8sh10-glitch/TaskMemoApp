import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFeaturePreferences } from './featurePreferences';
import { loadReminderPreferences } from './reminderPreferences';
import { loadListDisplayPreferences, loadTreeDisplayPreferences } from './viewPreferences';
import { saveBackupSettings } from './backupSettingsStorage';
import type { TaskMemoBackupSettings } from './nodeBackup';

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
  multiSet: vi.fn(async (entries: [string, string][]) => { for (const [key, value] of entries) storage.set(key, value); }),
} }));

const settings: TaskMemoBackupSettings = {
  listDisplay: { visibleGroupIds: ['overdue', 'tomorrow'], showPinnedNote: false, todayGranularity: 'dayNight', pinnedNoteHeight: 200 },
  treeDisplay: { showCompletedMemos: true }, reminders: { enabled: true, sameDay: false, dayBefore: true },
  theme: 'dark', features: { ideasEnabled: true },
};

describe('backup settings persistence', () => {
  beforeEach(() => storage.clear());
  it('restores all settings in one batch and they survive a loader restart', async () => {
    await saveBackupSettings(settings);
    await expect(loadListDisplayPreferences()).resolves.toEqual(settings.listDisplay);
    await expect(loadTreeDisplayPreferences()).resolves.toEqual(settings.treeDisplay);
    await expect(loadReminderPreferences()).resolves.toEqual(settings.reminders);
    await expect(loadFeaturePreferences()).resolves.toEqual(settings.features);
    await expect(AsyncStorage.getItem('@taskmemo/settings/theme/v1')).resolves.toBe('dark');
  });
});
