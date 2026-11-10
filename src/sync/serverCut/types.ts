import type { Binding, ClientSnapshot, Digest, Publication } from '../intent/publication';
import type { ApplicationStatus, Baseline, Intent } from '../intent/types';

/** Isolated N1 formats. Not a deployed protocol or a persistence adapter. */
export type Realm = Readonly<{ scope: Binding['scope']; mode: 'firebase-standard'; generation: string;
  baselineSeal: string; controlEpoch: number; activationId: string }>;
export type Log = Readonly<{ format: 'n1-log/1'; realm: Realm; parent: string | null;
  accepted: readonly Intent[]; hash: string }>;
export type Published = Readonly<{ format: 'n1-publication/1'; realm: Realm; source: string;
  previous: string | null; publication: Publication; hash: string }>;
export type Cut = Readonly<{ format: 'n1-cut/1'; purpose: 'cut'; realm: Realm; replicaId: string;
  session: string; nonce: string; issuedAt: number; expiresAt: number; controlVersion: number;
  log: string; publication: string | null; baselineHash: string;
  inventory: Readonly<{ logs: readonly string[]; publications: readonly string[] }>;
  unprocessed: readonly Intent[]; partitions: Readonly<Record<ApplicationStatus, readonly string[]>>;
  admissionRejections: readonly string[]; protection: readonly string[] }>;
export type Bundle = Readonly<{ baseline: Baseline; logs: readonly Log[]; publications: readonly Published[];
  certificate: Readonly<{ body: Cut; keyId: string; signature: string }> }>;
export type Expected = Readonly<{ realm: Realm; replicaId: string; session: string; nonce: string; now: number;
  pin?: Readonly<{ controlVersion: number; log: string; publication: string | null }>;
  /** Independently authenticated receipt admission heads, not caller-selected raw guards. */
  receipts?: readonly Readonly<{ log: string; intent: Intent }>[] }>;
export type Dependencies = Readonly<{ digest: Digest;
  verifySignature(keyId: string, canonicalBody: string, signature: string): boolean;
  /** Caller MUST supply a reviewable synthetic work budget. No production default. */
  limits: Readonly<{ logs: number; publications: number; intents: number }> }>;
export type Verification = Readonly<{ kind: 'verified'; client: ClientSnapshot; unprocessed: readonly Intent[];
  blockers: readonly string[]; cut: Cut }> |
  Readonly<{ kind: 'protected' | 'pending' | 'expired'; reason: string }>;
export type LocalFacts = Readonly<{ client: ClientSnapshot; persisted: boolean; dirty: boolean;
  inboxPending: number; inboxRejected: number; unprocessed: number; inFlight: number;
  recoveryPending: boolean; protection: boolean; changedSinceCut: boolean }>;
