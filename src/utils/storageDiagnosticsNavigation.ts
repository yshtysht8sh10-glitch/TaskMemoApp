/** Navigate the current PWA browsing context; never open a new tab or Safari window. */
export function navigateToStorageDiagnostics(location: Pick<Location, 'assign'>, buildCommit: string) {
  const revision = /^[0-9a-f]{40}$/.test(buildCommit) ? buildCommit : 'unknown';
  location.assign(`/storage-diagnostics?build=${revision}`);
}
