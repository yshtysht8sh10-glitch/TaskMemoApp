# TaskMemo V2 production cutover runbook

Status: formal-rehearsal PASS; reviewed admin commands are defined in [PRODUCTION_ADMIN_TOOLING.md](PRODUCTION_ADMIN_TOOLING.md). Production execution still requires runtime evidence, release artifacts and explicit authorization. Issue #45 remains open. Nothing here authorizes a production change.

## Project identity guard

| Role | Exact project | Permitted use before approval |
| --- | --- | --- |
| production | `taskmemoapp-eabc3` | read-only snapshot/query only |
| release candidate/dev | `taskmemoapp-dev` | RC Rules, seed user/data, Hosting |
| isolated rehearsal | `demo-taskmemo-rehearsal` | local emulator only |

At every step print and independently compare the project ID. STOP on any mismatch. Never reuse a production CLI command by editing only part of it.

## Rehearsed pre-cutover sequence

### Production migration scope

- MUST PRESERVE: all Nodes from the user-selected schema-1 V1 Export, including every Node subtype/state/tombstone/tree/rank/due/Routine field and any additional field proven preserved by the V2 codec.
- USER-APPROVED DATA LOSS: V1 local pinnedNote, V1 local ideasEnabled and legacyPinnedNoteCandidates. They are intentionally not migrated in this production cutover and are not counted as semantic loss.
- Initial V2 profile: pinnedNote empty, `ideasEnabled=false`, candidates empty. Schema-4 backup/import and normal V2 profile sync remain unchanged.

### Production client V2 selection contract

- An ordinary production build without `EXPO_PUBLIC_SYNC_V2_ENABLED=true` remains V1.
- A reviewed V2-capable production build requires the exact flag plus a valid production Firebase configuration. It then stays on the V2 path and calls `connect()`; it does not fall back to V1 if connection fails.
- Before any V2 read/write, `syncControl/current` must be schema 1 with `writesEnabled=true`, and the user gate must be schema 1 with `minimumSyncProtocol=2`, `v1WritesAllowed=false`, `v2Enabled=true`. Missing/malformed/dual-write/newer gates fail closed.

### 1. Read-only source snapshot

- Command: `npm run migration:production-read-only -- "$Cutover/preflight-production-v1.json" read-only:taskmemoapp-eabc3`, with a short-lived OAuth token supplied only through the process environment.
- Target: production `taskmemoapp-eabc3`, Firestore `documents:runQuery` against collection group `nodes`.
- Expected: a private, gitignored snapshot; two consecutive reads produce the same canonical hash and count.
- The Cloud reader must record `localProfileInventory.complete=false`. V1 pinnedNote, ideasEnabled and recovery candidates are device-local; absence from Firestore is not evidence of an empty value/candidate list.
- Validation: project identity, REST method, decoded document count, canonical SHA-256.
- STOP: any write-capable request in the script, project mismatch, unstable snapshot, authentication ambiguity.
- Rollback: none; the step is read-only. Delete only the local private snapshot if necessary.

### 2. Offline migration analysis

- Command: `npm run migration:analyze-production-snapshot -- "$Cutover/preflight-production-v1.json" "$Migration" "$Cutover/preflight-analysis.json"`.
- Target: local files only.
- Expected: equal input/output Node counts, zero changed/lost fields, zero semantic changes, zero orphan/unknown/unexpected records.
- Validation: inspect all reported counters and retained Node fields, including ID, `parentId`, `sortKey`, `deadlineSortKey`, deadline/due, `dayPart`, Routine configuration/history, completion, `deletedAt`, `purgedAt`, and unknown fields.
- STOP: **any** issue. On 2026-09-19 this initially stopped on deleted orphan `ipa-morning` → missing parent `ipa`; after its explicit owner-approved deletion, the fresh 120-Node snapshot passed with zero issues.
- Rollback: none; analysis is read-only. Escalate the exact source issue for an explicit data decision.

### 2a. Authoritative iPhone V1 Export intake

Run after receiving the file:

```powershell
npm run migration:intake-v1-export -- artifacts/private/iphone-v1-export-original-20260920.json "$Cutover/preflight-production-v1.json" "$Migration" "$Cutover/intake-report.json"
```

The command requires schema 1, validates exportedAt, all Nodes, IDs, types, required fields, dates, parent/category references, cycles, ranks, deleted/purged state and lossless codec behavior. It canonicalizes dates and object keys, compares every Node/field against the read-only Firestore snapshot, and classifies `IDENTICAL`, `EXPORT_ONLY`, `FIRESTORE_ONLY`, or `FIELD_DIFFERENCE`. The report is create-only and contains both values for private review. Any non-identical result exits with code 2 and requires an explicit user source decision; it never merges.

For the 2026-09-20 cutover source, the user approved the repaired iPhone Export as authoritative for all 4 Export-only and 110 field-difference Nodes. Prepare the private rehearsal bundle only with the exact reviewed hash/count/confirmation via `npm run migration:prepare-authoritative-rehearsal`. Firestore values must not be merged into that bundle.

### 3. Isolated backup and exact restore

- Command: start `firebase.rehearsal.json` with project `demo-taskmemo-rehearsal`, then run `npm run rehearsal:v2-cutover -- artifacts/private/iphone-authoritative-rehearsal-source-20260920.json "$Migration" "$Cutover/diagnostic-rehearsal-backup.json" "$Cutover/diagnostic-rehearsal-report.json" --continue-after-validation-stop=orphan-preservation-only` only when deliberately testing post-STOP mechanics.
- Target: local Auth/Firestore emulator only (9299/8280). Never substitute a deployable Firebase project.
- Expected: create-only backup; restore count/IDs/fields/values/nested values/tombstones/unknown fields are byte-semantically equal.
- Validation: automated recursive comparison. Formal post-cleanup result on 2026-09-19: 120/120 exact, 511.81 ms restore plus 222.10 ms validation.
- STOP: target is not `demo-taskmemo-rehearsal`, backup path already exists, or any equality/count mismatch.
- Rollback: stop emulator and discard only the isolated emulator data/private rehearsal artifacts.
- For this approved production policy, formal commands must include the explicit `--profile-policy=user-approved-non-migration` acknowledgement. Omitting it preserves the general fail-closed behavior for missing local profile inventory.

### 4. Freeze, migrate, validate and gate in rehearsal

- Command/operation: set emulator `syncControl/current.writesEnabled=false`; run V1→V2 create/import preserving IDs; compare all V2 records; set per-user compatibility to V2-only; re-enable writes.
- Target: `demo-taskmemo-rehearsal` only.
- Expected: zero semantic/lost-field change; old V1 read/write and tombstone resurrection rejected; real V2 adapter smoke operation applied.
- Validation: automated Rules assertions and adapter upload. Formal post-cleanup 2026-09-19 timings: migration 222.90 ms, validation 60.12 ms, gate 27.41 ms, freeze window 708.52 ms.
- STOP: any source issue in a formal rehearsal, partial migration, equality failure, old-client access, or V2 smoke failure. The orphan-preservation switch is diagnostic only and cannot produce cutover approval.
- Rollback: while frozen, remove only records proven to belong to that rehearsal migration. For production, preserve the post-freeze export and never infer ownership by timestamp alone.
- Legacy pinned-note recovery: the general rule remains to inspect/export every supported production client and never interpret missing inventory as zero. For this migration only, the user explicitly approved dropping `pinnedNote`, `ideasEnabled`, and `legacyPinnedNoteCandidates`; the expected V2 profile is therefore empty/`false`/empty. This exception must not weaken normal schema 4 export/import or profile synchronization.

### External AI phase policy

| Phase | External AI read/write |
| --- | --- |
| migration前（V1 gate） | V2 repositoryはfail-closed。V1 fallbackは禁止 |
| write freeze中 | read/writeとも停止し、AI requestを成功扱いにしない |
| V2 migration後・再開前 | V2 gateまたはglobal freezeにより停止 |
| V2 cutover後 | V2-only gate確認後、`nodesV2`とoperation/request receipt経由で許可 |
| rollback検討時 | まずfreezeしV2 winner/receiptを保存。AI変更をV1へ暗黙変換せず、forward migrationまたは監査付きreconciliationを行う |

FunctionsをV2対応版へ切り替えること自体もcutover操作である。V1期間へ先行deployしてV2 dataを書かせず、旧FunctionsをV2 cutover後に残してV1へ書かせない。rollbackでV1 snapshotを復元するとV2-only AI変更が失われるため、V2 edit後はV1への単純rollbackを禁止する。

## Production execution — requires separate authorization

## Final linear production runbook (operator path)

Use the fixed PowerShell variables and exact commands in [PRODUCTION_ADMIN_TOOLING.md](PRODUCTION_ADMIN_TOOLING.md). Angle-bracket examples in historical sections below are non-authoritative; no production operator step depends on them.

Before Phase 0, set `$Project`, `$Uid`, `$Migration`, `$Source`, and `$Cutover` exactly as documented there. `$Uid` must be supplied through `TASKMEMO_CUTOVER_UID`; empty or ambiguous identity fails closed.

Do not skip or reorder a phase. Record command output, UTC time, operator and artifact hashes in the private cutover log. Production is exactly `taskmemoapp-eabc3`. Strict Rules are `firestore.dev.rules` selected by `firebase.cutover.json`; Functions target is `functions:taskMemoMcp` in `asia-northeast1`. The authoritative input is the repaired 124-Node iPhone Export, SHA-256 `4da5ae29e427831025da485e40f84fc21180591421c40b26e62d3d7817bcae73`, migration ID `iphone-authoritative-20260920`.

> ## POINT OF NO RETURN
>
> **Before Phase 12's first acknowledged V2 write:** keep writes frozen. Manifest-owned V2 migration outputs may be removed, V1 gates/Rules restored, and the frozen V1 snapshot used for rollback.
>
> **After the first acknowledged V2 write:** never overwrite with an old V1 snapshot. Freeze, preserve `nodesV2`, `profileV2`, `syncOperationsV2`, `externalAiRequestsV2` and audit state, then perform audited forward reconciliation.

### Phase 0 — final preflight

- Command: `git status --short`; `git rev-parse HEAD`; `npm run verify:final-rc`.
- Production effect/access: none; local/Emulator only.
- Expected/PASS: clean tree, separately approved HEAD, all checks PASS, private artifacts readable with approved hashes.
- STOP: dirty tree, unapproved commit, failed required test, missing artifact, Java below 21.
- Rollback: none. Proceed only after operator and approver sign the preflight record.

### Phase 1 — begin V1 write freeze

- Commands: dry-run and then explicitly confirm `npm run admin:control-gate` action `v1-enabled`; run `npm run admin:protocol-probe` protocol 1 expectation `writable`; deploy strict Rules; run `admin:control-gate` action `freeze`; run the protocol 1 expectation `read-only` probe. Exact arguments/tokens are in the tooling document.
- Known Rules command: `npx firebase-tools deploy --project taskmemoapp-eabc3 --config firebase.cutover.json --only firestore:rules`.
- Production effect/access: **write + Rules deploy**.
- Expected/PASS: V1 gate is `{schemaVersion:1, minimumSyncProtocol:1, v1WritesAllowed:true, v2Enabled:false}`; after freeze every write fails and selected-protocol reads work.
- STOP: **one V1 write attempt after freeze**, a successful write, failed read, missing gate, project mismatch or ambiguous Rules version.
- Rollback: before migration, restore `writesEnabled=true`, previous Rules and V1 gate only after proving no migration write. Proceed only with stable freeze evidence.
- Formal commands: `admin:control-gate` and `admin:protocol-probe`; see the tooling document. Proceed only after their dry-run audit and exact confirmation tokens are independently reviewed.

### Phase 2 — two post-freeze snapshots

- Commands: `npm run migration:production-read-only -- "$Cutover/freeze-a.json" read-only:taskmemoapp-eabc3` and the same with `"$Cutover/freeze-b.json"`; token only via `GOOGLE_OAUTH_ACCESS_TOKEN`.
- Production effect/access: read-only `documents:runQuery` on collection group `nodes`.
- Expected/PASS: both exclusive-create private snapshots complete after freeze.
- STOP: credential ambiguity, writer code, project mismatch, API failure or any V1 write-attempt signal.
- Rollback: none; remain frozen. Proceed only with both snapshots.

### Phase 3 — count/canonical-hash stability

- Command: run `npm run admin:compare-snapshots` with the exact tooling-document arguments and approved expected count.
- Production effect/access: none.
- Expected/PASS: equal count, IDs and canonical SHA-256.
- STOP: any mismatch or unexplained update. Rollback: remain frozen.
- Formal command: `admin:compare-snapshots`; expected count, IDs and canonical hash must all match.

### Phase 4 — immutable backup

- Command: run `npm run admin:seal-backup` exactly as documented, then apply the separately approved restricted/immutable filesystem retention control.
- Production effect/access: none.
- Expected/PASS: hashes match manifest; destination is immutable/restricted.
- STOP: overwrite, mutable destination, hash/count mismatch or missing raw metadata. Rollback: create a new destination while frozen.
- Approved fallback: raw REST JSON + manifest + exact isolated restore; managed export is optional unless separately authorized.
- Formal command: `admin:seal-backup`. The command is create-only; the operator must additionally prove destination retention/IAM immutability.

### Phase 5 — isolated backup restore

- Command: start `firebase.rehearsal.json` on `demo-taskmemo-rehearsal`, then run `npm run rehearsal:v2-cutover -- artifacts/private/iphone-authoritative-rehearsal-source-20260920.json iphone-authoritative-20260920 "$Cutover/isolated-restore-backup.json" "$Cutover/isolated-restore-report.json" --validation-must-pass --profile-policy=user-approved-non-migration`.
- Production effect/access: none; Emulator only.
- Expected/PASS: backup/restored/migrated 124/124, all fields equal, semantic/lost 0 and integration PASS.
- STOP: wrong target or any count/hash/semantic/field/client failure. Rollback: stop Emulator; remain frozen.

### Phase 6 — authoritative source final check

- Command: `Get-FileHash -Algorithm SHA256 artifacts/private/iphone-v1-export-repaired-drop-ipa-morning-20260920.json`; rerun `npm run migration:prepare-authoritative-rehearsal` with its exact documented confirmation.
- Production effect/access: none.
- Expected/PASS: approved SHA, 124 Nodes, comparison 10/4/0/110, semantic/lost 0, `ipa-morning` absent.
- STOP: any byte/count/comparison change. Rollback: remain frozen; no new repair without approval.

### Phase 7 — production V1→V2 migration

- Command: run the documented `npm run admin:migrate-v2` dry-run; after its audit is independently approved, run the exact write form with its source-bound confirmation token.
- Production effect/access: **Admin write** to `users/{uid}/nodesV2`; create-only/idempotent revision-0 records with deterministic identity; no profile migration.
- Expected/PASS: exactly 124 manifest-bound records, no extras, writes remain frozen.
- STOP: first write error, conflicting V2 record, count/project/UID/migration-ID mismatch.
- Rollback: pre-Phase-12 only, remove exact manifest-owned outputs and validate V1 snapshot.
- Formal command: `admin:migrate-v2`. Dry-run is default; the write form uses one create-only atomic commit and exact source confirmation.

### Phase 8 — immediate migration validation

- Command: run the documented `npm run admin:validate-v2` command.
- Production access: read-only `nodesV2` plus manifest/profile/control/gate inventory.
- Expected/PASS: all 124 records equal authoritative V2 values; 12 Category, 111 Task, 1 Idea, 12 Routine, 98 active, 13 completed, 22 deleted, 4 purged, 25 routineHistory; semantic/lost 0; approved default profile.
- STOP: any missing/extra/change, tombstone revival, revision/identity mismatch.
- Rollback: remain frozen; pre-PONR manifest rollback allowed.
- Formal command: `admin:validate-v2`.

### Phase 9 — protocol components

- Rules: Phase-1 artifact must still match `firebase.cutover.json`.
- Gate: set `{schemaVersion:1, minimumSyncProtocol:2, v1WritesAllowed:false, v2Enabled:true}` while global writes remain false.
- Functions command: `npx firebase-tools deploy --project taskmemoapp-eabc3 --config firebase.cutover.json --only functions:taskMemoMcp`.
- Production effect/access: gate write + Functions deploy.
- Expected/PASS: V1 read/write rejected; V2 read allowed/write rejected; External AI fails closed while frozen.
- STOP: any V1 access, V2 write success, V1 Functions behavior, target/region mismatch.
- Rollback: pre-PONR restore V1 gate and approved prior Functions artifact while frozen.
- Gate/probes now use the formal admin commands. Phase remains BLOCKED until read-only Functions metadata is tied to an independently restorable source artifact and deployment receives separate authorization.

### Phase 10 — read-only V2 canary

- Command: run documented `npm run admin:canary` read mode, then open the separately approved production V2 client with exact production config and V2 flag while global writes remain frozen.
- Production access: read-only through strict Rules.
- Expected/PASS: 124 Nodes and empty/false/zero profile render; outbox empty; no receipt created.
- STOP: attempted write, wrong state/count, crash, permission mismatch or outbox item.
- Rollback: close client and restore pre-PONR configuration while frozen.
- Artifact definitions are fixed: EAS profile `production-v2-cutover` and `npm run web:export:production-v2`. Phase remains BLOCKED until both are built, hashed and approved in a separately authorized turn.

### Phase 11 — pre-write diagnostics

- Commands: run documented `npm run admin:collect-diagnostics`, then `npm run diagnostics:cutover -- "$Cutover/diagnostic-input.json" "$Cutover/diagnostic-decision.json"`.
- Production access: read-only logs/receipts/state collection.
- PASS: `CONTINUE`; all critical counts zero; outboxes empty; hashes converge.
- STOP: any critical count or mismatch. Rollback: remain frozen. Proceed only with explicit first-write approval.
- Formal collector: `admin:collect-diagnostics`; its create-only evidence feeds `diagnostics:cutover`.

### Phase 12 — first V2 write (**POINT OF NO RETURN**)

- Commands: run `admin:control-gate` action `v2-enabled` with exact precondition/confirmation, then run the documented `admin:canary` write form using `approved-canary-operation.json` and its SHA-bound PONR token.
- Production effect/access: V2 write.
- PASS: one winner revision advance and matching immutable receipt; no V1 change; outbox drains.
- STOP: ambiguity, duplicate/missing receipt, wrong revision/Node, V1 attempt or timeout.
- Rollback: **never restore V1**; set writes false, preserve V2/receipts, forward-reconcile.
- Formal command: `admin:canary --canary-mode write`; the independently reviewed operation artifact hash is part of the `POINT-OF-NO-RETURN` confirmation.

### Phase 13 — post-write integrity

- Command: repeat the exact Phase 11 collector/analyzer commands after the listed canary and Functions idempotent-retry operations.
- Production access: read-only checks plus explicitly listed canary operations.
- PASS: exact receipt/revision, convergence, empty outboxes, complete Functions transaction, no V1 attempt.
- STOP: any critical signal. Rollback: freeze and forward-reconcile only.

### Phase 14 — normal-operation release

- Operation: retain V2-only gates/writes; release only approved V2 clients. Never enable V1 or dual-write.
- PASS: clean canary observation and diagnostic `CONTINUE`.
- STOP: any critical signal. Rollback: freeze, preserve V2, use a V2-compatible client/forward fix.

### Phase 15 — post-cutover monitoring

- Command: repeat the exact Phase 11 collector/analyzer commands at approved intervals; retain receipts indefinitely.
- PASS: zero critical events, stable revisions/counts, drained outboxes and convergence.
- STOP: any immediate-STOP event. Rollback: freeze and forward-reconcile.

### Phase 16 — #45 close decision

- Production effect: none. Close only after all acceptance evidence exists and the observation window completes.

## #45 acceptance checklist

- [ ] Approved commit/artifacts/project IDs recorded; `verify:final-rc` PASS.
- [ ] Freeze-capable Rules, control/gate writer and probes reviewed/tested.
- [ ] Post-freeze V1 attempts zero; two snapshots have identical canonical hash/count.
- [ ] Immutable backup manifest and isolated restore PASS.
- [ ] Authoritative hash equals `4da5...cae73`; `ipa-morning` absent.
- [ ] Migration creates exactly 124 V2 Nodes; semantic/lost zero and expected inventory exact.
- [ ] Initial profile is empty/false/zero.
- [ ] Strict Rules reject V1/invalid V2 and allow selected V2 read while frozen.
- [ ] V2 client, Functions and rollback artifacts approved.
- [ ] Pre-write diagnostics `CONTINUE`; explicit PONR approval recorded.
- [ ] First V2 write has exact winner/revision/receipt and empty outbox.
- [ ] Two clients and External AI converge; no V1 attempt/partial transaction.
- [ ] Observation window completes without STOP signal.
- [ ] Backups, manifests, receipts, audit and operator log retained.

The older production notes below are background; these numbered phases are authoritative.

### 5. Preflight and managed backup

- Command/operation: record reviewed commit and migration ID; run full tests/type/lint/export; create a managed Firestore export of V1 Nodes, sync metadata, any V2 collections, operations, and global control into a versioned restricted bucket.
- Target: `taskmemoapp-eabc3`.
- Expected: manifest counts/hashes equal the post-freeze read-only inventory; restore of that exact export succeeds in a fresh isolated target.
- STOP: dirty/unreviewed commit, current orphan or any validation issue, partial export, count/hash mismatch, or inaccessible export generation.
- Rollback: none before writes; retain the backup and abort.

### 6. Production write freeze

- Command/operation: deploy the separately reviewed production maintenance control/Rules and set `writesEnabled=false`.
- Target: `taskmemoapp-eabc3` only.
- Expected: cached V1 and V2 probes cannot write; required reads remain available.
- Validation: two authenticated protocol probes plus a fresh post-freeze export/hash.
- STOP: either write succeeds, snapshot differs unexpectedly, or maintenance state is uncertain.
- Rollback: restore the previous control only if no migration write occurred; otherwise remain frozen.

### Rules deployment order

1. While the existing broad production Rules remain active, create `syncControl/current` and a V1 gate for every in-scope user (`minimumSyncProtocol=1`, `v1WritesAllowed=true`, `v2Enabled=false`, writes enabled).
2. Verify current V1 clients still read/write, then deploy the separately reviewed strict artifact with `--config firebase.cutover.json --only firestore:rules`. This repository preparation does not authorize that deploy.
3. Set `writesEnabled=false`. Under strict Rules the selected protocol remains readable for frozen-state validation, while all V1 and V2 client writes stop; Admin migration remains responsible for its own project/manifest validation.
4. Migrate and validate while frozen. Switch each validated user gate atomically to V2-only, deploy the reviewed V2 client/Functions artifacts in the documented order, then set `writesEnabled=true`.
5. Prove V1 read/listen/write rejection and V2 gate acceptance before observation begins.
6. Before any migration write, rollback Rules may return to the prior artifact and V1 gates. After migration writes, remain frozen and follow audited reconciliation; after V2 edits, never restore V1 over V2.

Client access to `externalAiRequestsV2` is denied explicitly. External-AI Functions use Admin SDK and must enforce global/user gates, UID/request identity, revision and idempotency inside their transaction; Rules do not validate Admin SDK calls.

### 7. Production migration and Rules

- Command/operation: dry-run the post-freeze export, then perform create-only/idempotent V2 writes bound to the recorded migration ID; validate before setting user gates; deploy reviewed V2 Rules while still frozen.
- Target: `taskmemoapp-eabc3`.
- Expected: equal counts and semantic content, zero validation issues, V1/malformed gates rejected, V2 still frozen.
- STOP: first issue/error; keep writes frozen. Retry only idempotently with the same migration ID.
- Rollback before unfreeze: remove only records cryptographically/manifest-proven to belong to this migration, restore V1 gates, and validate against the post-freeze export.

### 8. Client enablement and observation

- Command/operation: deploy the separately approved V2 production clients, change migrated users to V2-only, then re-enable writes.
- Target: `taskmemoapp-eabc3` and explicitly approved production release channels.
- Expected: canary create/edit/Undo/Redo and multi-device convergence with empty outboxes.
- STOP: permission errors, divergence, backlog growth, duplicate operation IDs, count/hash drift, or any V1 access.
- Rollback after V2 edits: freeze writes, preserve current V2 state/receipts, and deploy a known V2-compatible client. Never restore V1 over V2 revisions.

## Emergency data recovery

Freeze writes, export current V2 state, preserve operation receipts, repair/replay in a separate validation target, then apply an audited forward repair. The pre-cutover backup is a forensic baseline, not a safe rollback target after V2 edits.

## Receipt retention

At initial cutover, retain `syncOperationsV2` and `externalAiRequestsV2` indefinitely; do not configure TTL. Cleanup is permitted only after a maximum retry age is enforced, a diagnostic archive exists, the observation/rollback window is closed, and every supported producer is unable to replay the receipt ID. After those prerequisites, retain online receipts for at least 180 days and archive before deletion. Until then, deleting a receipt can cause a duplicate create/update.

## Monitoring and immediate STOP

Before cutover, implement alerts/queries for sync errors, rejected operations, revision conflicts/regressions, outbox age/count, missing or mismatched receipts, V1 write attempts, schema/owner validation failures, convergence failures and Functions transaction errors. During canary, immediately freeze on any V1 write attempt, schema/owner failure, missing receipt after acknowledgement, unexplained revision regression, convergence mismatch, permanent sync error, partial AI transaction, or an online canary outbox pending for five minutes. Transient retries are acceptable only when they drain and all clients converge.

Collect a private diagnostic JSON from the client status/export, read-only receipt inventory and Firebase/Cloud Functions logs, then run:

```powershell
npm run diagnostics:cutover -- "$Cutover/diagnostic-input.json" "$Cutover/diagnostic-decision.json"
```

Input shape:

```json
{
  "capturedAt": "ISO timestamp",
  "events": [{ "kind": "v1-write-attempt", "count": 0 }],
  "clients": [{ "id": "canary-a", "syncPhase": "synced", "outboxOldestAgeMs": 0, "networkConfirmedOnline": true, "convergenceHash": "sha256" }]
}
```

Use Firestore/Cloud Logging around the recorded cutover timestamp: client permission/rejection logs for V1 and schema failures; `syncOperationsV2` opId/ack pairs for missing receipts; node/profile revision snapshots for regression; `externalAiRequestsV2` plus `syncOperationsV2` plus winner/audit for AI transaction completeness; Functions error logs for request failures. Record each canary's sync phase, oldest pending outbox age, confirmed network state and canonical authoritative-state hash. One critical counter, differing hashes, a permanent client error, or an online outbox older than 300000 ms produces `STOP`.

## Final RC automated verification

With Java 21+ installed, run `npm run verify:final-rc`. It runs TypeScript/lint/unit/Functions checks, then strict-Rules Emulator application and Functions integration. Together these cover schema-1 migration units, V2 Node/profile sync, Undo/Redo, offline/reconnect, restart recovery, gate/Rules, External AI, V1 rejection/no fallback and two-client convergence. The formal snapshot rehearsal separately proves create-only backup/restore and pre-write rollback using the selected private source.
