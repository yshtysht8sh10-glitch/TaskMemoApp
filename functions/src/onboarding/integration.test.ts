import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp as adminApp, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getFirestore as adminFirestore, Timestamp } from 'firebase-admin/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { prepareFirebaseAccount } from '../../../src/services/firebaseOnboarding';
import { createFirebaseSyncAdapter } from '../../../src/sync/firebaseSyncAdapter';
import { TaskMemoV2ApplicationStore } from '../../../src/sync/taskMemoApplicationStore';
import { TaskMemoV2SyncController } from '../../../src/sync/taskMemoV2SyncController';
import { provisionAccount } from './repository.js';
import { GATE } from './decision.js';
import { ensureOnboarding } from '../../../src/services/accountOnboarding';

const projectId = 'demo-taskmemo-onboarding';
const enabled = process.env.TASKMEMO_ONBOARDING_E2E === '1';
describe.runIf(enabled)('Auth → callable → gate → Application → V2 receipts', () => {
  const admin = adminApp({ projectId }, 'onboarding-tests'), db = adminFirestore(admin);
  let rules: RulesTestEnvironment;
  const apps: ReturnType<typeof initializeApp>[] = [];
  beforeAll(async () => {
    db.settings({ host: '127.0.0.1:8280', ssl: false });
    rules = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8280 } });
  });
  beforeEach(async () => {
    await rules.clearFirestore();
    await db.doc('syncControl/current').set({ schemaVersion: 1, writesEnabled: true });
    await db.doc('syncControl/onboarding').set({ schemaVersion: 1, enabled: true, protocol: 2, policyVersion: 'test',
      eligibleCreatedAfter: Timestamp.fromMillis(0), writerFenceVersion: 1 });
  });
  afterAll(async () => { await Promise.all(apps.map(deleteApp)); await rules.cleanup(); await deleteAdmin(admin); });
  const register = async () => {
    const app = initializeApp({ projectId, apiKey: 'fake-api-key', appId: 'test' }, `app-${apps.length}`); apps.push(app);
    const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9299', { disableWarnings: true });
    const user = (await createUserWithEmailAndPassword(auth, `new-${Date.now()}-${apps.length}@example.test`, 'testing123')).user;
    const client = getFirestore(app); connectFirestoreEmulator(client, '127.0.0.1', 8280);
    return { app, user, client };
  };
  const identity = (uid: string) => ({ uid, projectId, authCreatedAt: 1000, provider: 'password' });
  it('registers without manual per-user setup, imports once, and restart preserves one History', async () => {
    const { app, user, client } = await register();
    const invoke = () => prepareFirebaseAccount(app, user.uid);
    await Promise.all([invoke(), invoke()]);
    expect((await db.doc(`accountProvisioningV2/${user.uid}`).get()).exists).toBe(true);
    const gate = await db.doc(`users/${user.uid}/syncMetadataV2/compatibility`).get(); expect(gate.data()).toEqual(GATE);
    await invoke(); expect((await db.doc(gate.ref.path).get()).updateTime!.isEqual(gate.updateTime!)).toBe(true);
    let committed: string | null = null;
    const persistence = { loadCommitted: async () => committed, loadJournal: async () => null, writeCommitted: async (v: string) => { committed = v; },
      writeJournal: async () => {}, clearJournal: async () => {}, writeAtomic: async (expected: string | null, v: string) => { if (committed !== expected) throw Error('CAS'); committed = v; } };
    const source = { scope: 'anonymous', nodes: { local: { id: 'local', type: 'category', parentId: null, title: 'Local', sortKey: 'a0',
      createdAt: '2026-10-04T00:00:00.000Z', updatedAt: '2026-10-04T00:00:00.000Z', deletedAt: null } }, profile: { body: '', ideasEnabled: false } };
    const adapter = createFirebaseSyncAdapter(client, user.uid, 'test', { emulator: true, ensureAccountReady: invoke });
    const options = { initialOwnership: { source: () => source, targetScope: user.uid } };
    const store = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: 'account' });
    const sync = new TaskMemoV2SyncController(store, adapter, () => {}, options); await sync.start();
    expect(store.historyDepths.past).toBe(1); expect(store.nodes[0].title).toBe('Local'); sync.stop();
    const restart = new TaskMemoV2SyncController(await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: 'account' }), adapter, () => {}, options);
    await restart.start(); restart.stop(); expect((await adapter.readRecoverySnapshot!()).receiptDocumentCount).toBe(1);
  });
  it('rejects client gate/policy/receipt/lifecycle mutation and ungated V1/V2 writes', async () => {
    const { user, client } = await register();
    for (const path of [`users/${user.uid}/syncMetadataV2/compatibility`, `accountProvisioningV2/${user.uid}`,
      'syncControl/onboarding', `accountLifecycleV2/${user.uid}`, `users/${user.uid}/nodes/old`, `users/${user.uid}/nodesV2/new`]) {
      await assertFails(setDoc(doc(client, path), GATE)); await assertFails(deleteDoc(doc(client, path)));
    }
    const path = `users/${user.uid}/syncMetadataV2/compatibility`;
    await db.doc(path).set(GATE);
    await assertFails(setDoc(doc(client, path), { ...GATE, v1WritesAllowed: true }));
    await assertFails(deleteDoc(doc(client, path)));
    const node = { ownerUid: user.uid, schemaVersion: 2, record: { value: { id: 'proof', type: 'category', parentId: null, sortKey: 'a0', title: 'Proof' },
      revision: 1, lastOpId: 'proof:1', lastDeviceId: 'proof', lastLocalSeq: 1, operationType: 'create' } };
    await assertSucceeds(setDoc(doc(client, `users/${user.uid}/nodesV2/proof`), node));
    await db.doc(path).delete();
    await assertFails(setDoc(doc(client, `users/${user.uid}/nodesV2/proof`), node));
  });
  it('retries a lost callable response without creating another gate or receipt', async () => {
    const { app, user } = await register(); let requests = 0;
    await ensureOnboarding(async () => {
      await prepareFirebaseAccount(app, user.uid);
      if (++requests === 1) throw { code: 'functions/unavailable' };
      return { schemaVersion: 1, state: 'ready', result: 'existing', protocol: 2 };
    }, () => true, async () => {});
    expect(requests).toBe(2);
    expect((await db.collection('accountProvisioningV2').get()).size).toBe(1);
  });
  it('blocks freeze, old Auth, lifecycle recovery and inconsistent receipt', async () => {
    await db.doc('syncControl/current').set({ schemaVersion: 1, writesEnabled: false });
    await expect(provisionAccount(db, identity('frozen'))).rejects.toThrow('maintenance');
    await db.doc('syncControl/current').set({ schemaVersion: 1, writesEnabled: true });
    await db.doc('syncControl/onboarding').update({ eligibleCreatedAfter: Timestamp.fromMillis(2000) });
    await expect(provisionAccount(db, identity('old'))).rejects.toThrow('legacy-account');
    await db.doc('accountLifecycleV2/recover').set({ state: 'migration' });
    await expect(provisionAccount(db, identity('recover'))).rejects.toThrow('recovery-active');
    await db.doc('accountProvisioningV2/inconsistent').set({ uid: 'inconsistent' });
    await expect(provisionAccount(db, identity('inconsistent'))).rejects.toThrow('receipt-inconsistent');
    expect((await db.collection('users').get()).empty).toBe(true);
  });
  it.each(['nodes', 'nodesV2', 'profileV2', 'syncOperationsV2', 'unknown', 'syncMetadataV2'])('rejects nonempty or ambiguous %s without writes', async collection => {
    await db.doc(`users/nonempty/${collection}/existing`).set({ preserved: true });
    await expect(provisionAccount(db, identity('nonempty'))).rejects.toThrow('nonempty-account');
    expect((await db.doc('accountProvisioningV2/nonempty').get()).exists).toBe(false);
  });
  it('does not alter a stopped gate and rolls back an injected transaction failure', async () => {
    await db.doc('users/stopped/syncMetadataV2/compatibility').set({ ...GATE, v2Enabled: false });
    await expect(provisionAccount(db, identity('stopped'))).rejects.toThrow('incompatible-gate');
    await expect(provisionAccount(db, identity('atomic'), { beforeCreate: () => { throw Error('atomic failure'); } })).rejects.toThrow('atomic failure');
    expect((await db.doc('users/atomic/syncMetadataV2/compatibility').get()).exists).toBe(false);
    expect((await db.doc('accountProvisioningV2/atomic').get()).exists).toBe(false);
  });
  it('survives duplicate calls and response loss using the same receipt, but isolates A/B', async () => {
    await Promise.all([provisionAccount(db, identity('A')), provisionAccount(db, identity('A'))]);
    const before = await db.doc('accountProvisioningV2/A').get();
    expect(await provisionAccount(db, identity('A'))).toBe('existing');
    expect((await db.doc('accountProvisioningV2/A').get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
    expect(await provisionAccount(db, identity('B'))).toBe('created');
    await expect(provisionAccount(db, { ...identity('A'), authCreatedAt: 2000 })).rejects.toThrow('receipt-inconsistent');
  });
  it('rejects unauthenticated and old/client-selected UID callable requests', async () => {
    const endpoint = `http://127.0.0.1:5101/${projectId}/asia-northeast1/ensureAccountV2Ready`;
    const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { schemaVersion: 1, protocol: 2 } }) });
    expect(r.status).toBe(401);
    const { user } = await register();
    for (const data of [{ schemaVersion: 1, protocol: 1 }, { schemaVersion: 1, protocol: 2, uid: 'other' }]) {
      const result = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` }, body: JSON.stringify({ data }) });
      expect(result.status).toBe(400);
    }
  });
});
