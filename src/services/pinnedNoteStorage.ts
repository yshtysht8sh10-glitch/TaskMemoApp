import AsyncStorage from '@react-native-async-storage/async-storage';

const PINNED_NOTE_KEY = '@taskmemo/profile/pinned-note/v1';

export type PinnedNote = { body: string; updatedAt: Date };

export async function loadPinnedNote(): Promise<PinnedNote> {
  const raw = await AsyncStorage.getItem(PINNED_NOTE_KEY);
  if (!raw) return { body: '', updatedAt: new Date(0) };
  try { const value = JSON.parse(raw) as { body?: unknown; updatedAt?: unknown }; return { body: typeof value.body === 'string' ? value.body : '', updatedAt: typeof value.updatedAt === 'string' ? new Date(value.updatedAt) : new Date(0) }; } catch { return { body: '', updatedAt: new Date(0) }; }
}

export async function savePinnedNote(body: string): Promise<PinnedNote> {
  const note = { body, updatedAt: new Date() }; await AsyncStorage.setItem(PINNED_NOTE_KEY, JSON.stringify(note)); return note;
}
