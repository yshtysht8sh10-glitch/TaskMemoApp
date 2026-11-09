/** Isolated reference contract. Not a persisted schema or a live sync protocol gate. */
export type Scope = Readonly<{ projectId: string; uid: string }>;
export type Resource = Readonly<{ type: 'node' | 'pinnedNote' | 'features'; id: string }>;
export type Completion = Readonly<{ status: 'active'; completedAt: null }> |
  Readonly<{ status: 'completed'; completedAt: string }>;
export type Write =
  | Readonly<{ attribute: 'completion'; value: Completion }>
  | Readonly<{ attribute: 'emphasis' | 'ideasEnabled'; value: boolean }>
  | Readonly<{ attribute: 'title' | 'body'; value: string }>
  | Readonly<{ attribute: 'placement'; value: Readonly<{ parentId: string | null; sortKey: string; membershipEpoch: string | null }> }>;
export type Attribute = Write['attribute'];
export type Value = Write['value'];
export type Head = Readonly<{ kind: 'baseline' }> | Readonly<{ kind: 'operation'; opId: string }>;
export type Observation = Readonly<{
  resource: Resource; attribute: Attribute; baselineSeal: string; heads: readonly Head[];
}>;
export type Intent = Readonly<{
  protocol: 'intent-v1'; schema: 'phase1'; scope: Scope; generation: string;
  resource: Resource; opId: string; actorId: string; actorIncarnation: string; localSeq: number;
  commandId: string; intentKind: 'set-completed' | 'set-active' | 'set-emphasis' | 'set-title' |
    'set-body' | 'set-placement' | 'set-ideasEnabled' | 'atomic-edit' | 'resolve';
  writes: readonly Write[]; observed: readonly Observation[]; readSet: readonly Observation[];
  dependencies: readonly string[]; origin: string; createdAt: string;
  undoOf?: string; redoOf?: string; legacySourceRef?: string;
}>;
export type Baseline = Readonly<{
  scope: Scope; generation: string; seal: string;
  resources: readonly Readonly<{ resource: Resource; fields: readonly Write[] }>[];
}>;
export type Candidate = Readonly<{ head: Head; value: Value }>;
export type FieldState = Readonly<{
  resource: Resource; attribute: Attribute; candidates: readonly Candidate[]; value?: Value;
}>;
export type ApplicationStatus = 'applied' | 'conflict' | 'dependency-pending' | 'rejected';
export type ApplicationResult = Readonly<{ opId: string; status: ApplicationStatus; reasons: readonly string[] }>;
export type ReducedState = Readonly<{
  scope: Scope; generation: string; baselineSeal: string;
  /** Includes rejected/colliding evidence; nothing is garbage-collected. */
  intents: readonly Intent[]; fields: readonly FieldState[]; results: readonly ApplicationResult[];
  /** Identity corruption is a stop condition, not a normal baseline projection. */
  protection: readonly string[];
}>;
export type AcceptedReceipt = Readonly<{
  kind: 'accepted'; scope: Scope; generation: string; opId: string; canonicalIntent: string;
}>;
export type DeliveryLedger = Readonly<{ outbox: readonly Intent[]; awaiting: readonly Intent[] }>;
