import AsyncStorage from '@react-native-async-storage/async-storage';

import type { TaskMemoBackupSettings } from './nodeBackup';

const LIST_DISPLAY_KEY = '@taskmemo/view/list-display/v1';
const TREE_DISPLAY_KEY = '@taskmemo/view/tree-display/v1';
const REMINDERS_KEY = '@taskmemo/settings/reminders/v1';
const THEME_KEY = '@taskmemo/settings/theme/v1';
const FEATURES_KEY = '@taskmemo/settings/features/v1';

/** Persist the already-validated settings section as one AsyncStorage batch. */
export async function saveBackupSettings(settings: TaskMemoBackupSettings) {
  await AsyncStorage.multiSet([
    [LIST_DISPLAY_KEY, JSON.stringify(settings.listDisplay)],
    [TREE_DISPLAY_KEY, JSON.stringify(settings.treeDisplay)],
    [REMINDERS_KEY, JSON.stringify(settings.reminders)],
    [THEME_KEY, settings.theme],
    [FEATURES_KEY, JSON.stringify(settings.features)],
  ]);
}
