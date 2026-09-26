import { expect, it, vi } from 'vitest';
import { navigateToStorageDiagnostics } from './storageDiagnosticsNavigation';

it('navigates the current location to the same-origin diagnostic page', () => {
  const assign = vi.fn();
  navigateToStorageDiagnostics({ assign });
  expect(assign).toHaveBeenCalledExactlyOnceWith('/storage-diagnostics.html');
});
