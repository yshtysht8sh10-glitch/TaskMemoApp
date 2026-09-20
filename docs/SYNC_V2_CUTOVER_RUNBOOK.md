# TaskMemo V2 production cutover runbook

Status: rehearsal-validated draft. Issue #45 remains open. Nothing here authorizes a production change.

## Project identity guard

| Role | Exact project | Permitted use before approval |
| --- | --- | --- |
| production | `taskmemoapp-eabc3` | read-only snapshot/query only |
| release candidate/dev | `taskmemoapp-dev` | RC Rules, seed user/data, Hosting |
| isolated rehearsal | `demo-taskmemo-rehearsal` | local emulator only |

At every step print and independently compare the project ID. STOP on any mismatch. Never reuse a production CLI command by editing only part of it.

## Rehearsed pre-cutover sequence

### Production client V2 selection contract

- An ordinary production build without `EXPO_PUBLIC_SYNC_V2_ENABLED=true` remains V1.
- A reviewed V2-capable production build requires the exact flag plus a valid production Firebase configuration. It then stays on the V2 path and calls `connect()`; it does not fall back to V1 if connection fails.
- Before any V2 read/write, `syncControl/current` must be schema 1 with `writesEnabled=true`, and the user gate must be schema 1 with `minimumSyncProtocol=2`, `v1WritesAllowed=false`, `v2Enabled=true`. Missing/malformed/dual-write/newer gates fail closed.

### 1. Read-only source snapshot

- Command: `npm run migration:production-read-only -- <private-output.json> read-only:taskmemoapp-eabc3`, with a short-lived OAuth token supplied only through the process environment.
- Target: production `taskmemoapp-eabc3`, Firestore `documents:runQuery` against collection group `nodes`.
- Expected: a private, gitignored snapshot; two consecutive reads produce the same canonical hash and count.
- The Cloud reader must record `localProfileInventory.complete=false`. V1 pinnedNote, ideasEnabled and recovery candidates are device-local; absence from Firestore is not evidence of an empty value/candidate list.
- Validation: project identity, REST method, decoded document count, canonical SHA-256.
- STOP: any write-capable request in the script, project mismatch, unstable snapshot, authentication ambiguity.
- Rollback: none; the step is read-only. Delete only the local private snapshot if necessary.

### 2. Offline migration analysis

- Command: `npm run migration:analyze-production-snapshot -- <private-snapshot.json> <private-report.json>`.
- Target: local files only.
- Expected: equal input/output Node counts, zero changed/lost fields, zero semantic changes, zero orphan/unknown/unexpected records.
- Validation: inspect all reported counters and retained Node fields, including ID, `parentId`, `sortKey`, `deadlineSortKey`, deadline/due, `dayPart`, Routine configuration/history, completion, `deletedAt`, `purgedAt`, and unknown fields.
- STOP: **any** issue. On 2026-09-19 this initially stopped on deleted orphan `ipa-morning` → missing parent `ipa`; after its explicit owner-approved deletion, the fresh 120-Node snapshot passed with zero issues.
- Rollback: none; analysis is read-only. Escalate the exact source issue for an explicit data decision.

### 3. Isolated backup and exact restore

- Command: start `firebase.rehearsal.json` with project `demo-taskmemo-rehearsal`, then run `npm run rehearsal:v2-cutover -- <snapshot> <migrationId> <new-backup> <new-report> --continue-after-validation-stop=orphan-preservation-only` only when deliberately testing post-STOP mechanics.
- Target: local Auth/Firestore emulator only (9299/8280). Never substitute a deployable Firebase project.
- Expected: create-only backup; restore count/IDs/fields/values/nested values/tombstones/unknown fields are byte-semantically equal.
- Validation: automated recursive comparison. Formal post-cleanup result on 2026-09-19: 120/120 exact, 511.81 ms restore plus 222.10 ms validation.
- STOP: target is not `demo-taskmemo-rehearsal`, backup path already exists, or any equality/count mismatch.
- Rollback: stop emulator and discard only the isolated emulator data/private rehearsal artifacts.

### 4. Freeze, migrate, validate and gate in rehearsal

- Command/operation: set emulator `syncControl/current.writesEnabled=false`; run V1→V2 create/import preserving IDs; compare all V2 records; set per-user compatibility to V2-only; re-enable writes.
- Target: `demo-taskmemo-rehearsal` only.
- Expected: zero semantic/lost-field change; old V1 read/write and tombstone resurrection rejected; real V2 adapter smoke operation applied.
- Validation: automated Rules assertions and adapter upload. Formal post-cleanup 2026-09-19 timings: migration 222.90 ms, validation 60.12 ms, gate 27.41 ms, freeze window 708.52 ms.
- STOP: any source issue in a formal rehearsal, partial migration, equality failure, old-client access, or V2 smoke failure. The orphan-preservation switch is diagnostic only and cannot produce cutover approval.
- Rollback: while frozen, remove only records proven to belong to that rehearsal migration. For production, preserve the post-freeze export and never infer ownership by timestamp alone.
- Legacy pinned-note recovery: inspect/export every supported production client. Missing local inventory is `UNKNOWN` and stops a formal run; it must never be interpreted as zero candidates. A non-empty inventory is `USER_ACTION_REQUIRED` and also stops. The user must compare and explicitly adopt or discard; adopting emits a normal pinned-note V2 operation. Never auto-merge or delete candidates at cutover.

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
3. Set `writesEnabled=false`. Under strict Rules both V1 and V2 client reads/writes stop; Admin migration remains responsible for its own project/manifest validation.
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
