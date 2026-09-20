# TaskMemo production admin tooling

These commands prepare Issue #45 cutover operations. They do not authorize production use. Exit `0` means PASS, `2` means a safe STOP decision, and `1` means invalid input/tool failure. Audit files are create-only and omit keys containing token, authorization, or secret.

## Fixed identity

```powershell
$Project = 'taskmemoapp-eabc3'
$Uid = $env:TASKMEMO_CUTOVER_UID
$Migration = 'iphone-authoritative-20260920'
$Source = 'artifacts/private/iphone-v1-export-repaired-drop-ipa-morning-20260920.json'
$Cutover = 'artifacts/private/production-cutover-20260920'
```

Every command requires both `--project` and `--expected-project`, an explicit UID and migration ID. The source must have SHA-256 `4da5ae29e427831025da485e40f84fc21180591421c40b26e62d3d7817bcae73` and exactly 124 Nodes. `GOOGLE_OAUTH_ACCESS_TOKEN` is used for Admin REST operations and `FIREBASE_ID_TOKEN` for Rules-visible probes; neither is written to reports.

## Commands

| Tool | Command | Default / confirmation |
| --- | --- | --- |
| Control/gate | `npm run admin:control-gate -- -- --project $Project --expected-project $Project --uid $Uid --migration-id $Migration --action freeze --audit "$Cutover/control-freeze-dry.json"` | dry-run. Write adds `--mode write --expected-current "$Cutover/control-before.json" --expected-current-sha $ControlBeforeSha --confirm "CONTROL:$Project:$Uid:$Migration:freeze"`. The expected-current file is `{control,gate}` and is checked against update-time preconditions before one atomic commit. |
| Protocol probe | `npm run admin:protocol-probe -- -- --project $Project --expected-project $Project --uid $Uid --migration-id $Migration --protocol 1 --expect read-only --probe-write --confirm "PROBE:$Project:$Uid:$Migration:1:read-only" --audit "$Cutover/probe-v1-frozen.json"` | Authenticated Rules-visible probe. Before freeze use expectation `writable` and token suffix `1:writable`; its unique V1 marker is deleted and cleanup failure is FAIL. After freeze the write must be rejected. V2's first allowed write is tested only by the PONR canary. |
| Snapshot comparison | `npm run admin:compare-snapshots -- -- --project $Project --expected-project $Project --uid $Uid --migration-id $Migration --first "$Cutover/freeze-a.json" --second "$Cutover/freeze-b.json" --expected-count 120 --audit "$Cutover/snapshot-comparison.json"` | read-only/local. Count, exact ID set and canonical SHA must all match. `120` is the latest approved pre-freeze baseline; a future legitimate change requires a new human-approved expected count, never automatic acceptance. |
| Backup manifest | `npm run admin:seal-backup -- -- --project $Project --expected-project $Project --uid $Uid --migration-id $Migration --snapshot "$Cutover/freeze-b.json" --comparison "$Cutover/snapshot-comparison.json" --source $Source --expected-count 120 --acquired-at $FreezeCapturedAt --manifest "$Cutover/immutable-backup-manifest.json" --audit "$Cutover/backup-seal-audit.json"` | local/create-only. Requires the PASS pair-comparison audit and records project, UID, acquisition time, counts, canonical/byte/source hashes, tool version, commit and migration ID. Filesystem retention/IAM immutability must be proven separately. |
| Migration | `npm run admin:migrate-v2 -- -- --project $Project --expected-project $Project --uid $Uid --migration-id $Migration --source $Source --audit "$Cutover/migration-dry.json"` | dry-run. Write requires `--mode write --confirm "MIGRATE:$Project:$Uid:$Migration:4da5ae29e427831025da485e40f84fc21180591421c40b26e62d3d7817bcae73"`. All 124 create-only writes use one Firestore commit. Retry validates an already-complete exact set; partial/different state STOPs. |
| V2 validator | `npm run admin:validate-v2 -- -- --project $Project --expected-project $Project --uid $Uid --migration-id $Migration --source $Source --audit "$Cutover/v2-validation.json"` | read-only. Exact ID/record values and approved empty/false/zero profile are required. |
| Diagnostic collector | `npm run admin:collect-diagnostics -- -- --project $Project --expected-project $Project --uid $Uid --migration-id $Migration --client-evidence "$Cutover/client-evidence.json" --evidence "$Cutover/diagnostic-input.json" --audit "$Cutover/diagnostic-collection.json"` then `npm run diagnostics:cutover -- "$Cutover/diagnostic-input.json" "$Cutover/diagnostic-decision.json"` | read-only. Client evidence must explicitly include V1 attempts, schema/owner failures, permanent errors, outbox age/status and convergence hash. Cloud receipts/revisions/Functions requests are collected and correlated. |
| Read canary | `npm run admin:canary -- -- --project $Project --expected-project $Project --uid $Uid --migration-id $Migration --canary-mode read --audit "$Cutover/canary-read.json"` | read-only; expected 124 Nodes while globally frozen. |
| First-write canary | `npm run admin:canary -- -- --project $Project --expected-project $Project --uid $Uid --migration-id $Migration --canary-mode write --operation "$Cutover/approved-canary-operation.json" --audit "$Cutover/canary-write-dry.json"` | dry-run. The write form adds `--mode write --confirm "POINT-OF-NO-RETURN:$Project:$Uid:$Migration:$CanaryOperationSha"` and a new audit path. It requires a V2-enabled gate, global writes enabled, exact Node update-time, and atomically writes the winner plus create-only receipt. |

The approved canary operation JSON contains `uid`, `migrationId`, `opId`, `nodeId`, `expectedUpdateTime`, the complete next `record`, and complete `operation`. It must be independently reviewed and hashed. Executing its write form crosses the POINT OF NO RETURN.

## Production client artifacts

- Android: `eas build --platform android --profile production-v2-cutover`. The profile selects EAS production environment, sets `EXPO_PUBLIC_SYNC_V2_ENABLED=true`, and uses release channel `production-v2-cutover`. Build, install and approval remain future authorized actions.
- PWA: `npm run web:export:production-v2`. It requires `.env.local` to identify production and `taskmemoapp-eabc3`, exports locally with the V2 flag, and verifies Firebase values in the bundle. Hosting deployment is separate and prohibited during preparation.
- Both artifacts must record commit, artifact hash/build ID, Firebase project, environment, V2 flag and manual startup/read-only-canary results before Phase 10.

## Functions rollback evidence

Run read-only metadata capture only when authorized:

```powershell
npm run admin:capture-functions-rollback -- taskmemoapp-eabc3 taskmemoapp-eabc3 "$Cutover/functions-before.json" read-only:functions:taskmemoapp-eabc3:asia-northeast1:taskMemoMcp
```

The metadata identifies the deployed `taskMemoMcp` revision/build/service configuration but is not itself a restorable source artifact. Before Functions deployment, retain and verify the exact source archive/commit and dependencies matching that deployed revision, and rehearse its deploy command in a non-production project. If the deployed revision cannot be tied to a restorable source artifact, Phase 9 remains BLOCKED.

## Remaining runtime inputs

The UID, short-lived credentials, freeze acquisition timestamp, current control/gate precondition artifact, canary operation and its hash are intentionally not guessed or committed. Their absence before an authorized cutover is a STOP, not a reason to edit these commands ad hoc.
