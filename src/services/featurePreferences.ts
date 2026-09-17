import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@taskmemo/settings/features/v1";
export type FeaturePreferences = { ideasEnabled: boolean };
export const DEFAULT_FEATURE_PREFERENCES: FeaturePreferences = {
  ideasEnabled: false,
};

export async function loadFeaturePreferences(): Promise<FeaturePreferences> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return DEFAULT_FEATURE_PREFERENCES;
  try {
    const value = JSON.parse(raw) as Partial<FeaturePreferences>;
    return { ideasEnabled: value.ideasEnabled === true };
  } catch {
    return DEFAULT_FEATURE_PREFERENCES;
  }
}

export async function saveFeaturePreferences(value: FeaturePreferences) {
  await AsyncStorage.setItem(KEY, JSON.stringify(value));
}
