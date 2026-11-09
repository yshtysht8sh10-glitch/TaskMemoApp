import { canonical, same } from '../canonical';
import type { Digest } from '../publication';
import { replay } from './replay';
import type { Envelope, Event, LocalContext, RecoveryGuard } from './types';

export function hash(value: unknown, digest: Digest) {
  const result = digest(canonical(value));
  if (!/^[a-f0-9]{64}$/.test(result)) throw Error('SHA-256 required');
  return result;
}
export function build(context: LocalContext, events: readonly Event[], processed: number,
  revision: number, history: readonly RecoveryGuard[], digest: Digest): Envelope {
  const body = { context, revision, history, events, processed, ...replay(context, events, processed, digest) };
  return { ...body, checksum: hash(body, digest) };
}
export function guardFor(raw: string, e: Envelope, digest: Digest): RecoveryGuard {
  return { revision: e.revision, rawHash: hash(raw, digest), eventCount: e.events.length, processed: e.processed,
    logHash: hash(e.events, digest), clientHash: hash(e.snapshot, digest) };
}

/** A candidate cannot authenticate its own recovery floor. The caller must supply that authority. */
export function hydrate(raw: string, context: LocalContext, floor: RecoveryGuard | null, digest: Digest): Envelope {
  if (!floor) throw Error('trusted-recovery-guard-required');
  const parsed = JSON.parse(raw) as Envelope;
  if (!same(parsed.context, context) || !Number.isSafeInteger(parsed.revision) || parsed.revision < 1 ||
    !Array.isArray(parsed.history) || parsed.history.length !== parsed.revision - 1 || !Array.isArray(parsed.events)) throw Error('context-or-format');
  for (const [i, g] of parsed.history.entries()) {
    if (g.revision !== i + 1 || !Number.isSafeInteger(g.eventCount) || g.eventCount < 0 || g.eventCount > parsed.events.length ||
      !Number.isSafeInteger(g.processed) || g.processed < 0 || g.processed > g.eventCount ||
      !/^[a-f0-9]{64}$/.test(g.rawHash) || !/^[a-f0-9]{64}$/.test(g.logHash) || !/^[a-f0-9]{64}$/.test(g.clientHash) ||
      !same(Object.keys(g).sort(), ['clientHash', 'eventCount', 'logHash', 'processed', 'rawHash', 'revision'])) throw Error('invalid-history-guard');
  }
  // Replay checks every manifest/member/hash/predecessor/payload and reproduces reflections.
  const expected = build(context, parsed.events, parsed.processed, parsed.revision, parsed.history, digest);
  if (!same(parsed, expected)) throw Error('derived-state-or-evidence-mismatch');
  const currentGuard = guardFor(raw, parsed, digest);
  // An append-only-looking successor is NOT proof of origin. Without an independently
  // confirmed current head, an ambiguous commit or coherently forged log must stay stopped.
  if (!same(currentGuard, floor)) throw Error('unconfirmed-recovery-head');
  const prefix = parsed.events.slice(0, floor.eventCount);
  if (hash(prefix, digest) !== floor.logHash || hash(replay(context, prefix, floor.processed, digest).snapshot, digest) !== floor.clientHash)
    throw Error('recovery-prefix-mismatch');
  return parsed;
}
