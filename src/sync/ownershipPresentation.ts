import type { SyncPhase } from './types';

export function ownershipPresentation(assessment: 'checking' | 'ready' | 'unavailable',
  pending: 'uploading' | 'conflict' | null, unreconciledCount: number, phase: SyncPhase) {
  const recovery = pending === 'conflict';
  const count = pending === 'uploading' || (assessment !== 'ready' && !recovery) ? 0 : unreconciledCount;
  const status: SyncPhase | 'ownership-importing' | 'ownership-review' = phase === 'synced' || phase === 'pending'
    ? pending === 'uploading' ? 'ownership-importing' : count || recovery ? 'ownership-review' : phase
    : phase;
  return { count, recovery, status };
}
