# TaskMemo V2 production cutover runbook

Status: draft for human execution. Issue #45 remains open. Nothing here authorizes a production change.

## Safety invariants

- Use one unique `migrationId`; archive it with the backup manifest.
- A user gate is exactly V1 (`minimumSyncProtocol=1`, `v1WritesAllowed=true`, `v2Enabled=false`) or V2 (`2`, `false`, `true`). Other shapes fail closed.
- Global `syncControl/current.writesEnabled=false` is the maintenance freeze. There is no V1/V2 dual-write interval.
- Migration preserves Node IDs and imports at revision 0 using an ID-derived migration identity. The first V2 edit is revision 1; V1 cannot write `nodesV2`.
- After V2 edits, rollback keeps the V2 protocol and deploys a corrected/previous V2-compatible client. Re-enabling V1 would lose V2 revisions and is forbidden.

## Preflight and backup

1. Select and independently verify the exact production project ID and source commit.
   - Success: both values are recorded by the operator.
   - Stop: mismatch, uncommitted build, or missing operator review.
   - Rollback: none; read-only.
2. Run full tests, TypeScript, lint, diff check and production export with the production V2 flag off.
   - Success: every check passes and export hash is archived.
   - Stop: any failure.
3. Managed-export `users/{uid}/nodes`, sync metadata, any existing `nodesV2` / `syncOperationsV2`, and `syncControl/current` into a versioned restricted bucket. Store a canonical JSON manifest with document counts and SHA-256 hashes.
   - Success: export completes and manifest counts match read-only counts.
   - Stop: partial export, mismatch, or inaccessible generation.
4. Restore into a new non-production database and run semantic validation.
   - Success: IDs/counts/hashes match; parents, sort keys, deadline keys, histories, tombstones and unknown fields survive; lost-field count is zero.
   - Stop: any mismatch. Do not begin maintenance.
   - Rollback: discard only the isolated rehearsal target.

## Freeze, migrate, validate

5. Announce maintenance and set global `writesEnabled=false` with the reviewed admin procedure/rules.
   - Success: cached V1 and V2 probes are both denied writes while reads work.
   - Stop: either write succeeds. Keep maintenance enabled.
   - Rollback: restore the previous marker only if no migration write occurred.
6. Take a second post-freeze export/manifest and run the offline dry-run on that exact export.
   - Success: no duplicate/invalid/orphan/field-loss issue and source hash is recorded.
   - Stop: any issue or count divergence.
7. Write `nodesV2` using create-only/idempotent operations bound to `migrationId`; never delete V1. Set the per-user V2 marker only after all records validate.
   - Success: encode→migrate→decode is semantically identical and every marker is V2-only.
   - Stop: first error; keep writes frozen and retry only idempotently with the same ID.
   - Rollback before unfreeze: remove only records proven to belong to this migration, restore V1 markers, then validate against the post-freeze export.
8. Deploy reviewed production Rules while writes remain frozen.
   - Success: V1/malformed-gate probes are rejected and V2 remains frozen.
   - Stop: any unexpected allow/deny.

## Enable and monitor

9. Deploy the V2-capable client, change migrated users to V2-only, then set global `writesEnabled=true`.
   - Success: canary create/edit/Undo/Redo and two devices converge with empty outboxes.
   - Stop: listener errors, divergence, backlog growth, or any V1 write success.
10. Expand canaries while monitoring permission errors, operation latency, outbox depth, duplicate op IDs and count/hash drift.
   - Success: the agreed observation window has no unexplained error or drift.
   - Rollback: freeze writes, preserve current V2 data and receipts, and deploy the last known V2-compatible client. Never overwrite V2 edits with the old V1 backup.

## Emergency data recovery

Freeze writes, export current V2 state, preserve operation receipts, repair/replay into a separate validation target, and apply an audited forward repair only after semantic validation. The pre-cutover backup is a forensic baseline, not a safe rollback target after V2 edits.

