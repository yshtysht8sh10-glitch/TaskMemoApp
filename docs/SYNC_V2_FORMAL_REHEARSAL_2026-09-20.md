# TaskMemo V2 formal cutover rehearsal — 2026-09-20

Status: **BLOCKED**. Issue #45 remains open. This rehearsal did not authorize or start production cutover.

## Safety boundary

- Source project: `taskmemoapp-eabc3`; access was limited to Firestore REST `documents:runQuery` for collection group `nodes`.
- Credential: short-lived Firebase CLI OAuth access token, supplied only in process memory and not written to an artifact.
- The production reader contains no Firestore write/delete, Rules deploy, migration, gate, Auth, Functions, Hosting, or EAS operation.
- All writes used local demo projects `demo-taskmemo-rehearsal` (port 8280) or `demo-taskmemo-v2` (port 8180). Demo project IDs prevent fallback to a live Firebase service.
- Production was not written, deleted, migrated, frozen, deployed, or reconfigured.

## Fresh source and immutable backup

Two consecutive production reads on 2026-09-20 produced 120 documents and the same canonical data SHA-256:

`86e34e8ff254f3d456d915fab3ae664520d500fd662a132c94f8b7324753f2c8`

The full-file hashes differ because `capturedAt` differs. Private source and create-only backup files are gitignored under `artifacts/private/`; no user title/body is recorded in this document.

| Source measure | Result |
| --- | ---: |
| Users | 1 |
| Nodes | 120 |
| Category | 12 |
| Memo | 108 |
| Idea | 1 |
| Routine | 9 |
| Active | 100 |
| Deleted (not purged) | 16 |
| Purged tombstone | 4 |
| Completed | 8 |
| Routine history entries | 8 |

Source validation found zero duplicate IDs, document-ID mismatches, unsupported types, invalid/missing ranks, invalid dates, parent orphans, cycles, unknown fields, schema issues, and semantic changes. The migration planner reported zero issues and zero lost fields.

## Node-only isolated evidence

Before the fail-closed profile check was corrected, the Node-only diagnostic path restored and migrated the fresh snapshot in the local Emulator:

- V1 restore: 120/120 exact IDs, fields, nested values and tombstones.
- V1→V2: 120/120, revision `0`, deterministic migration operation identity.
- Semantic changes: 0; lost fields: 0.
- Strict Rules: V1 read/write and tombstone resurrection rejected after V2 gate; a V2 adapter operation was applied.
- Application/Rules integration: 6/6 Emulator tests passed, including profile resources and two-client create/edit/conflict/restart/offline/Undo/Redo convergence.
- External AI: 6/6 Emulator repository tests passed, plus 3/3 service tests. V2 read/create/update, stale-revision rejection, idempotent retry, soft delete/restore, receipt creation and client receive behavior passed. No V1 fallback exists.

This is valid subsystem evidence, but it cannot turn the formal result into PASS because the actual V1 device-local profile inventory was not captured.

## Formal STOP reason

V1 `pinnedNote`, `ideasEnabled`, and `legacyPinnedNoteCandidates` live in client AsyncStorage, not production Firestore. A Cloud snapshot therefore cannot prove their value or prove candidate count zero. The previous rehearsal script treated a missing optional candidate field as `0`; a regression test now fixes this so missing local inventory is `UNKNOWN` and formal mode stops.

The corrected formal run stopped before migration with one `missing-local-profile-inventory` source issue. Classification:

- source Node validation: `CLEAR`
- local profile inventory: `NOT_CAPTURED`
- legacy candidate count: unknown, not zero
- legacy candidate status: `UNKNOWN`
- required action: export/inspect every supported production client profile, explicitly resolve every candidate, and provide one reviewed migration input for pinnedNote/features
- final result: **BLOCKED**

No candidate was adopted, discarded, merged or timestamp-selected.

## Managed export / restore

Native Firestore managed export was not executed. The workstation has no Google Cloud CLI, and a managed export creates a Cloud Storage object/admin operation rather than being the approved minimal production read-only query. Its bucket, billing and IAM prerequisites are not configured or authorized in this phase.

The verified fallback is the create-only JSON snapshot plus canonical SHA-256 and exact Emulator restore. It preserves raw Firestore documents, IDs, field/value structure, nested data, timestamps and tombstones. This fallback passed for all 120 Cloud V1 Nodes but cannot capture device-local profile data. Managed export or an equivalently reviewed immutable backup remains required at the actual frozen cutover boundary.

## Profile and features scenarios

Generic V2 tests pass for pinnedNote persistence/restart, normal operation identity, self echo, duplicate handling, and bidirectional convergence. Generic feature tests pass for:

- existing Cloud value wins;
- no Cloud value plus legacy local `true` promotes `true`;
- no Cloud value plus legacy `false`/default emits no write.

The fresh production user's actual local values were unavailable. Therefore actual profile migration, candidate clearance and restart preservation are not proven.

## Compatibility, Rules and External AI phase evidence

The strict `firestore.dev.rules` artifact passed owner isolation, owner/schema/revision validation, pinnedNote, ideasEnabled, immutable operations, client denial of `externalAiRequestsV2`, V1 phase access and freeze/V2-phase V1 rejection. Admin SDK External AI tests prove the repository fails closed outside a V2-only gate and during global freeze. The expected matrix is:

| Phase | V1 | V2 client | External AI V2 |
| --- | --- | --- | --- |
| V1 gate, writes enabled | read/write | rejected | rejected |
| global freeze | rejected | rejected | rejected |
| migrated, still frozen | rejected | rejected | rejected |
| V2-only gate, writes enabled | rejected | read/write | read/write |

## Receipt retention decision

`syncOperationsV2` and `externalAiRequestsV2` are the idempotency and forensic boundaries. At initial cutover they are retained indefinitely. No TTL/cleanup is enabled. A later cleanup may be introduced only after all of the following exist: a server-enforced maximum retry age, an immutable diagnostic export, closure of the rollback/observation window, and proof that no supported client can replay the op/request ID. A minimum 180-day online retention is proposed after those prerequisites; request receipts older than that may be archived before deletion. Until the retry contract is bounded, deletion is unsafe.

## Monitoring and STOP criteria

The cutover cannot proceed until queries/alerts exist for these signals. During canary, any V1 write attempt, schema validation failure, owner mismatch, missing receipt for an acknowledged operation, client convergence mismatch, or unexplained revision regression is an immediate STOP and global freeze. Also STOP when any canary outbox remains pending for 5 minutes after confirmed connectivity, a permanent sync error occurs, or Functions creates a partial winner/receipt set. Broader rollout requires zero canary STOP events and no increasing retry/rejection/outbox trend for the observation window. Alert-only transient network retries must drain and converge; otherwise escalate to STOP.

## Rollback rehearsal and boundary

- Before any migration/V2 write: the immutable backup restored 120/120 exactly in an empty Emulator, so aborting and retaining V1 is valid.
- After migration but before V2 writes: remain frozen, validate manifest-owned V2 records, and remove only those proven migration outputs before returning the gate/Rules to V1.
- After the first V2 client or AI write: simple V1 snapshot restore is prohibited. Freeze, export current V2 winners/profile/receipts/audit, preserve V2-only changes, then perform audited forward repair or reconciliation.

The rollback backup restore passed for Cloud Nodes. Full rollback readiness is blocked by the same missing device-local profile inventory and by the absence of an authorized managed export.

## Problems found and corrected

The formal-source regression test first failed because no inventory classifier existed. The fix adds an explicit local-profile completeness marker and makes absent inventory fail closed. Three focused tests pass: absent inventory is unknown/blocked, non-empty candidates require user action, and only an explicit complete empty inventory is clear.

## Remaining blockers / required evidence

1. Collect reviewed V1 local profile exports from every supported production device/account scope.
2. Resolve all `legacyPinnedNoteCandidates` explicitly; count must be proven zero.
3. Decide the authoritative pinnedNote when device values differ without discarding any value.
4. Record actual legacy `ideasEnabled` and run deterministic profile migration against that input.
5. Configure and authorize managed export to a restricted versioned bucket, or formally approve the manifest+JSON fallback including profile capture.
6. Implement production monitoring/alerts for the documented STOP signals.
7. Repeat this formal rehearsal from the combined Cloud+device inventory. Only that run can produce PASS/PASS WITH WARNINGS.

