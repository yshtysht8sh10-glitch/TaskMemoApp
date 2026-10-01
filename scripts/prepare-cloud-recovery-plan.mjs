// Offline plan construction. Never writes Firebase or browser storage.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { decodeFirestoreFields } from './lib/readOnlyFirestoreSnapshot.mjs';
import { assertCloudDominates } from './lib/recoverySourceSafety.mjs';

const [bundlePath, cloudPath, outputPath] = process.argv.slice(2);
if (!bundlePath || !cloudPath || !outputPath) throw new Error('Usage: node scripts/prepare-cloud-recovery-plan.mjs <bundle> <cloud> <new-plan>');
const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
const cloud = JSON.parse(readFileSync(cloudPath, 'utf8'));
const [stored] = bundle.indexedDb.records;
if (bundle.indexedDb.records.length !== 1 || stored.journal !== null || !stored.committed || cloud.scope !== stored.scope)
  throw new Error('Scope, IndexedDB application, or journal precondition failed');
const legacyEntry = bundle.entries.find(entry => entry.key === `@taskmemo/sync-v2/taskmemo-application/v2/${encodeURIComponent(stored.scope)}`);
const journalEntry = bundle.entries.find(entry => entry.key === `@taskmemo/sync-v2/taskmemo-application-journal/v2/${encodeURIComponent(stored.scope)}`);
if (!legacyEntry || journalEntry) throw new Error('Legacy source precondition failed');
const legacy = JSON.parse(legacyEntry.value);
const current = JSON.parse(stored.committed);
if (current.version !== 2 || legacy.version !== 2 || current.sync.outbox.length || legacy.sync.outbox.length)
  throw new Error('Pending outbox or schema mismatch');
const remote = Object.fromEntries(cloud.nodes.map(document => {
  const fields = decodeFirestoreFields(document.fields ?? {});
  if (fields.schemaVersion !== 2 || !fields.record?.value?.id) throw new Error('Cloud schema mismatch');
  return [fields.record.value.id, fields.record];
}));
if (Object.keys(remote).length !== cloud.nodes.length || !cloud.nodes.length) throw new Error('Cloud Node ID collision or empty');
assertCloudDominates([legacy.domain, current.domain], remote);
const cloudProfile = Object.fromEntries(cloud.profile.map(document => {
  const fields = decodeFirestoreFields(document.fields ?? {});
  if (fields.schemaVersion !== 2) throw new Error('Cloud profile schema mismatch');
  return [document.name.split('/').at(-1), fields.record];
}));
if (current.profile.pinnedNote.dirtySince || current.profile.pinnedNote.migrationPending || current.profile.features.migrationPending ||
    current.profile.pinnedNote.synced?.revision !== cloudProfile.pinnedNote?.revision ||
    current.profile.features.synced?.revision !== cloudProfile.features?.revision)
  throw new Error('Profile mismatch requires manual review');
const recovered = { ...current, domain: remote, history: { past: [], future: [] },
  sync: { ...current.sync, outbox: [] } };
const sha256 = raw => createHash('sha256').update(raw).digest('hex');
const plan = { format: 'taskmemo-cloud-recovery-plan-v1', createdAt: new Date().toISOString(),
  scope: stored.scope, cloudCaptureSha256: sha256(readFileSync(cloudPath)),
  expected: { committedSha256: sha256(stored.committed), journal: null,
    legacyCommittedSha256: sha256(legacyEntry.value), legacyJournal: null,
    legacyFingerprint: stored.legacyFingerprint },
  newLegacyFingerprint: sha256(JSON.stringify([legacyEntry.value, null])),
  nodeCount: cloud.nodes.length, recoveredCommitted: JSON.stringify(recovered) };
writeFileSync(outputPath, JSON.stringify(plan, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ output: outputPath, nodeCount: plan.nodeCount, planSha256: sha256(JSON.stringify(plan)) }));
