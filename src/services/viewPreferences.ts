import AsyncStorage from '@react-native-async-storage/async-storage';
import { allDeadlineGroupIds, TODAY_GRANULARITIES, type DeadlineGroupKey, type TodayGranularity } from '../domain/deadlineView';

const LIST_DISPLAY_KEY = '@taskmemo/view/list-display/v1';
export const PINNED_NOTE_HEIGHT_MIN = 72; export const PINNED_NOTE_HEIGHT_MAX = 280; export const PINNED_NOTE_HEIGHT_DEFAULT = 110;
export const clampPinnedNoteHeight = (height: number) => Math.max(PINNED_NOTE_HEIGHT_MIN, Math.min(PINNED_NOTE_HEIGHT_MAX, height));
export type ListDisplayPreferences = { visibleGroupIds: DeadlineGroupKey[]; showPinnedNote: boolean; todayGranularity: TodayGranularity; pinnedNoteHeight: number };
export const DEFAULT_LIST_DISPLAY_PREFERENCES: ListDisplayPreferences = { visibleGroupIds: allDeadlineGroupIds(), showPinnedNote: true, todayGranularity: 'amPm', pinnedNoteHeight: PINNED_NOTE_HEIGHT_DEFAULT };

export async function loadListDisplayPreferences(): Promise<ListDisplayPreferences> {
  const raw = await AsyncStorage.getItem(LIST_DISPLAY_KEY); if (!raw) return DEFAULT_LIST_DISPLAY_PREFERENCES;
  try { const value = JSON.parse(raw) as { visibleGroupIds?: unknown; showPinnedNote?: unknown; todayGranularity?: unknown; pinnedNoteHeight?: unknown }; const validIds = new Set(allDeadlineGroupIds()); const visibleGroupIds = Array.isArray(value.visibleGroupIds) ? value.visibleGroupIds.filter((id): id is DeadlineGroupKey => typeof id === 'string' && validIds.has(id as DeadlineGroupKey)) : DEFAULT_LIST_DISPLAY_PREFERENCES.visibleGroupIds; const validGranularities = new Set(TODAY_GRANULARITIES.map((item) => item.id)); const storedHeight = typeof value.pinnedNoteHeight === 'number' ? value.pinnedNoteHeight : PINNED_NOTE_HEIGHT_DEFAULT; return { visibleGroupIds, showPinnedNote: typeof value.showPinnedNote === 'boolean' ? value.showPinnedNote : true, todayGranularity: validGranularities.has(value.todayGranularity as TodayGranularity) ? value.todayGranularity as TodayGranularity : 'amPm', pinnedNoteHeight: clampPinnedNoteHeight(storedHeight) }; } catch { return DEFAULT_LIST_DISPLAY_PREFERENCES; }
}

export async function saveListDisplayPreferences(value: ListDisplayPreferences) { await AsyncStorage.setItem(LIST_DISPLAY_KEY, JSON.stringify(value)); }
