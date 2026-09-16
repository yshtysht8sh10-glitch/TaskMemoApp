import AsyncStorage from '@react-native-async-storage/async-storage';
import { allDeadlineGroupIds, TODAY_GRANULARITIES, type DeadlineGroupKey, type TodayGranularity } from '@/domain/deadlineView';

const LIST_DISPLAY_KEY = '@taskmemo/view/list-display/v1';
export type ListDisplayPreferences = { visibleGroupIds: DeadlineGroupKey[]; showPinnedNote: boolean; todayGranularity: TodayGranularity };
export const DEFAULT_LIST_DISPLAY_PREFERENCES: ListDisplayPreferences = { visibleGroupIds: allDeadlineGroupIds(), showPinnedNote: true, todayGranularity: 'amPm' };

export async function loadListDisplayPreferences(): Promise<ListDisplayPreferences> {
  const raw = await AsyncStorage.getItem(LIST_DISPLAY_KEY); if (!raw) return DEFAULT_LIST_DISPLAY_PREFERENCES;
  try { const value = JSON.parse(raw) as { visibleGroupIds?: unknown; showPinnedNote?: unknown; todayGranularity?: unknown }; const validIds = new Set(allDeadlineGroupIds()); const visibleGroupIds = Array.isArray(value.visibleGroupIds) ? value.visibleGroupIds.filter((id): id is DeadlineGroupKey => typeof id === 'string' && validIds.has(id as DeadlineGroupKey)) : DEFAULT_LIST_DISPLAY_PREFERENCES.visibleGroupIds; const validGranularities = new Set(TODAY_GRANULARITIES.map((item) => item.id)); return { visibleGroupIds, showPinnedNote: typeof value.showPinnedNote === 'boolean' ? value.showPinnedNote : true, todayGranularity: validGranularities.has(value.todayGranularity as TodayGranularity) ? value.todayGranularity as TodayGranularity : 'amPm' }; } catch { return DEFAULT_LIST_DISPLAY_PREFERENCES; }
}

export async function saveListDisplayPreferences(value: ListDisplayPreferences) { await AsyncStorage.setItem(LIST_DISPLAY_KEY, JSON.stringify(value)); }
