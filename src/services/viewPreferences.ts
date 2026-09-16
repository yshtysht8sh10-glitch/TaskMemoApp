import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEADLINE_GROUPS, type DeadlineGroupKey } from '@/domain/deadlineView';

const LIST_DISPLAY_KEY = '@taskmemo/view/list-display/v1';
export type ListDisplayPreferences = { visibleGroupIds: DeadlineGroupKey[]; showPinnedNote: boolean };
export const DEFAULT_LIST_DISPLAY_PREFERENCES: ListDisplayPreferences = { visibleGroupIds: DEADLINE_GROUPS.map((group) => group.id), showPinnedNote: true };

export async function loadListDisplayPreferences(): Promise<ListDisplayPreferences> {
  const raw = await AsyncStorage.getItem(LIST_DISPLAY_KEY); if (!raw) return DEFAULT_LIST_DISPLAY_PREFERENCES;
  try { const value = JSON.parse(raw) as { visibleGroupIds?: unknown; showPinnedNote?: unknown }; const validIds = new Set(DEADLINE_GROUPS.map((group) => group.id)); const visibleGroupIds = Array.isArray(value.visibleGroupIds) ? value.visibleGroupIds.filter((id): id is DeadlineGroupKey => typeof id === 'string' && validIds.has(id as DeadlineGroupKey)) : DEFAULT_LIST_DISPLAY_PREFERENCES.visibleGroupIds; return { visibleGroupIds, showPinnedNote: typeof value.showPinnedNote === 'boolean' ? value.showPinnedNote : true }; } catch { return DEFAULT_LIST_DISPLAY_PREFERENCES; }
}

export async function saveListDisplayPreferences(value: ListDisplayPreferences) { await AsyncStorage.setItem(LIST_DISPLAY_KEY, JSON.stringify(value)); }
