import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { decodeFirestoreFields } from './lib/readOnlyFirestoreSnapshot.mjs';

const [bundlePath, cloudPath] = process.argv.slice(2);
if (!bundlePath || !cloudPath) throw new Error('Usage: node scripts/compare-recovery-sources.mjs <bundle> <cloud>');
const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
const cloud = JSON.parse(readFileSync(cloudPath, 'utf8'));
const legacyEntry = bundle.entries.find(entry => entry.key.startsWith('@taskmemo/sync-v2/taskmemo-application/v2/'));
const journalEntry = bundle.entries.find(entry => entry.key.startsWith('@taskmemo/sync-v2/taskmemo-application-journal/v2/'));
const legacy = JSON.parse(legacyEntry.value);
const current = JSON.parse(bundle.indexedDb.records[0].committed);
const remote = Object.fromEntries(cloud.nodes.map(document => {
  const fields = decodeFirestoreFields(document.fields ?? {});
  const record = fields.record;
  return [record.value.id, record];
}));
const digest = raw => createHash('sha256').update(raw).digest('hex');
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const compare = (a, b) => {
  const onlyA = [], onlyB = [], same = [], valueDiff = [], metadataDiff = [];
  for (const [id, record] of Object.entries(a)) {
    if (!b[id]) { onlyA.push(id); continue; }
    if (canonical(record) === canonical(b[id])) same.push(id);
    else if (canonical(record.value) === canonical(b[id].value)) metadataDiff.push(id);
    else valueDiff.push({ id, aRevision: record.revision, bRevision: b[id].revision,
      aUpdatedAt: record.value?.updatedAt ?? null, bUpdatedAt: b[id].value?.updatedAt ?? null,
      aLastOpId: record.lastOpId, bLastOpId: b[id].lastOpId,
      aValueHash: digest(canonical(record.value)), bValueHash: digest(canonical(b[id].value)) });
  }
  for (const id of Object.keys(b)) if (!a[id]) onlyB.push(id);
  return { onlyA, onlyB, sameCount: same.length, metadataDiff, valueDiff };
};
const currentFingerprint = digest(JSON.stringify([legacyEntry.value, journalEntry?.value ?? null]));
const stored = bundle.indexedDb.records[0];
console.log(JSON.stringify({ fingerprint: { stored: stored.legacyFingerprint, current: currentFingerprint,
  matches: stored.legacyFingerprint === currentFingerprint },
  legacyVsCurrent: compare(legacy.domain, current.domain),
  legacyVsCloud: compare(legacy.domain, remote),
  currentVsCloud: compare(current.domain, remote),
  envelopeChanges: Object.keys(legacy).filter(key => canonical(legacy[key]) !== canonical(current[key])),
  cloudSchemaVersions: [...new Set(cloud.nodes.map(document => decodeFirestoreFields(document.fields ?? {}).schemaVersion))],
}, null, 2));
