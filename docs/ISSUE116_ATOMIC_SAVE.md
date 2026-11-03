# Issue #116: atomic save and redundant Journal

Status: local DEV implementation; no Production deployment or real-data recovery authorized.
DEV base: `f3c8253650657b66ac30edd6861ccd5903391ffa`; #116 changes are isolated on
`fix/issue116-atomic-recovery`. The actual commit SHA is recorded in Issue #116.

The three transactions in TaskMemoV2ApplicationStore.commit allowed termination after
Committed replacement and before Journal removal. The specific OS/browser event on the
incident iPhone is unknown. The presence of the interruption window is a design defect;
it does not identify that event.

Test contract change: the two IndexedDB migration tests previously promoted an arbitrary
pending Journal during ordinary startup. Under #116 this is unsafe: mismatching snapshots
must remain protected. Keep their migration/History/Outbox assertions, but assert startup
refusal first and use an explicit synthetic recovery step before testing resumed editing.
No real backup is used by these tests.

Save-failure contract change: TW-ATOMIC-002 previously retried on the same store after
an injected transaction failure. #116 requires protection stop: the failed writer now
stays blocked, including network uploads. The test retries only with an explicitly
reopened synthetic store and retains its disk/memory/History/Outbox preservation assertions.
The same explicit-reopen adjustment applies to the Routine root, occurrence ordering,
category drop and ownership adoption failure tests. Ownership previews are regenerated
after reopening, then deliberately invalidated again to retain stale-preview coverage.

## Call-path audit

| Path | Persistence after this change |
| --- | --- |
| UI commands, create, Routine root, Undo/Redo, Text, ownership adoption | serialized `TaskMemoV2ApplicationStore.commit` → `writeAtomic` |
| Remote Node/profile reception and acknowledgement, Outbox removal | same commit boundary; Domain/History/Outbox/profile are one envelope |
| Profile draft, debounce flush, migration flags, legacy note candidate handling | same commit boundary; debounce errors now caught and protected |
| Initial bootstrap and envelope migration in `open` | CAS against the exact raw source, including null on first creation |
| Anonymous V1→V2 migration | existing `writeAtomic(null, envelope)`; old source/backup unchanged |
| Web runtime | IndexedDB adapter: one readwrite transaction with Committed raw CAS and Journal-null precondition |
| Native runtime | existing single-key envelope replacement under the single JS-process writer restriction; no cross-process IDB guarantee claimed |
| `applicationStore.ts` V1 foundation and `AsyncStorageApplicationJournal` | no app entry-point caller; non-transactional foundation/test compatibility remains isolated |
| Explicit recovery/local recovery/self repair | separate existing guarded CAS executors; not ordinary-save WAL replay |

The old ordinary-save path used `writeJournal`, `writeCommitted`, then `clearJournal`.
All real runtime adapters now take the existing atomic capability. Persistence errors
never fall back to WAL. The cached Committed raw baseline advances only after transaction
completion. A stale writer cannot adopt a freshly reread disk value and overwrite it.
Transaction request callbacks perform read/compare/put synchronously; validation/Cloud
reads/SHA computation run outside the active readwrite transaction.

## Startup redundant-Journal policy

The Web account hook runs the check before the manual-preflight guard, normal
`connect`, account provisioning, listeners and uploads. Direct store opening rejects any
pending Journal on atomic storage; it cannot promote a mismatch via the DEV fallback.
Diagnostic storage `open` remains observational: opening an adapter never clears Journal.

Only active Journal is set to null, using a single-transaction CAS of the entire scope
record after verifying:

- requested scope and active auth generation; same Committed/Journal raw string;
- V2 envelope/device/sequence, empty Outbox, History form, Node metadata/content and tree/sortKey integrity;
- clean local profile matching its synced values, no pending ownership transaction;
- old storage fingerprint unchanged before and after verification; historical legacy Journal requires prior recovery completion;
- two server-only Cloud snapshots matching every Node value/metadata and both profile records, with stable receipt count.

Any mismatch, unavailable Cloud read, concurrent update or abort leaves the active
snapshots intact and stops startup. The CAS preserves every other scope field, including
old recovery plans, archived Committed/Journal, self-repair archives and unknown fields.
It does not rewrite Node, History, profile, identity, legacy storage or archived evidence.

## Verification

Regression-first failures reproduced ordinary saves bypassing atomic storage, concurrent
writers both succeeding, unconditional startup WAL promotion, retrying a failed writer,
editable UI after failed persistence and an unhandled debounced profile persistence error.

`issue116AtomicPersistence.test.ts`: 31 synthetic fake-IndexedDB cases cover successful
single-transaction save, acknowledgement, five interruption stages (before read, after
read, before put, after put, after write-request success), abort rollback, two-writer CAS,
memory/disk/history/outbox preservation, protected retry/upload, debounce error,
redundant cleanup, scope/auth change, corrupt content, raw mismatch, pending Outbox/profile,
invalid sequence/tree/sortKeys, unstable/offline Cloud, old-storage/archive races and
cleanup abort. The React startup test additionally verifies retained unsaved input and
disabled editing after persistence failure. Production JSON is never used by these tests.

Final `npm run verify`: PASS (TypeScript, lint, app suite 1,283 passed / 46 environment-gated
skipped; Functions build and 15 passed / 20 environment-gated skipped). Focused #116
suite: 31 passed. The real React startup suite also passes. DEV Web export passes;
local Production-config Web export and `git diff --check` results are recorded in #116.
No live Firebase integration was invoked. Logs are retained outside the app checkout at
`../artifacts/issue116-atomic-save/`.

## Residual risks and release conditions

- The iPhone OS/browser interruption trigger remains unknown. Synthetic abort injection
  establishes transaction behavior, not a reproduction of that specific OS event.
- iOS/WebKit PWA and Service Worker delivery are not validated by fake IndexedDB or
  local export. A disposable DEV PWA/device check and review of the diagnostic/recovery
  delivery route are still required before Production approval.
- Cloud reads are not one atomic snapshot with local IndexedDB. A later remote edit
  cannot be locked out by local CAS. Cleanup discards no unique payload: the exact same
  Committed remains. Normal synchronization must subsequently process later remote data.
- IndexedDB and legacy localStorage cannot share a transaction. Old storage is fingerprinted
  twice; another old-version writer changing legacy data after that point is not locked out.
- An already completed remote write cannot be rolled back by a later local save failure.
  The durable Outbox remains and receipt audit/idempotent acknowledgement is required on
  explicit reopening. No upload is intentionally restarted from a blocked writer.
- Strict validation intentionally leaves ambiguous/old/unsupported data protected. Offline
  startup with a redundant Journal stays blocked until server verification is possible.
- Atomicity does not guarantee against storage eviction, filesystem/device failure or
  loss outside the browser's durability contract. Preserve the external original backup.

Do not deploy, reload the incident PWA, clear its Journal or execute recovery under this
local validation record. Production distribution and incident recovery require separate
user approval and the fresh-backup/Cloud/CAS preconditions already specified in #116.

References: [IndexedDB transaction lifecycle](https://w3c.github.io/IndexedDB/#transaction-lifecycle),
[Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/).
