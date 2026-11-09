import { canonical, compare, same } from './canonical';
import type { ApplicationResult, Baseline, Candidate, FieldState, Intent, ReducedState } from './types';
import { fieldKey, intentError, validateBaseline } from './validation';

/** Full-set reference reducer. No I/O, clocks, counters, persistence, or live Node imports. */
export function reduceIntents(baseline: Baseline, delivered: readonly Intent[]): ReducedState {
  validateBaseline(baseline);
  const variants = new Map<string, Map<string, Intent>>();
  for (const op of delivered) {
    const key = canonical(op); // Non-JSON cannot safely be part of a persisted contract: fail closed.
    const values = variants.get(op.opId) ?? new Map<string, Intent>();
    values.set(key, op);
    variants.set(op.opId, values);
  }
  const ids = [...variants.keys()].sort(compare);
  const intents = ids.flatMap(id => [...variants.get(id)!.entries()].sort(([a], [b]) => compare(a, b)).map(([, op]) => op));
  const ops = new Map(ids.filter(id => variants.get(id)!.size === 1).map(id => [id, [...variants.get(id)!.values()][0]]));
  const results = new Map<string, ApplicationResult>();
  const reject = (id: string, reason: string) => results.set(id, { opId: id, status: 'rejected', reasons: [reason] });
  const pending = (id: string, reason: string) => results.set(id, { opId: id, status: 'dependency-pending', reasons: [reason] });
  for (const id of ids) {
    if (!ops.has(id)) reject(id, 'op-id-collision');
    else {
      const error = intentError(baseline, ops.get(id)!);
      if (error) reject(id, error);
    }
  }
  // A Phase 1 command is one immutable intent with an atomic write-set, not several events.
  const commandIds = new Map<string, string>();
  const actorSeqs = new Map<string, string>();
  for (const [id, op] of ops) {
    if (results.has(id)) continue;
    for (const [map, key, reason] of [
      [commandIds, op.commandId, 'split-command-unsupported'],
      [actorSeqs, canonical([op.actorId, op.actorIncarnation, op.localSeq]), 'actor-sequence-collision'],
    ] as const) {
      const prior = map.get(key);
      if (prior && prior !== id) { reject(prior, reason); reject(id, reason); }
      else map.set(key, id);
    }
  }
  const references = (op: Intent) => [...op.observed, ...op.readSet];
  const dependencies = new Map<string, Set<string>>();
  for (const [id, op] of ops) {
    if (results.has(id)) continue;
    const deps = new Set(op.dependencies);
    for (const ref of references(op)) for (const head of ref.heads) {
      if (head.kind !== 'operation') continue;
      deps.add(head.opId);
      const parent = ops.get(head.opId);
      if (parent && !results.has(head.opId) && !parent.writes.some(w => same(parent.resource, ref.resource) && w.attribute === ref.attribute)) reject(id, 'head-target-mismatch');
    }
    dependencies.set(id, deps);
  }
  const ancestors = new Map<string, Set<string>>();
  // Per-attribute causal ancestry must come from observed heads, not unrelated global revisions.
  const fieldAncestors = new Map<string, Map<string, Set<string>>>();
  const ready: string[] = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const id of ids) {
      if (results.has(id) || ancestors.has(id)) continue;
      const deps = dependencies.get(id)!;
      if ([...deps].some(d => !variants.has(d) || results.has(d))) { pending(id, 'unavailable-dependency'); progress = true; continue; }
      if ([...deps].some(d => !ancestors.has(d))) continue;
      const lineage = new Set<string>(deps);
      for (const dep of deps) for (const ancestor of ancestors.get(dep)!) lineage.add(ancestor);
      const perField = new Map<string, Set<string>>();
      const op = ops.get(id)!;
      let error: string | undefined;
      for (const ref of references(op)) {
        const key = fieldKey(ref.resource, ref.attribute);
        const parents = ref.heads.filter(h => h.kind === 'operation').map(h => h.opId);
        if ((parents.length && ref.heads.some(h => h.kind === 'baseline')) ||
          parents.some(a => parents.some(b => a !== b && fieldAncestors.get(b)?.get(key)?.has(a)))) error = 'non-frontier-observation';
        if (op.observed.includes(ref)) {
          const attributeLineage = new Set(parents);
          for (const parent of parents) for (const ancestor of fieldAncestors.get(parent)?.get(key) ?? []) attributeLineage.add(ancestor);
          perField.set(key, attributeLineage);
        }
      }
      if (error) reject(id, error);
      else { ancestors.set(id, lineage); fieldAncestors.set(id, perField); ready.push(id); }
      progress = true;
    }
  }
  for (const id of ids) if (!results.has(id) && !ancestors.has(id)) pending(id, 'cyclic-or-blocked-dependency');

  const writesField = (id: string, key: string) => ops.get(id)!.writes.some(w => fieldKey(ops.get(id)!.resource, w.attribute) === key);
  const maximal = (key: string, pool: readonly string[]) => pool.filter(id => writesField(id, key)).filter(id =>
    !pool.some(other => fieldAncestors.get(other)?.get(key)?.has(id)));
  const semanticReasons = new Map<string, Set<string>>();
  const conflict = (id: string, reason: string) => {
    const reasons = semanticReasons.get(id) ?? new Set<string>(); reasons.add(reason); semanticReasons.set(id, reasons);
  };
  for (const id of ready) {
    const op = ops.get(id)!;
    for (const ref of op.observed) {
      const key = fieldKey(ref.resource, ref.attribute);
      const known = maximal(key, [...ancestors.get(id)!]);
      const heads = known.length ? known.map(opId => ({ kind: 'operation', opId })) : [{ kind: 'baseline' }];
      if (!same(heads.map(canonical).sort(compare), ref.heads.map(canonical).sort(compare))) conflict(id, `stale-write:${key}`);
    }
    for (const ref of op.readSet) {
      const key = fieldKey(ref.resource, ref.attribute);
      const knownHeads = maximal(key, [...ancestors.get(id)!]);
      const actual = knownHeads.length ? knownHeads.map(opId => ({ kind: 'operation', opId })) : [{ kind: 'baseline' }];
      if (!same(actual.map(canonical).sort(compare), ref.heads.map(canonical).sort(compare))) conflict(id, `stale-read:${key}`);
      for (const writer of ready) {
        if (writer !== id && writesField(writer, key) && !ancestors.get(id)!.has(writer) && !ancestors.get(writer)!.has(id)) {
          conflict(id, `concurrent-read:${writer}`); conflict(writer, `concurrent-reader:${id}`);
        }
      }
    }
  }
  const sortedHeads = (a: string, b: string) => {
    const x = ops.get(a)!, y = ops.get(b)!;
    return compare(x.actorId, y.actorId) || compare(x.actorIncarnation, y.actorIncarnation) || x.localSeq - y.localSeq || compare(a, b);
  };
  const provisional: { resource: FieldState['resource']; attribute: FieldState['attribute']; candidates: Candidate[] }[] = [];
  for (const item of baseline.resources) for (const field of item.fields) {
    const key = fieldKey(item.resource, field.attribute);
    const heads = maximal(key, ready).sort(sortedHeads);
    if (heads.length > 1) for (const id of heads) conflict(id, `concurrent-write:${key}`);
    provisional.push({ resource: item.resource, attribute: field.attribute, candidates: heads.length
      ? heads.map(id => ({ head: { kind: 'operation' as const, opId: id }, value: ops.get(id)!.writes.find(w => w.attribute === field.attribute)!.value }))
      : [{ head: { kind: 'baseline' }, value: field.value }] });
  }
  // Do not allow a descendant to publish half of an unresolved atomic command.
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of ready) {
      if (semanticReasons.has(id)) continue;
      for (const ancestor of ancestors.get(id)!) {
        if (!semanticReasons.has(ancestor)) continue;
        const source = ops.get(ancestor)!;
        const fullyResolves = ops.get(id)!.intentKind === 'resolve' && source.writes.every(w =>
          ops.get(id)!.observed.some(o => same(o.resource, source.resource) && o.attribute === w.attribute &&
            o.heads.some(h => h.kind === 'operation' && h.opId === ancestor)));
        if (!fullyResolves) { conflict(id, `unresolved-command:${ancestor}`); changed = true; break; }
      }
    }
  }
  const fields: FieldState[] = provisional.sort((a, b) => compare(fieldKey(a.resource, a.attribute), fieldKey(b.resource, b.attribute))).map(f => {
    const head = f.candidates[0].head;
    // Conflict anywhere in a command prevents a partial success projection of its other fields.
    return f.candidates.length === 1 && (head.kind === 'baseline' || !semanticReasons.has(head.opId))
      ? { ...f, value: f.candidates[0].value } : f;
  });
  for (const id of ready) {
    const reasons = semanticReasons.get(id);
    results.set(id, reasons ? { opId: id, status: 'conflict', reasons: [...reasons].sort(compare) }
      : { opId: id, status: 'applied', reasons: [] });
  }
  const protection = [...new Set([...results.values()].flatMap(r => r.reasons).filter(reason =>
    ['op-id-collision', 'split-command-unsupported', 'actor-sequence-collision'].includes(reason)))].sort(compare);
  return { scope: baseline.scope, generation: baseline.generation, baselineSeal: baseline.seal,
    intents, fields: protection.length ? fields.map(({ resource, attribute, candidates }) => ({ resource, attribute, candidates })) : fields,
    results: ids.map(id => results.get(id)!), protection };
}
