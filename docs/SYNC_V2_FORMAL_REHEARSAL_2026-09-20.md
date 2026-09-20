# TaskMemo V2 formal cutover rehearsal — 2026-09-20

Status: **BLOCKED_SOURCE_VALIDATION**. The authoritative iPhone schema-1 V1 Export was received, but migration stopped before comparison. Issue #45 remains open. This rehearsal did not authorize or start production cutover.

## Authoritative iPhone Export intake

The immutable original was stored outside Git under `artifacts/private/`.

- SHA-256: `29667feba0cae76e2da9e0caf9c4d2c0e5fb3a082bdd72bf428bebe6b8ff4146`
- size: 63,999 bytes
- schemaVersion: 1
- exportedAt: `2026-09-20T07:44:43.297Z`
- Nodes: 125
- timestamps: zero invalid Node timestamps and zero invalid routineHistory timestamps
- unknown fields: zero

Validation stopped on `ipa-morning.parentId="ipa"`: the parent Category does not exist in the Export. Neither `ipa` nor `ipa-morning` exists in the 120-document Firestore snapshot. No timestamp, parent, Node or tombstone was repaired or dropped.

Because source validation must complete before comparison, the complete 125-vs-120 classification and migration were deliberately not run. The private failure report is `BLOCKED_SOURCE_VALIDATION`. The user must explicitly decide whether to remove the orphan, restore/create its intended parent, or provide a corrected authoritative Export; tooling must not infer that choice.

## Approved production migration scope

The user explicitly approved the following policy after the first rehearsal result.

- **MUST PRESERVE:** every Node in the selected schema-1 V1 Export, including Category, Memo, Idea, Routine, completion, deletion, purge tombstones, parent/rank, due fields, Routine fields and every other preserved field.
- **USER-APPROVED DATA LOSS / INTENTIONALLY NOT MIGRATED:** V1 device-local pinnedNote, V1 device-local ideasEnabled and legacyPinnedNoteCandidates.
- The initial V2 profile is deterministic: empty pinnedNote at the epoch default, `ideasEnabled=false`, and no recovery candidates. The user can enter/re-enable these after cutover through normal V2 sync.
- This exception applies only to the one production V1→V2 migration. It does not weaken schema-4 backup/import or normal V2 profile sync.

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

After the explicit non-migration policy was recorded, the same fresh 120-Node snapshot was rehearsed again with `--profile-policy=user-approved-non-migration`: backup 120, restore 120, migrate 120, semantic changes 0, lost fields 0, source issues 0, V1 rejection PASS and V2 smoke PASS. The report records `productionProfileMigrationPolicy=USER-APPROVED DATA LOSS`, profile `EXPECTED_NON_MIGRATED`, and candidate status `USER_APPROVED_DATA_LOSS`. This policy-adjusted Cloud rehearsal is PASS; the overall phase remains BLOCKED only until the authoritative iPhone Export is validated and compared.

## Superseded profile STOP and current STOP reason

V1 `pinnedNote`, `ideasEnabled`, and `legacyPinnedNoteCandidates` live in client AsyncStorage. The earlier run correctly refused to infer zero from missing Cloud data. The subsequent user decision explicitly accepts their loss, so they are now `EXPECTED_NON_MIGRATED / USER-APPROVED DATA LOSS`, not semantic loss or a blocker.

The previous missing-Export blocker is resolved. The current STOP is the invalid parent reference in the received authoritative source. Classification:

- source Node validation: `CLEAR`
- local profile inventory: `EXPECTED_NON_MIGRATED`
- legacy candidate status: `USER-APPROVED DATA LOSS`
- required action: make an explicit data decision for `ipa-morning`/`ipa`, obtain a corrected schema-1 Export or separately approved source transformation, then rerun intake before any full comparison
- final result: **BLOCKED**

No candidate is migrated, adopted, discarded, merged or timestamp-selected by tooling.

## Managed export / restore

Native Firestore managed export was not executed. The workstation has no Google Cloud CLI, and its bucket, billing and IAM prerequisites are not configured or authorized. For this single-user cutover, the approved fallback is the create-only raw REST JSON snapshot plus manifest/canonical hash and exact isolated restore. The file is written with exclusive-create semantics, is kept under restricted `artifacts/private/`, and is never overwritten by the scripts.

The fallback preserves raw Firestore documents, names/IDs, create/update metadata, field/value structure, nested data, timestamps and tombstones. It passed for all 120 Cloud V1 Nodes. Repeat it twice after the future freeze, require a stable canonical hash, create a second immutable rollback copy, and prove restore in a clean isolated target before migration.

## Profile and features scenarios

Generic V2 tests pass for pinnedNote persistence/restart, normal operation identity, self echo, duplicate handling, and bidirectional convergence. Generic feature tests pass for:

- existing Cloud value wins;
- no Cloud value plus legacy local `true` promotes `true`;
- no Cloud value plus legacy `false`/default emits no write.

The production V1 local values are intentionally excluded. V2 profile synchronization itself remains covered and starts from the deterministic defaults above.

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

The rollback backup restore passed for Cloud Nodes. Profile loss is approved. The backup must be repeated at the frozen cutover boundary and compared with the selected iPhone Export before it becomes the final rollback baseline.

## Problems found and corrected

The formal-source regression test first failed because no inventory classifier existed. The fix adds an explicit local-profile completeness marker and makes absent inventory fail closed. Three focused tests pass: absent inventory is unknown/blocked, non-empty candidates require user action, and only an explicit complete empty inventory is clear.

## Remaining blockers / required evidence

1. Resolve the authoritative source error for `ipa-morning.parentId="ipa"` without an automatic repair.
2. Rerun intake and compare it with the fresh Firestore snapshot; obtain an explicit source decision for every non-identical Node and never auto-merge.
3. Repeat snapshot/backup/restore after the future freeze and rehearse the selected complete Node source.
4. Collect canary probe/log counters and run the executable STOP assessment.
5. Only a validation-clean post-intake run can produce PASS/PASS WITH WARNINGS.
