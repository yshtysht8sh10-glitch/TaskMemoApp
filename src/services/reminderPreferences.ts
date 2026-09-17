import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_REMINDER_PREFERENCES, type ReminderPreferences } from '@/domain/reminders';

const KEY = '@taskmemo/settings/reminders/v1';

export async function loadReminderPreferences(): Promise<ReminderPreferences> {
  const raw = await AsyncStorage.getItem(KEY); if (!raw) return DEFAULT_REMINDER_PREFERENCES;
  try { const value = JSON.parse(raw) as Partial<ReminderPreferences>; return { enabled: value.enabled === true, sameDay: value.sameDay !== false, dayBefore: value.dayBefore !== false }; } catch { return DEFAULT_REMINDER_PREFERENCES; }
}

export async function saveReminderPreferences(value: ReminderPreferences) { await AsyncStorage.setItem(KEY, JSON.stringify(value)); }
