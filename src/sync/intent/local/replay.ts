import { canonical, compare, same } from '../canonical';
import { evaluateAcceptance } from '../acceptance';
import { applyPublication, initialClient, makePublication, recordClientAccepted } from '../publication';
import type { Digest } from '../publication';
import { intentError } from '../validation';
import type { Intent } from '../types';
import type { Derived, Event, InboxEntry, LocalContext, LocalInput, Notice } from './types';

export function localIntent(context: LocalContext, seq: number, input: LocalInput): Intent {
  const opId = `isolated:${canonical([context.actorId, context.binding.incarnation, seq])}`;
  return { ...input, protocol: 'intent-v1', schema: 'phase1', scope: context.binding.scope,
    generation: context.binding.generation, actorId: context.actorId, actorIncarnation: context.binding.incarnation,
    localSeq: seq, opId, commandId: opId };
}

function validateNotice(context: LocalContext, notice: Notice, digest: Digest) {
  if (!same(notice.binding, context.binding)) throw Error('notification-binding');
  if (notice.kind === 'receipt') {
    const op = JSON.parse(notice.receipt.canonicalIntent) as Intent;
    const decision = evaluateAcceptance(context.baseline, [], op);
    if (decision.kind !== 'accepted' || !same(decision.receipt, notice.receipt)) throw Error('receipt-payload');
    if (!same(Object.keys(notice).sort(), ['binding', 'kind', 'receipt'])) throw Error('unknown-receipt-fields');
  } else if (notice.kind === 'publication') {
    const p = notice.publication;
    const expected = makePublication(context.baseline, p.state.intents, p.manifest.previous, context.binding.controlEpoch, digest);
    if (!same(p, expected) || !same(Object.keys(notice).sort(), ['binding', 'kind', 'publication'])) throw Error('publication-members');
  } else throw Error('unknown-notification');
}

/** Replay uses ONLY Phase 1 public transitions. No persisted derived fact is trusted. */
export function replay(context: LocalContext, events: readonly Event[], processed: number, digest: Digest): Derived {
  if (context.format !== 'phase2a-isolated/1' || !context.storageScope.startsWith('synthetic:') || !context.actorId ||
    !same(Object.keys(context).sort(), ['actorId', 'baseline', 'binding', 'format', 'storageScope']) ||
    !Number.isSafeInteger(processed) || processed < 0 || processed > events.length) throw Error('unknown-local-context');
  let snapshot = initialClient(context.binding, context.baseline), nextLocalSeq = 1;
  let halt: string | null = null;
  const entries = new Map<string, InboxEntry>(), eligible = new Set<string>();
  for (const e of events) {
    if (e.kind === 'notification' && same(Object.keys(e).sort(), ['kind', 'notice'])) {
      validateNotice(context, e.notice, digest);
      const key = canonical(e.notice);
      if (!entries.has(key)) entries.set(key, { key, notice: e.notice, status: 'queued' });
    } else if (e.kind !== 'local' || !same(Object.keys(e).sort(), ['intent', 'kind'])) throw Error('unknown-event');
  }
  if (events.slice(processed).some(e => e.kind !== 'notification')) throw Error('uncommitted-local-allocation');
  const flush = () => {
    let progress = true;
    while (progress && halt === null) {
      progress = false;
      for (const [key, entry] of [...entries].sort(([a], [b]) => compare(a, b))) {
        if (!eligible.has(key) || !['queued', 'pending'].includes(entry.status)) continue;
        try {
          validateNotice(context, entry.notice, digest);
          let status: InboxEntry['status'];
          if (entry.notice.kind === 'receipt') {
            const r = entry.notice.receipt;
            if ([...snapshot.ledger.outbox, ...snapshot.ledger.awaiting, ...snapshot.state.intents]
              .some(op => op.opId === r.opId && canonical(op) !== r.canonicalIntent)) throw Error('receipt-immutable-payload-mismatch');
            snapshot = recordClientAccepted(snapshot, entry.notice.receipt, entry.notice.binding);
            status = snapshot.evidence.receipts.some(f => same(f.receipt, entry.notice.kind === 'receipt' ? entry.notice.receipt : null)) ? 'accepted' : 'pending';
          } else {
            const decision = applyPublication(snapshot, entry.notice.publication, entry.notice.binding, context.baseline, digest);
            snapshot = decision.client;
            status = decision.kind;
            if (status === 'rejected') throw Error(decision.reason ?? 'rejected-publication');
          }
          entries.set(key, { ...entry, status });
          if (status !== 'pending') progress = true;
        } catch (error) {
          entries.set(key, { ...entry, status: 'rejected' });
          halt = error instanceof Error ? error.message : 'invalid-notification';
          break;
        }
      }
    }
  };
  for (const e of events.slice(0, processed)) {
    if (halt) continue; // Retain all remaining original notices; a halt never authorizes their execution.
    if (e.kind === 'local') {
      if (snapshot.protection) throw Error('local-edit-during-protection');
      if (!same(e.intent, localIntent(context, nextLocalSeq, e.intent)) || intentError(context.baseline, e.intent)) throw Error('invalid-local-intent');
      snapshot = { ...snapshot, ledger: { ...snapshot.ledger, outbox: [...snapshot.ledger.outbox, e.intent] } };
      nextLocalSeq++;
    } else eligible.add(canonical(e.notice));
    flush();
  }
  const all = [...entries.values()].sort((a, b) => compare(a.key, b.key));
  return { snapshot, nextLocalSeq, halt, inbox: {
    receipts: all.filter(e => e.notice.kind === 'receipt'), publications: all.filter(e => e.notice.kind === 'publication'),
  } };
}
