import AsyncStorage from '@react-native-async-storage/async-storage';
import { allDeadlineGroupIds, TODAY_GRANULARITIES, type DeadlineGroupKey, type TodayGranularity } from '../domain/deadlineView';

const LIST_DISPLAY_KEY = '@taskmemo/view/list-display/v1';
const TREE_DISPLAY_KEY = '@taskmemo/view/tree-display/v1';
export const PINNED_NOTE_HEIGHT_MIN = 72; export const PINNED_NOTE_HEIGHT_MAX = 280; export const PINNED_NOTE_HEIGHT_DEFAULT = 110;
export const clampPinnedNoteHeight = (height: number) => Math.max(PINNED_NOTE_HEIGHT_MIN, Math.min(PINNED_NOTE_HEIGHT_MAX, height));
export type ListDisplayPreferences = { visibleGroupIds: DeadlineGroupKey[]; showPinnedNote: boolean; todayGranularity: TodayGranularity; pinnedNoteHeight: number };
export const DEFAULT_LIST_DISPLAY_PREFERENCES: ListDisplayPreferences = { visibleGroupIds: allDeadlineGroupIds(), showPinnedNote: true, todayGranularity: 'amPm', pinnedNoteHeight: PINNED_NOTE_HEIGHT_DEFAULT };
const legacyDefaults = (): ListDisplayPreferences => ({ ...DEFAULT_LIST_DISPLAY_PREFERENCES,
  visibleGroupIds: allDeadlineGroupIds().filter(id => id !== 'nextMonth' && id !== 'nextYear') });

// Read evidence only. Do not open/create a database or mutate migration state.
async function hasExistingInstallation() {
  try {
    if (typeof AsyncStorage.getAllKeys !== 'function') return true;
    const keys = await AsyncStorage.getAllKeys();
    if (keys.some(key => key.startsWith('@taskmemo/'))) return true;
    if (typeof indexedDB !== 'undefined') {
      if (typeof indexedDB.databases !== 'function') return true;
      if ((await indexedDB.databases()).some(db => db.name === 'taskmemo-v2-local-application')) return true;
    }
    return false;
  } catch { return true; }
}

export async function loadListDisplayPreferences(): Promise<ListDisplayPreferences> {
  const raw = await AsyncStorage.getItem(LIST_DISPLAY_KEY);
  if (!raw) {
    const existing = await hasExistingInstallation();
    const defaults = existing ? legacyDefaults() : DEFAULT_LIST_DISPLAY_PREFERENCES;
    // Recheck after asynchronous observation: a backup/settings write wins.
    if (await AsyncStorage.getItem(LIST_DISPLAY_KEY)) return loadListDisplayPreferences();
    await AsyncStorage.setItem(LIST_DISPLAY_KEY, JSON.stringify({ ...defaults,
      ...(!existing ? { initialDefaultsAt: new Date().toISOString() } : {}) }));
    return defaults;
  }
  try { const value = JSON.parse(raw) as { visibleGroupIds?: unknown; showPinnedNote?: unknown; todayGranularity?: unknown; pinnedNoteHeight?: unknown }; const validIds = new Set(allDeadlineGroupIds()); const visibleGroupIds = Array.isArray(value.visibleGroupIds) ? value.visibleGroupIds.filter((id): id is DeadlineGroupKey => typeof id === 'string' && validIds.has(id as DeadlineGroupKey)) : legacyDefaults().visibleGroupIds; const validGranularities = new Set(TODAY_GRANULARITIES.map((item) => item.id)); const storedHeight = typeof value.pinnedNoteHeight === 'number' ? value.pinnedNoteHeight : PINNED_NOTE_HEIGHT_DEFAULT; return { visibleGroupIds, showPinnedNote: typeof value.showPinnedNote === 'boolean' ? value.showPinnedNote : true, todayGranularity: validGranularities.has(value.todayGranularity as TodayGranularity) ? value.todayGranularity as TodayGranularity : 'amPm', pinnedNoteHeight: clampPinnedNoteHeight(storedHeight) }; } catch { return legacyDefaults(); }
}

/** A fresh installation may later sign into an older account. Explicit/backup
 * settings have no provenance marker and must always win over this one-time adjustment. */
export async function reconcileListDisplayAccount(createdAt: string | undefined) {
  const raw = await AsyncStorage.getItem(LIST_DISPLAY_KEY);
  if (!raw) return null;
  let value: Record<string, unknown>;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object' || typeof value.initialDefaultsAt !== 'string') return null;
  const created = Date.parse(createdAt ?? ''), initialized = Date.parse(value.initialDefaultsAt);
  // Auth creationTime may have only second precision. Do not classify an
  // account registered during the initialization second as an older account.
  if (Number.isFinite(created) && Math.floor(created / 1000) >= Math.floor(initialized / 1000)) return null;
  const current = await loadListDisplayPreferences();
  const result = { ...current, visibleGroupIds: current.visibleGroupIds.filter(id => id !== 'nextMonth' && id !== 'nextYear') };
  await saveListDisplayPreferences(result);
  return result;
}

export async function saveListDisplayPreferences(value: ListDisplayPreferences) { await AsyncStorage.setItem(LIST_DISPLAY_KEY, JSON.stringify(value)); }

export type TreeDisplayPreferences = { showCompletedMemos: boolean };
export const DEFAULT_TREE_DISPLAY_PREFERENCES: TreeDisplayPreferences = { showCompletedMemos: false };

export function parseTreeDisplayPreferences(raw: string | null): TreeDisplayPreferences {
  if (!raw) return DEFAULT_TREE_DISPLAY_PREFERENCES;
  try {
    const value = JSON.parse(raw) as { showCompletedMemos?: unknown };
    return { showCompletedMemos: typeof value.showCompletedMemos === 'boolean' ? value.showCompletedMemos : false };
  } catch {
    return DEFAULT_TREE_DISPLAY_PREFERENCES;
  }
}

export async function loadTreeDisplayPreferences() {
  return parseTreeDisplayPreferences(await AsyncStorage.getItem(TREE_DISPLAY_KEY));
}

export async function saveTreeDisplayPreferences(value: TreeDisplayPreferences) {
  await AsyncStorage.setItem(TREE_DISPLAY_KEY, JSON.stringify(value));
}
