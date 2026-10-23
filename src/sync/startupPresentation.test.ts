import { expect, it } from 'vitest';
import { startupPresentation } from './startupPresentation';
const account = { preferencesReady: true, authReady: true, applicationState: 'ready' as const, account: true,
  snapshotSource: 'checking' as const, status: 'synced', elapsed: false, cacheEditing: false };
it('hides pre-auth Local and pre-load empty data even when a controller says synced', () => {
  expect(startupPresentation({ ...account, authReady: false, account: false }).showData).toBe(false);
  expect(startupPresentation({ ...account, applicationState: 'opening' }).showData).toBe(false);
  expect(startupPresentation(account).showData).toBe(false);
});
it('bounds the cloud wait with an explicitly unverified read-only fallback; local-only and applied server data are usable', () => {
  expect(startupPresentation({ ...account, elapsed: true })).toMatchObject({ showData: true, editable: false, canUseCache: true });
  expect(startupPresentation({ ...account, elapsed: true, cacheEditing: true }).editable).toBe(true);
  expect(startupPresentation({ ...account, account: false }).editable).toBe(true);
  expect(startupPresentation({ ...account, snapshotSource: 'server' }).editable).toBe(true);
  expect(startupPresentation({ ...account, snapshotSource: 'server', applicationState: 'error' }).showData).toBe(false);
});
