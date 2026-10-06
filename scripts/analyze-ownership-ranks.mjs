// Offline, read-only analysis. Never load Firebase or write the source archive.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const scalar = value => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null;
const metadata = node => Object.fromEntries(['id', 'type', 'kind', 'parentId', 'sortKey', 'rank', 'deletedAt', 'purgedAt', 'status'].map(key => [key, scalar(node?.[key])]));
const active = node => !node.deletedAt && !node.purgedAt;
const siblingsKey = node => JSON.stringify([node.parentId ?? null, node.sortKey]);

export function analyzeOwnershipRanks(archive) {
  if (archive?.format !== 'taskmemo-v2-recovery-v2') throw new Error('Expected a taskmemo-v2-recovery-v2 archive.');
  const containers = [];
  const add = (scope, origin, raw) => {
    if (raw == null) return;
    const envelope = JSON.parse(raw);
    if (envelope.version !== 2 || !envelope.domain || Array.isArray(envelope.domain)) throw new Error('Invalid V2 envelope; no recovery was attempted.');
    const nodes = Object.values(envelope.domain).map(record => metadata(record?.value));
    const groups = new Map();
    for (const node of nodes.filter(active)) {
      const key = siblingsKey(node);
      groups.set(key, [...(groups.get(key) ?? []), node]);
    }
    containers.push({ scope, origin, nodes, duplicateActiveSiblings: [...groups.values()].filter(group => group.length > 1) });
  };
  for (const record of archive.indexedDb?.records ?? []) {
    add(scalar(record.scope), 'indexeddb-committed', record.committed);
    add(scalar(record.scope), 'indexeddb-journal', record.journal);
  }
  for (const entry of archive.entries ?? []) {
    for (const [prefix, origin] of [
      ['@taskmemo/sync-v2/taskmemo-application/v2/', 'localstorage-committed'],
      ['@taskmemo/sync-v2/taskmemo-application-journal/v2/', 'localstorage-journal'],
    ]) if (typeof entry.key === 'string' && entry.key.startsWith(prefix)) add(entry.key.slice(prefix.length), origin, entry.value);
  }
  // Potential cross-scope collisions, not a prediction of the user's selected plan.
  const crossScopeCollisions = [];
  for (let i = 0; i < containers.length; i++) for (let j = i + 1; j < containers.length; j++) {
    const a = containers[i], b = containers[j];
    if (a.scope === b.scope || !a.origin.endsWith('committed') || !b.origin.endsWith('committed')) continue;
    for (const left of a.nodes.filter(active)) for (const right of b.nodes.filter(active)) {
      if (left.id !== right.id && siblingsKey(left) === siblingsKey(right)) crossScopeCollisions.push({
        leftScope: a.scope, leftOrigin: a.origin, left,
        rightScope: b.scope, rightOrigin: b.origin, right,
      });
    }
  }
  return { diagnosticVersion: 1, readOnly: true, archiveOrigin: scalar(archive.origin),
    archiveBuild: scalar(archive.appCommit), containers, crossScopeCollisions,
    warning: 'Cross-scope collisions are candidates only. Verify the target UID and selected ownership plan before classifying or changing anything.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/analyze-ownership-ranks.mjs <private-backup.json>');
    console.log(JSON.stringify(analyzeOwnershipRanks(JSON.parse(readFileSync(process.argv[2], 'utf8'))), null, 2));
  } catch {
    console.error('Rank analysis failed. Check the archive format/path. The source was not modified.');
    process.exitCode = 1;
  }
}
