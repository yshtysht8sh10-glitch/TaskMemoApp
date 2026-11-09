import { canonical, same } from './canonical';
import type { Attribute, Baseline, Intent, Resource, Write } from './types';

export const resourceKey = (resource: Resource) => canonical(resource);
export const fieldKey = (resource: Resource, attribute: Attribute) => canonical([resource, attribute]);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const iso = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const keys = (v: Record<string, unknown>, expected: string[]) => same(Object.keys(v).sort(), expected.sort());

export function validResource(resource: Resource) {
  return object(resource) && keys(resource, ['type', 'id']) && text(resource.id) &&
    (resource.type === 'node' || ((resource.type === 'pinnedNote' || resource.type === 'features') && resource.id === 'main'));
}
export function validWrite(resource: Resource, write: Write) {
  if (!object(write) || !keys(write, ['attribute', 'value'])) return false;
  if (resource.type === 'features') return write.attribute === 'ideasEnabled' && typeof write.value === 'boolean';
  if (resource.type === 'pinnedNote') return write.attribute === 'body' && typeof write.value === 'string';
  switch (write.attribute) {
    case 'title': case 'body': return typeof write.value === 'string';
    case 'emphasis': return typeof write.value === 'boolean';
    case 'completion': return object(write.value) && keys(write.value, ['status', 'completedAt']) &&
      ((write.value.status === 'active' && write.value.completedAt === null) ||
        (write.value.status === 'completed' && iso(write.value.completedAt)));
    case 'placement': return object(write.value) && keys(write.value, ['parentId', 'sortKey', 'membershipEpoch']) &&
      (write.value.parentId === null || text(write.value.parentId)) && text(write.value.sortKey) &&
      (write.value.membershipEpoch === null || text(write.value.membershipEpoch));
    default: return false;
  }
}
export function validateBaseline(baseline: Baseline) {
  canonical(baseline);
  if (!text(baseline.scope.projectId) || !text(baseline.scope.uid) || !text(baseline.generation) || !text(baseline.seal)) throw Error('Invalid baseline binding');
  const seen = new Set<string>();
  for (const item of baseline.resources) {
    if (!validResource(item.resource) || seen.has(resourceKey(item.resource))) throw Error('Invalid/duplicate baseline resource');
    seen.add(resourceKey(item.resource));
    const fields = new Set<string>();
    for (const field of item.fields) {
      if (!validWrite(item.resource, field) || fields.has(field.attribute)) throw Error('Invalid/duplicate baseline field');
      fields.add(field.attribute);
    }
  }
}
/** Structural validation only; causal references are checked by the reducer. */
export function intentError(baseline: Baseline, intent: Intent): string | undefined {
  try {
    canonical(intent);
    if (intent.protocol !== 'intent-v1' || intent.schema !== 'phase1') return 'unsupported-protocol';
    if (!same(intent.scope, baseline.scope) || intent.generation !== baseline.generation) return 'scope-or-generation';
    if (!validResource(intent.resource) || ![intent.opId, intent.actorId, intent.actorIncarnation, intent.commandId, intent.origin].every(text) ||
      !Number.isSafeInteger(intent.localSeq) || intent.localSeq < 1 || !iso(intent.createdAt)) return 'invalid-identity';
    if (!Array.isArray(intent.writes) || !intent.writes.length || !intent.writes.every(w => validWrite(intent.resource, w))) return 'invalid-write';
    const attrs = intent.writes.map(w => w.attribute);
    if (new Set(attrs).size !== attrs.length) return 'duplicate-write';
    if (!Array.isArray(intent.observed) || intent.observed.length !== attrs.length || !Array.isArray(intent.readSet) || !Array.isArray(intent.dependencies) || !intent.dependencies.every(text)) return 'invalid-observation';
    for (const o of [...intent.observed, ...intent.readSet]) {
      if (!validResource(o.resource) || o.baselineSeal !== baseline.seal || !Array.isArray(o.heads) || !o.heads.length) return 'invalid-observation';
      if (!baseline.resources.some(r => same(r.resource, o.resource) && r.fields.some(w => w.attribute === o.attribute))) return 'missing-baseline-field';
      if (o.heads.some((h: unknown) => !object(h) || !(h.kind === 'baseline' ? keys(h, ['kind']) : h.kind === 'operation' && keys(h, ['kind', 'opId']) && text(h.opId)))) return 'invalid-head';
      if (new Set(o.heads.map(canonical)).size !== o.heads.length) return 'duplicate-head';
    }
    if (attrs.some(a => intent.observed.filter(o => same(o.resource, intent.resource) && o.attribute === a).length !== 1)) return 'write-observation-mismatch';
    if (intent.readSet.some(o => same(o.resource, intent.resource) && attrs.includes(o.attribute))) return 'read-write-overlap';
    if (intent.intentKind === 'resolve') {
      if (intent.observed.some(o => o.heads.length < 2)) return 'resolve-needs-candidates';
    } else if (intent.intentKind !== 'atomic-edit') {
      const w = intent.writes[0];
      const kind = w.attribute === 'completion' ? (w.value.status === 'active' ? 'set-active' : 'set-completed') : `set-${w.attribute}`;
      if (intent.writes.length !== 1 || intent.intentKind !== kind) return 'intent-kind-mismatch';
    }
    if (intent.writes.some(w => !baseline.resources.some(r => same(r.resource, intent.resource) && r.fields.some(f => f.attribute === w.attribute)))) return 'missing-baseline-field';
    return undefined;
  } catch { return 'non-json-or-malformed-intent'; }
}
