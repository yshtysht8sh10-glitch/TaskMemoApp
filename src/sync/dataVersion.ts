export type DataVersion = 2 | 3;
export function dataVersion(value: unknown): DataVersion {
  if (value === undefined || value === 2) return 2;
  if (value === 3) return 3;
  throw new Error('対応していないデータVerです。原本を保持して読込み・書込みを停止しました。');
}
export function versionedScope(scope: string, version: DataVersion) { return version === 3 ? `${scope}/data-v3` : scope; }
/** Explicit one-time local copy. Caller must also confirm all devices/tabs quiescent. */
export function prepareVersion3Copy(raw: string, journal: string | null): string {
  const e = JSON.parse(raw);
  if (dataVersion(e.dataVersion) !== 2 || journal !== null || e.version !== 2 || !Array.isArray(e.sync?.outbox) || e.sync.outbox.length ||
    e.profile?.pinnedNote?.dirtySince || e.ownershipTransaction || e.ownershipRecoverySeed)
    throw new Error('未同期・復旧中のデータがあります。元データを保持して切替を停止しました。');
  return JSON.stringify({ ...e, dataVersion: 3 });
}
export function assertVersion3Baseline(raw: string, baseline: { nodes: import('./types').VersionedNode[]; pinnedNote?: import('./types').VersionedPinnedNote; features?: import('./types').VersionedFeatures }) {
  const e = JSON.parse(raw);
  const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  if (canonical(e.domain) !== canonical(Object.fromEntries(baseline.nodes.map(record => [record.value.id, record]))) ||
    canonical(e.profile?.pinnedNote?.synced ?? null) !== canonical(baseline.pinnedNote ?? null) ||
    canonical(e.profile?.features?.synced ?? null) !== canonical(baseline.features ?? null))
    throw new Error('端末とCloudの保存済みデータが一致しません。原本を保持し切替を停止しました。');
}
