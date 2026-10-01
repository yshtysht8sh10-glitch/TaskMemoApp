const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

/** A cloud snapshot can replace local state only when it contains every local record at the same or a newer revision. */
export function assertCloudDominates(sources, remote) {
  if (!Object.keys(remote).length) throw new Error('Cloud snapshot is empty');
  for (const source of sources) for (const [id, local] of Object.entries(source)) {
    const cloud = remote[id];
    if (!cloud) throw new Error(`Cloud lacks local Node ${id}`);
    if (!Number.isSafeInteger(cloud.revision) || !Number.isSafeInteger(local.revision))
      throw new Error(`Invalid revision for ${id}`);
    if (cloud.revision < local.revision) throw new Error(`Local revision is newer for ${id}`);
    if (cloud.revision === local.revision && canonical(cloud.value) !== canonical(local.value))
      throw new Error(`Equal revision has conflicting value for ${id}`);
  }
}
