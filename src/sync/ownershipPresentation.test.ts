import { describe, expect, it } from 'vitest';
import { ownershipPresentation } from './ownershipPresentation';

describe('ownership readiness is separate from sync failure', () => {
  it('hides unverified reconciliation while checking or unavailable', () => {
    for (const assessment of ['checking', 'unavailable'] as const)
      expect(ownershipPresentation(assessment, null, 1, 'error')).toEqual({ count: 0, recovery: false, status: 'error' });
  });
  it('shows verified review and import as distinct states', () => {
    expect(ownershipPresentation('ready', null, 1, 'synced')).toEqual({ count: 1, recovery: false, status: 'ownership-review' });
    expect(ownershipPresentation('ready', 'uploading', 1, 'pending')).toEqual({ count: 0, recovery: false, status: 'ownership-importing' });
    expect(ownershipPresentation('ready', 'conflict', 1, 'synced')).toEqual({ count: 1, recovery: true, status: 'ownership-review' });
  });
  it('never hides actual transport errors or exposes review during automatic upload', () => {
    expect(ownershipPresentation('ready', 'uploading', 1, 'error')).toEqual({ count: 0, recovery: false, status: 'error' });
    expect(ownershipPresentation('unavailable', 'conflict', 1, 'retrying')).toEqual({ count: 1, recovery: true, status: 'retrying' });
    expect(ownershipPresentation('ready', null, 0, 'synced').status).toBe('synced');
  });
});
