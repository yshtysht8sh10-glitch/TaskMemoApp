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

it('explains when editing becomes available throughout the initial cloud check', () => {
  for (const elapsed of [false, true]) {
    const state = startupPresentation({ ...account, status: 'connecting', elapsed });
    expect(state.message).toContain('クラウドのデータを確認しています。完了すると編集できます。');
    expect(state.editable).toBe(false);
    expect(state.showData).toBe(elapsed);
  }
});

it('does not keep the waiting instruction after error, offline choice, sign-out or server confirmation', () => {
  const waiting = '完了すると編集できます';
  for (const status of ['offline', 'error', 'retrying', 'diagnostic', 'self-repairing', 'ownership-importing', 'local-recovery']) {
    expect(startupPresentation({ ...account, status }).message).not.toContain(waiting);
  }
  expect(startupPresentation({ ...account, account: false }).message).not.toContain(waiting);
  expect(startupPresentation({ ...account, snapshotSource: 'server' }).message).not.toContain(waiting);
  const chosen = startupPresentation({ ...account, elapsed: true, cacheEditing: true });
  expect(chosen.editable).toBe(true);
  expect(chosen.message).not.toContain(waiting);
});
