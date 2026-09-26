/** Navigate the current PWA browsing context; never open a new tab or Safari window. */
export function navigateToStorageDiagnostics(location: Pick<Location, 'assign'>) {
  location.assign('/storage-diagnostics.html');
}
