import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { IndexedDbTaskMemoApplicationJournal } from '../sync/indexedDbApplicationStorage';
import { claimNativeScopeWriter, TaskMemoV2ApplicationJournal } from '../sync/applicationStorage';
import { migrateLocalApplication } from '../sync/localApplication';
import { localScope } from '../sync/ownership';
import type { ApplicationJournalPersistence } from '../sync/applicationStore';
import type { TaskMemoV2ApplicationStore } from '../sync/taskMemoApplicationStore';

/** One common writer per JS process. Native multi-process writers are unsupported. */
const applications = new Map<string, Promise<{ scope: string; store: TaskMemoV2ApplicationStore }>>();
const nativePersistence = new Map<string, TaskMemoV2ApplicationJournal>();
async function persistence(scope: string) {
  if (Platform.OS !== 'web') {
    let adapter = nativePersistence.get(scope);
    if (!adapter) { adapter = new TaskMemoV2ApplicationJournal(scope, claimNativeScopeWriter(scope).token); nativePersistence.set(scope, adapter); }
    return adapter;
  }
  try { return await IndexedDbTaskMemoApplicationJournal.open(scope); }
  catch (error) {
    // Concurrent first-open add may lose to another tab. Reopen, never replace it.
    if (error instanceof Error && error.name === 'ConstraintError') return IndexedDbTaskMemoApplicationJournal.open(scope);
    throw error;
  }
}
export function openCommonLocalApplication(environment: string, profile: { body: string; ideasEnabled: boolean }) {
  let opening = applications.get(environment);
  if (!opening) {
    opening = open(environment, profile).catch(error => { applications.delete(environment); throw error; });
    applications.set(environment, opening);
  }
  return opening;
}
async function open(environment: string, profile: { body: string; ideasEnabled: boolean }) {
  const registry = await persistence(`local-identity:v2:${environment}`);
  if (await registry.loadJournal()) throw new Error('Local識別子のjournalが不正です。');
  let identityRaw = await registry.loadCommitted();
  if (!identityRaw) {
    const candidate = JSON.stringify({ version: 2, deviceId: randomUUID(), installationId: randomUUID(), localProfileId: randomUUID(),
      domain: {}, history: { past: [], future: [] }, sync: { outbox: [], seenOpIds: [] } });
    try { await registry.writeAtomic!(null, candidate); }
    catch (error) { if (!await registry.loadCommitted()) throw error; }
    identityRaw = await registry.loadCommitted();
  }
  if (!identityRaw) throw new Error('Local識別子を保存できません。');
  const identity = JSON.parse(identityRaw);
  if (![identity.deviceId, identity.installationId, identity.localProfileId].every(v => typeof v === 'string' && v.length)) throw new Error('Local識別子が不正です。');
  const scope = localScope(environment, identity.installationId, identity.localProfileId);
  const target = await persistence(scope);
  const backup = await persistence(`${scope}:v1-backup`);
  const source = await AsyncStorage.getItem('@taskmemo/nodes/v1');
  const committed = await target.loadCommitted();
  const profileKeys = ['@taskmemo/profile/pinned-note/v1', '@taskmemo/settings/features/v1'];
  const rawProfile = Object.fromEntries(await Promise.all(profileKeys.map(async key => [key, await AsyncStorage.getItem(key)])));
  const backupRaw = committed ? await backup.loadCommitted() : null;
  const expectedProfile = committed ? (backupRaw ? JSON.parse(backupRaw).backup?.rawProfile : null) : rawProfile;
  const expectedSource = committed ? JSON.parse(committed).ownership?.migration?.source : source;
  const checkSource = async () => {
    if (await AsyncStorage.getItem('@taskmemo/nodes/v1') !== expectedSource) throw new Error('移行後にV1 local writerが変更しました。原本を保持し保存を停止しました。');
    if (!expectedProfile || profileKeys.some(key => !(key in expectedProfile))) throw new Error('V1 profile backupを確認できません。原本を保持して停止しました。');
    for (const key of profileKeys) if (await AsyncStorage.getItem(key) !== expectedProfile[key])
      throw new Error('移行後にV1 profile writerが変更しました。原本を保持し保存を停止しました。');
  };
  await checkSource();
  const guarded: ApplicationJournalPersistence = {
    loadCommitted: () => target.loadCommitted(), loadJournal: () => target.loadJournal(),
    writeCommitted: () => { throw new Error('Local writerはatomic保存のみです。'); },
    writeJournal: () => { throw new Error('Local writerはjournalを書きません。'); },
    clearJournal: () => target.clearJournal(),
    writeAtomic: async (expected, value) => { await checkSource(); await target.writeAtomic!(expected, value); },
  };
  const store = await migrateLocalApplication(guarded, { scope, deviceId: identity.deviceId, source, profile, backup, rawProfile });
  await checkSource();
  return { scope, store };
}
