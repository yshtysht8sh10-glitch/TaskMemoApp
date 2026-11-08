import type { Baseline, Intent, Observation, Write } from './types';

export const scope = { projectId: 'synthetic-only', uid: 'owner' };
export const resource = { type: 'node' as const, id: 'task' };
export const baseline: Baseline = {
  scope, generation: 'generation-a', seal: 'verified-synthetic-baseline',
  resources: [{ resource, fields: [
    { attribute: 'completion', value: { status: 'active', completedAt: null } },
    { attribute: 'emphasis', value: false }, { attribute: 'body', value: 'original' },
    { attribute: 'title', value: 'title' },
    { attribute: 'placement', value: { parentId: 'queue', sortKey: 'a0', membershipEpoch: 'm1' } },
  ] }],
};
export function observation(attribute: Write['attribute'], heads: string[] = [], target = resource): Observation {
  return { resource: target, attribute, baselineSeal: baseline.seal,
    heads: heads.length ? heads.map(opId => ({ kind: 'operation' as const, opId })) : [{ kind: 'baseline' }] };
}
export function intent(opId: string, write: Write, heads: string[] = [], extra: Partial<Intent> = {}): Intent {
  return { protocol: 'intent-v1', schema: 'phase1', scope, generation: baseline.generation,
    resource, opId, actorId: opId, actorIncarnation: 'boot-1', localSeq: 1,
    commandId: opId, intentKind: write.attribute === 'completion'
      ? (write.value.status === 'active' ? 'set-active' : 'set-completed')
      : `set-${write.attribute}`, writes: [write], observed: [observation(write.attribute, heads)],
    readSet: [], dependencies: [], origin: 'synthetic', createdAt: '2026-11-08T00:00:00.000Z', ...extra };
}
