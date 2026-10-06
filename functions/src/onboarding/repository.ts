import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { decide, GATE, GATE_FINGERPRINT, OnboardingBlocked, type DecisionInput } from './decision.js';

export const INVENTORY = ['nodes', 'nodesV2', 'profileV2', 'syncOperationsV2', 'externalAiRequestsV2', 'externalAiAuditLogs', 'syncMetadataV2'] as const;
const data = (snapshot: { exists: boolean; data(): Record<string, unknown> | undefined }) => snapshot.exists ? snapshot.data()! : null;
const normalize = (value: Record<string, unknown> | null) => value && Object.fromEntries(Object.entries(value).map(([k, v]) => [k, v instanceof Timestamp ? v.toMillis() : v]));
export async function provisionAccount(db: Firestore, identity: Pick<DecisionInput, 'uid' | 'projectId' | 'authCreatedAt' | 'provider'>,
  options: { beforeCreate?: () => void } = {}) {
  if (!['taskmemoapp-dev', 'taskmemoapp-eabc3', 'demo-taskmemo-onboarding'].includes(identity.projectId) || !identity.uid || identity.uid.includes('/')) throw new OnboardingBlocked('project-invalid');
  const user = db.doc(`users/${identity.uid}`), gate = user.collection('syncMetadataV2').doc('compatibility');
  const receipt = db.doc(`accountProvisioningV2/${identity.uid}`), lifecycle = db.doc(`accountLifecycleV2/${identity.uid}`);
  // Unknown collection discovery is guarded by the required writer-fence policy.
  const collections = await user.listCollections();
  const unknown = collections.some(c => !(INVENTORY as readonly string[]).includes(c.id));
  const observedAt = Timestamp.now();
  return db.runTransaction(async tx => {
    const [global, policy, existing, previous, fence, parent] = await tx.getAll(db.doc('syncControl/current'), db.doc('syncControl/onboarding'), gate, receipt, lifecycle, user);
    const snapshots = await Promise.all(INVENTORY.map(name => tx.get(user.collection(name).limit(1))));
    const result = decide({ ...identity, global: data(global), policy: normalize(data(policy)), gate: data(existing),
      receipt: normalize(data(previous)), lifecycle: data(fence), nonempty: parent.exists || unknown || snapshots.some(s => !s.empty) });
    if (result === 'existing') return 'existing' as const;
    options.beforeCreate?.(); // injected deterministic atomic-failure regression seam, never external I/O
    tx.create(gate, GATE);
    tx.create(receipt, { schemaVersion: 1, projectId: identity.projectId, databaseId: '(default)', tenantId: null,
      uid: identity.uid, authCreatedAt: identity.authCreatedAt, protocol: 2, policyVersion: policy.data()!.policyVersion,
      provisionedAt: observedAt, gateFingerprint: GATE_FINGERPRINT });
    tx.create(lifecycle, { schemaVersion: 1, state: 'onboarded', authCreatedAt: identity.authCreatedAt, generation: 1 });
    return 'created' as const;
  });
}
