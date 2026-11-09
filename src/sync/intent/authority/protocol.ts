import type { Binding } from '../publication';
import type { Intent, Scope } from '../types';
import type { LocalInput, Notice, RecoveryGuard, ServerObservation } from '../local/types';

/** Prototype boundary format, not a Firestore schema or a deployed wire protocol. */
export type AuthPrincipal = Readonly<{ sessionId: string; scope: Scope }>;
export type SignatureIssuer = Readonly<{ keyId: string; sign(text: string): string }>;
export type PinnedVerifier = Readonly<{ verify(keyId: string, text: string, signature: string): boolean }>;
export type Command = Readonly<{ kind: 'local'; input: LocalInput }> |
  Readonly<{ kind: 'receive'; noticeId: string }> | Readonly<{ kind: 'drain' }>;
export type Request = Readonly<{ nonce: string; replicaId: string }> & (
  | Readonly<{ kind: 'head' | 'initialize' | 'observation' }>
  | Readonly<{ kind: 'recover'; requestId: string | null }>
  | Readonly<{ kind: 'notice'; noticeId: string }>
  | Readonly<{ kind: 'prepare'; expectedVersion: number; requestId: string; command: Command }>
  | Readonly<{ kind: 'commit'; requestId: string }>);
export type Head = Readonly<{ type: 'head'; version: number; guard: RecoveryGuard;
  outcome: 'confirmed' | 'retry-required' | 'protected'; pendingId: string | null; result: Intent | null }>;
export type Plan = Readonly<{ type: 'plan'; id: string; expectedVersion: number; targetVersion: number;
  raw: string; guard: RecoveryGuard; result: Intent | null; deadline: number }>;
export type Value = Head | Plan | Readonly<{ type: 'notice'; id: string; notice: Notice }> |
  Readonly<{ type: 'observation'; observation: ServerObservation }>;
export type Claims = Readonly<{ format: 'authority-boundary/1'; purpose: Request['kind']; nonce: string;
  replicaId: string; sessionId: string; binding: Binding; issuedAt: number; expiresAt: number; value: Value }>;
export type SignedReply = Readonly<{ keyId: string; claims: Claims; signature: string }>;
export interface AuthorityChannel { call(request: Request): Promise<SignedReply> }
