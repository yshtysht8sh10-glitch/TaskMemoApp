import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFeaturePreferences, saveFeaturePreferences } from './featurePreferences';

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
} }));

describe('Idea feature preference', () => {
  beforeEach(() => storage.clear());
  it('既定はOFFで、ON/OFF設定だけを保存しNodeデータには触れない', async () => { expect(await loadFeaturePreferences()).toEqual({ ideasEnabled: false }); await saveFeaturePreferences({ ideasEnabled: true }); expect(await loadFeaturePreferences()).toEqual({ ideasEnabled: true }); });
});
