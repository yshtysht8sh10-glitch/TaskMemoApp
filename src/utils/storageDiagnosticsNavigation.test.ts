import { expect, it, vi } from 'vitest';
import { navigateToStorageDiagnostics } from './storageDiagnosticsNavigation';

it('navigates the current location to the same-origin diagnostic page', () => {
  const assign = vi.fn();
  navigateToStorageDiagnostics({ assign }, '57ffc43012fb3cdf0757096176dc0ea9ad588ec7');
  expect(assign).toHaveBeenCalledExactlyOnceWith('/storage-diagnostics?build=57ffc43012fb3cdf0757096176dc0ea9ad588ec7');
});

it('does not insert an untrusted build string into the diagnostic URL', () => {
  const assign = vi.fn();
  navigateToStorageDiagnostics({ assign }, 'invalid?redirect=external');
  expect(assign).toHaveBeenCalledExactlyOnceWith('/storage-diagnostics?build=unknown');
});
