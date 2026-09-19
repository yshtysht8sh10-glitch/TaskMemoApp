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

### 1. Read-only source snapshot

- Command: `npm run migration:production-read-only -- <private-output.json> read-only:taskmemoapp-eabc3`, with a short-lived OAuth token supplied only through the process environment.
- Target: production `taskmemoapp-eabc3`, Firestore `documents:runQuery` against collection group `nodes`.
- Expected: a private, gitignored snapshot; two consecutive reads produce the same canonical hash and count.
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
