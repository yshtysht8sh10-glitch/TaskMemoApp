import type { Binding, Checkpoint, ClientSnapshot } from '../publication';
import type { AcceptedReceipt, Baseline, Intent } from '../types';

export type RawPair = Readonly<{ committed: string | null; journal: string | null }>;
/** Mandatory raw CAS + Journal-null check in ONE transaction. No replay/clear fallback. */
export interface AtomicStorage {
  readonly scope: string;
  read(): Promise<RawPair>;
  writeAtomic(expectedRaw: string | null, candidateRaw: string, signal?: AbortSignal): Promise<void>;
}
export type LocalContext = Readonly<{
  format: 'phase2a-isolated/1'; storageScope: string; actorId: string; binding: Binding; baseline: Baseline;
}>;
export type Notice = Readonly<{ kind: 'receipt'; binding: Binding; receipt: AcceptedReceipt }> |
  Readonly<{ kind: 'publication'; binding: Binding; publication: import('../publication').Publication }>;
export type LocalInput = Omit<Intent, 'protocol' | 'schema' | 'scope' | 'generation' | 'opId' |
  'actorId' | 'actorIncarnation' | 'localSeq' | 'commandId'>;
export type Event = Readonly<{ kind: 'local'; intent: Intent }> | Readonly<{ kind: 'notification'; notice: Notice }>;
export type InboxEntry = Readonly<{ key: string; notice: Notice; status: 'queued' | 'pending' | 'accepted' |
  'applied' | 'protected' | 'stale' | 'noop' | 'rejected' }>;
export type Derived = Readonly<{
  snapshot: ClientSnapshot; nextLocalSeq: number;
  inbox: Readonly<{ receipts: readonly InboxEntry[]; publications: readonly InboxEntry[] }>;
  halt: string | null;
}>;
/** Must come from a trusted prior successful commit, NOT the candidate backup being inspected. */
export type RecoveryGuard = Readonly<{
  revision: number; rawHash: string; eventCount: number; processed: number; logHash: string; clientHash: string;
}>;
export type Envelope = Derived & Readonly<{
  context: LocalContext; revision: number; history: readonly RecoveryGuard[];
  events: readonly Event[]; processed: number; checksum: string;
}>;
export type ServerObservation = Readonly<{ binding: Binding; checkpoint: Checkpoint }>;
