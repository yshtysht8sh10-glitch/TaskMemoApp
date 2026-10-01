// Offline, read-only inspection of a previously downloaded recovery bundle.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/inspect-recovery-bundle.mjs <downloaded-json> [output-directory]');
const archive = JSON.parse(readFileSync(source, 'utf8'));
if (archive.format !== 'taskmemo-v2-recovery-v2' || !Array.isArray(archive.entries) || !Array.isArray(archive.indexedDb?.records))
  throw new Error('Unexpected recovery bundle format');
const output = process.argv[3];
if (output) mkdirSync(output, { recursive: true });
const stamp = archive.capturedAt.replace(/[:.]/g, '-');
const hash = value => createHash('sha256').update(value).digest('hex');
const write = (kind, payload) => {
  if (!output) return;
  const file = join(output, `taskmemo-recovery-${kind}-${stamp}.json`);
  writeFileSync(file, JSON.stringify({ format: 'taskmemo-recovery-source-v1', source: kind,
    capturedAt: archive.capturedAt, origin: archive.origin, payload }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ backup: file }));
};
const summary = (kind, raw) => {
  if (!raw) return { kind, present: false };
  const parsed = JSON.parse(raw);
  const domain = parsed.domain && typeof parsed.domain === 'object' ? parsed.domain : null;
  const values = domain ? Object.values(domain).map(record => record?.value ?? record) : Array.isArray(parsed) ? parsed : [];
  const ids = values.map(value => value?.id).filter(id => typeof id === 'string').sort();
  const roots = values.filter(value => !value?.parentId).length;
  const latestUpdatedAt = values.map(value => value?.updatedAt).filter(value => typeof value === 'string').sort().at(-1) ?? null;
  return { kind, present: true, version: parsed.version ?? 'v1-array', count: values.length,
    roots, children: values.length - roots, idSetHash: hash(JSON.stringify(ids)),
    contentHash: hash(raw), latestUpdatedAt, outbox: parsed.sync?.outbox?.length ?? null,
    deleted: values.filter(value => value?.deletedAt || value?.purgedAt).length };
};
const v1 = archive.entries.find(entry => entry.key === '@taskmemo/nodes/v1');
const legacy = archive.entries.filter(entry => entry.key.startsWith('@taskmemo/sync-v2/taskmemo-application/v2/'));
const legacyJournal = archive.entries.filter(entry => entry.key.startsWith('@taskmemo/sync-v2/taskmemo-application-journal/v2/'));
if (v1) write('v1', { key: v1.key, value: v1.value });
if (legacy.length || legacyJournal.length) write('legacy-v2', { entries: [...legacy, ...legacyJournal] });
console.log(JSON.stringify(summary('v1', v1?.value)));
for (const entry of legacy) console.log(JSON.stringify(summary('legacy-v2', entry.value)));
for (const entry of legacyJournal) console.log(JSON.stringify(summary('legacy-journal', entry.value)));
for (const record of archive.indexedDb.records) {
  write('indexeddb-v2', record);
  console.log(JSON.stringify(summary('indexeddb-v2', record.committed)));
  console.log(JSON.stringify(summary('indexeddb-journal', record.journal)));
  const preserved = Object.fromEntries(Object.entries(record).filter(([key]) => key.startsWith('preserved') || key.includes('RecoveryPlan')));
  if (Object.keys(preserved).length) write('migration-backup', preserved);
  console.log(JSON.stringify({ kind: 'indexeddb-metadata', legacyFingerprint: record.legacyFingerprint,
    recoveryCompleted: record.recoveryCompleted ?? false, localRecoveryMode: record.localRecoveryMode ?? false,
    preservedFields: Object.keys(preserved), selfRepairCompletedAt: record.selfRepairCompletedAt ?? null }));
}
