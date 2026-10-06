import AsyncStorage from '@react-native-async-storage/async-storage';

/** Recovery export only: no Domain initialization, decoding, repair or writes. */
export async function readLegacyMigrationSource() {
  const keys = ['@taskmemo/nodes/v1', '@taskmemo/profile/pinned-note/v1', '@taskmemo/settings/features/v1'];
  const entries = await Promise.all(keys.map(async key => ({ key, value: await AsyncStorage.getItem(key) })));
  for (const entry of entries) if (await AsyncStorage.getItem(entry.key) !== entry.value)
    throw new Error('読取中にV1原本が変わりました。再度書き出してください。');
  return JSON.stringify({ kind: 'taskmemo-v1-migration-source', version: 1, entries }, null, 2);
}
