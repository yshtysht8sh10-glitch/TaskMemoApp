# TaskMemoApp V1 / Legacy Inventory

Status: 2026-09-19, commit `878ac3f7db92ac259600d30ed6a56f55a6c4ab3f`. Issue #45 remains open. This document is an inventory and does not authorize deletion, migration, gate changes, deployment, or production writes.

## Purpose and classification

This document identifies legacy/V1 runtime paths, storage, compatibility code, recovery state, migration and rollback assets. “Legacy” does not mean disposable. Production currently uses V1 Cloud Sync, so preservation of `users/{uid}/nodes` and the code that can read and validate it takes priority.

| Code | Meaning |
| --- | --- |
| A | Required for production migration |
| B | Required for rollback/recovery planning |
| C | Required to rescue old user data |
| D | Required for backward compatibility |
| E | Used by a normal runtime today |
| F | Removable only after V2 stability and the retention period |
| G | Appears unnecessary now; removal still requires a separate review |
| H | Decision or additional investigation required |

An item may have multiple classifications.

## Executive findings

1. Production remains V1 by default. A production build selects V2 only with the exact explicit flag; the server gate is then mandatory and failures remain on the V2 fail-closed path.
2. There is no “V2 request failed, then write V1 Cloud” branch. Once `useV2` is true, V1 Firebase sync is disabled and V2 commands refuse to mutate through the V1 route while initialization is unavailable.
3. A missing/invalid Firebase configuration makes `useV2` false. This gives a local-only V1-shaped AsyncStorage runtime, not a V1 Cloud write. It can nevertheless create a separate local state after cutover and needs an explicit product decision.
4. The currently deployed/default `firestore.rules` remains the broad V1-era rule. A strict, tested cutover artifact is prepared through `firebase.cutover.json` → `firestore.dev.rules`; it must be deployed only after explicit V1 gates/control are provisioned.
5. The Node migration planner and formal Emulator rehearsal still pass on latest HEAD for 120 production-derived V1 Nodes. They cover Nodes, tombstones, field equality, V1 rejection and one V2 Node smoke operation. They do **not** yet constitute complete latest-schema cutover evidence for `profileV2/pinnedNote`, `profileV2/features`, external-AI Functions, or a production client that can select V2.
6. There is no general executable V2-to-V1 rollback. The runbook correctly prohibits restoring an old V1 snapshot after V2 edits; recovery is freeze + preserve V2 + audited forward repair.

## Firestore path inventory

| Path | Generation / content | Readers | Writers | Migration | Rollback / recovery | Normal runtime now | Needed after cutover | Class |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `users/{uid}/nodes/{nodeId}` | V1 Nodes | `useFirebaseSync`; production snapshot/rehearsal | `useFirebaseSync`; rehearsal seed | Primary production source | Pre-cutover forensic baseline only | Yes: production and any non-V2-configured dev client | Retain read-only for an approved evidence window; deny clients after gate | A, B, C, E, F |
| `users/{uid}/nodesV2/{nodeId}` | V2 versioned Nodes | V2 app adapter; external-AI repository; validators | V2 app transaction; external-AI transaction; migration/rehearsal | Destination | Authoritative recovery source after V2 edits | Yes in dev/RC; not selectable by production client yet | Yes | A, B, E |
| `users/{uid}/syncOperationsV2/{opId}` | Immutable operation/ack receipts | V2 adapter transaction; tests/diagnostics | V2 app and external-AI transactions | No receipt is produced for revision-0 migration records | Preserve for idempotency and forensic replay | Yes in V2 | Yes; retention policy undecided | B, E, H |
| `users/{uid}/profileV2/pinnedNote` | Versioned pinned note | V2 adapter/listener | V2 app operation transaction | Client-side legacy pinned-note migration | Authoritative after first V2 sync | Dev/RC V2 | Yes | A, C, E |
| `users/{uid}/profileV2/features` | Versioned `ideasEnabled` | V2 adapter/listener | V2 app operation transaction | Client-side deterministic legacy preference migration | Authoritative after first V2 sync | Dev/RC V2 | Yes | A, C, E |
| `users/{uid}/syncMetadataV2/compatibility` | Per-user protocol gate | V2 app, Functions, Rules | Admin/provisioning/rehearsal only | Switched only after validation | Determines allowed recovery client | Dev/RC/rehearsal | Yes while compatibility is enforced | A, B, E |
| `syncControl/current` | Global write/freeze control | V2 app, Functions, Rules | Admin/provisioning/rehearsal only | Freeze/re-enable boundary | Freeze before any recovery | Dev/RC/rehearsal | Yes | A, B, E |
| `users/{uid}/externalAiRequestsV2/{requestId}` | External-AI idempotent request receipt | external-AI Functions transaction | external-AI Functions transaction | Not part of V1 Node migration | Preserve after AI writes | Implemented; production deployment status must be checked at cutover | Yes if external AI is enabled | B, E, H |
| `users/{uid}/externalAiAuditLogs/{id}` | External-AI audit | owner client Rules/read tooling | external-AI Functions only | No | Recovery/forensics | Implemented server path | Yes if external AI is enabled | B, E, H |
| `externalAiOAuthClients/{clientId}` | OAuth client registry | OAuth Functions | OAuth Functions/admin flow | No | Security configuration | Functions path | Yes if external AI is enabled | E, H |
| `externalAiOAuthRequests/{id}` | Temporary OAuth authorization request | OAuth Functions | OAuth Functions | No | No, beyond expiry/audit policy | Functions path | Yes while OAuth is enabled | E, F |
| `externalAiOAuthCodes/{hash}` | One-time OAuth code | OAuth Functions | OAuth Functions | No | No, beyond expiry/audit policy | Functions path | Yes while OAuth is enabled | E, F |
| `externalAiOAuthTokens/{hash}` | Hashed access/refresh-token metadata | OAuth Functions | OAuth Functions | No | Revocation/security investigation | Functions path | Yes while external AI is enabled | B, E |

Authentication is Firebase Auth state, not a Firestore path. Dev verification and RC repair scripts additionally address the paths above through REST; they do not introduce another data model.

### Rules/configuration boundary

| Asset | Current role | Classification |
| --- | --- | --- |
| `firestore.rules` via `firebase.json` | Current production owner-only wildcard rule; permits any authenticated owner read/write under `users/{uid}/**` | A, E; **must be replaced/reviewed before cutover**, not deleted |
| `firestore.dev.rules` via dev/emulator/rehearsal configs | V1/V2 exclusive gate, freeze, V2 record/operation/profile validation | A, D, E |
| `firebase.dev-rc.json`, `firebase.emulator.json`, `firebase.rehearsal.json` | Environment-isolated validation/deployment selection | A, E; removable only after V2 rollout processes are retired |

## AsyncStorage key inventory

| Key | Content | Readers / writers | Generation | Export / Import | Cloud Sync | Migration / rollback | Runtime status | Removal |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `@taskmemo/nodes/v1` | V1 local Node array | `loadNodes`; `saveNodes`, `resetNodes`; UI only when protocol 1 | V1 | Nodes are exported/imported, but not by copying the key | V1 Nodes sync via Firestore `nodes` | Local recovery source; production Cloud migration reads Firestore instead | Active in production and local-only fallback; bypassed by V2 UI | Keep through migration and rollback window (A,B,C,E,F) |
| `@taskmemo/profile/pinned-note/v1` | `{body, updatedAt}` | `loadPinnedNote`, `savePinnedNote`; V2 also uses it as initial migration source/cache | Common/legacy bridge | Yes in schema 2/3/4; import invokes normal V2 behavior | `profileV2/pinnedNote` under V2 | Required to rescue device-local pre-V2 notes | Active on V1 and V2 | Keep until all relevant devices migrate and candidates are resolved (A,C,D,E,F) |
| `@taskmemo/view/list-display/v1` | List UI preferences | preference service and atomic settings import | Common | Yes / Yes | No | Backup restore only | Active | Keep (E) |
| `@taskmemo/view/tree-display/v1` | Tree UI preferences | preference service and atomic settings import | Common | Yes / Yes | No | Backup restore only | Active | Keep (E) |
| `@taskmemo/settings/reminders/v1` | Reminder preferences | preference service and atomic settings import | Common | Yes / Yes | No | Backup restore only | Active | Keep (E) |
| `@taskmemo/settings/theme/v1` | Theme | theme provider and atomic settings import | Common | Yes / Yes | No | Backup restore only | Active | Keep (E) |
| `@taskmemo/settings/features/v1` | `ideasEnabled` local migration source/cache | feature preference service and atomic settings import | Common/V2 bridge | Yes / Yes | `profileV2/features` under V2 | Deterministic first-sync source | Active | Keep until preference migration window closes (A,C,D,E,F) |
| `@taskmemo/sync-v2/taskmemo-application/v2/{project/account}` | Real V2 domain, History, profile, identities, outbox | `TaskMemoV2ApplicationJournal` | V2 | Intentionally excluded | Contents participate via V2 resources | Authoritative local recovery | Active V2 UI | Keep (B,E) |
| `@taskmemo/sync-v2/taskmemo-application-journal/v2/{project/account}` | Real V2 WAL | same; cleared after commit | V2 | Excluded | No direct Cloud copy | Crash recovery | Active V2 UI | Keep (B,E) |
| `@taskmemo/sync-v2/application/v1` | Generic foundation envelope | `AsyncStorageApplicationJournal`; referenced by tests, not UI | Prototype | Excluded | No current runtime | None identified | Test/foundation only | Removal candidate after confirming no shipped prototype used it (F/G/H) |
| `@taskmemo/sync-v2/application-journal/v1` | Generic foundation WAL | same | Prototype | Excluded | No current runtime | None identified | Test/foundation only | Same as above (F/G/H) |
| `@taskmemo/sync-outbox/v1` | Standalone durable-outbox prototype | `AsyncStorageSyncPersistence`; tests only | Prototype | Excluded | No current runtime | None identified | Test/foundation only | Removal candidate with standalone engine (F/G/H) |

The list matches `DATA_MANAGEMENT_MATRIX.md`. No key deletion or migration was performed.

## V1 runtime and fallback paths

| Path | Exists | Execution condition now | Can execute after current production build/deploy? | Classification |
| --- | --- | --- | --- | --- |
| V1 feature selection | Yes, `useTaskMemoSync` always constructs V1 hook | `useV2 === false` | Yes. Production always has `useV2 === false` at this commit | A, D, E |
| V1 Firestore initial read/listener | Yes, `useFirebaseSync` | Firebase config valid, local ready, authenticated, V1 hook enabled | Yes until production client selection and Rules gate change | A, D, E, F |
| V1 Firestore upload | Yes, debounced batch writes to `users/{uid}/nodes` | Same, after initial merge/listener readiness | Yes; this is the current production writer | A, D, E, F |
| V1 local persistence | Yes | protocol 1, including Firebase-disabled local-only operation | Yes | B, C, E, F |
| V1 `updatedAt` merge/codecs | Yes | V1 Cloud listener/read/write | Yes | A, C, D, E, F |
| V2 runtime | Yes | development/production + exact flag `true` + matching Firebase project; server gate then validates V2-only phase | Production-capable but remains V1 with current unset/false flag | E; repository blocker resolved |
| Compatibility gate | Yes for V2 app/Functions/dev Rules | V2 connect/write | Not enforced by current production Rules/V1 client | A, B, D |

### Fallback conclusion

There is **no implicit V2-error-to-V1-Cloud fallback**. The protocol choice is made before connection; when V2 is selected, `useFirebaseSync(..., enabled=false)` cannot connect or write, and V2 commands return handled/error rather than calling V1 state mutation.

Two adjacent risks remain:

- Invalid/missing Firebase config makes the app protocol 1 and local-only. It cannot write Cloud V1 because Firebase is unconfigured, but it can expose and mutate the old V1 local cache instead of the account-scoped V2 envelope.
- Any production build from current HEAD selects V1 with a valid production config and can write V1. Cutover therefore requires both a reviewed production V2 enablement mechanism and a server-side V1 rejection gate; relying on the client flag alone is unsafe.

## `legacyPinnedNoteCandidates`

`legacyPinnedNoteCandidates` is an array inside the account/project-scoped V2 committed envelope. It is not a Node and has no Firestore document.

- **Purpose:** prevent silent loss when the first V2 start finds both a local legacy pinned note and a different existing Cloud V2 pinned note.
- **Writer:** `initializePinnedNote`. It appends `{body, updatedAt}` only during `migrationPending` when both values are non-empty/different; Cloud becomes current and the local legacy text is retained as a candidate.
- **Reader:** only the store getter and tests. No UI, export, sync, or recovery command consumes it.
- **Cleanup:** none.
- **Normal startup:** the field is loaded/preserved every V2 start, but candidate creation runs only during initial migration.
- **Migration value:** necessary for safe per-device pinned-note migration because production V1 pinned notes are device-local and cannot be included in the Firestore Node snapshot.
- **Recovery:** Settings shows current/candidate content. Explicit adoption uses the normal V2 pinned-note operation; explicit discard removes only the selected candidate. Schema 4 Export/Import preserves unresolved candidates.
- **Classification:** **KEEP UNTIL RESOLVED** (A, C, E). It is never auto-merged or removed by cutover.

## Backward compatibility and legacy transformations

| Asset | Behavior | Retention |
| --- | --- | --- |
| Backup schema 1 | Nodes only; missing `memoType` becomes Task | D/C; retain for a documented import support window |
| Backup schema 2 | Nodes + pinned note | D/C; retain for support window |
| Backup schema 3 | Current content + pinned note + settings; imported `ideasEnabled` becomes V2 operation | E |
| Backup schema 4 | Schema 3 content plus unresolved pinned-note recovery candidates | E |
| Legacy Memo without `memoType` | Decoded as Task in local storage, Firestore V1 codec and backup parser | C/D; retain through migration/support window |
| Legacy invalid/duplicate sort keys | Normalized at V1 local load, migration planning and V2 authoritative ingestion/repair | A/C/D; retain until all migrated data is validated |
| Legacy Routine Categories | `ensureRoutineCategories` migrates old routine-category representation into repeat rules/tombstones | A/C/D; retain through migration and old backup support |
| Old whole-array History entries | Detected in V2 envelope and only unsafe History stacks are discarded; domain/outbox/profile survive | C/D; retain until old V2 RC envelopes are outside support window |
| Missing V2 `targetType` | Interpreted as Node operation | D; retain while old V2 outboxes may exist |
| Missing V2 profile/features fields | V2 envelope open backfills profile/feature migration state | C/D; retain while RC/dev installs may upgrade |
| Legacy pinned-note local record | Supplies first V2 migration and recovery candidate timestamp | A/C/D |

## Migration, rollback and validation assets

| Asset | Current verification / limitation | Class |
| --- | --- | --- |
| `read-production-v1-snapshot.mjs` + `readOnlyFirestoreSnapshot` | Exact project/confirmation, POST `runQuery`, collection-group `nodes`, no write method. Required for a fresh pre/post-freeze snapshot. It does not capture profile/settings because V1 stores those locally. | A, B |
| `analyze-production-snapshot.ts` | Offline production identity check + planner; detects issues/loss/semantic changes. Node-only. | A |
| `migration-dry-run.ts`, `migrationDryRun.ts`, fixtures/tests | Latest HEAD: 8→8, 0 issues/loss/changed fields; validates Node schema, orphan, sort key, tombstone, unknown fields. | A, D |
| `rehearse-v2-cutover.ts` + `firebase.rehearsal.json` | Latest HEAD formal Emulator run: 120 backup/restored/migrated, exact equality, V1 read/write/resurrection rejected, V2 Node smoke applied. Still Node-only; does not exercise profile/features/external-AI latest cutover surface. | A, B, H |
| `SYNC_V2_CUTOVER_RUNBOOK.md` | Correct freeze-first and no-simple-rollback policy. Production execution remains separately authorized. | A, B |
| schema-3 Export/Import | User backup/restore for Nodes, pinned note and settings; excludes protocol internals intentionally. It is not a substitute for managed Firestore export. | B, C, D, E |
| `firestore.dev.rules` compatibility/freeze tests | Emulator covers V1/V2 exclusivity, missing/dual gates, ownership and V2 profiles. | A, B, D |
| external-AI repository tests/docs | V2 producer model exists, but environment-gated integration tests and production deployment/cutover order still need explicit evidence. | A, B, H |
| `delete-approved-production-orphan.mjs` | One-off, target-hardcoded production DELETE already used. No migration/rollback runtime depends on it. Preserve historical evidence separately; executable deletion script is a REMOVE NOW CANDIDATE after review. | G, H |
| `repair-v2-rc-sort-key.mjs` | One-off dev RC repair; not production migration. | G, H |
| `provision-v2-rc-dev.mjs`, `prepare-v2-ui-emulator.ts`, build verifiers | Active dev/RC validation assets; not legacy production data. | E, F |

There is no general rollback script that converts versioned V2 state, profiles and receipts back to V1. This is intentional after V2 writes: use forward repair, not snapshot overwrite.

## Deletion candidates (no deletion performed)

| Candidate | Why it appears removable | References | Migration impact | Rollback impact | Earliest safe point |
| --- | --- | --- | --- | --- | --- |
| Generic `V2ApplicationStore`, standalone `DurableOutbox`/`SyncEngine`, their AsyncStorage adapters/keys | Superseded by `TaskMemoV2ApplicationStore`/controller; referenced by foundation tests only | Static references are test/foundation-local | None identified, but shared types/state-machine tests may still provide design coverage | None identified | After extracting any desired coverage and confirming no released build used its keys (F/G/H) |
| `delete-approved-production-orphan.mjs` | Hardcoded completed one-time destructive action | Docs/history, no package command | None | Its private backup/audit may matter; executable does not | Separate security/audit decision now (G/H) |
| `repair-v2-rc-sort-key.mjs` | Hardcoded completed dev repair | No runtime reference | None | None | After RC evidence retention decision (G/H) |
| V1 hook/codec/local Node key | Superseded only after cutover | Active production runtime and migration tests | **Critical loss if removed now** | Needed during pre-cutover recovery window | Only after migration, V1 rejection, observation, backup retention and explicit rollback-window closure (A/B/C/E/F) |
| Backup schema 1/2 parsers and legacy Node/Routine normalization | Old-format rescue | Tests and import/runtime paths | Supports old production/local exports | Supports user recovery | After published support window and telemetry/manual evidence (C/D/F) |

## Cutover priority

### BLOCKER — repository implementation resolved; deployment not authorized

- Production V2 selection is now explicit-flag capable and fail-closed on server-gate failure; default production remains V1.
- `firebase.cutover.json` now identifies the strict tested Rules artifact without changing/deploying current production Rules.
- Recovery candidates now have compare/adopt/discard UI and schema 4 backup coverage.

### MUST BEFORE CUTOVER

- Capture a fresh stable production V1 snapshot after freeze; the 2026-09-19 artifact proves the tooling, not the future cutover contents.
- Extend/re-run formal rehearsal for current profile resources (`pinnedNote`, `features`) and the exact production client/Rules artifact. Decide whether client-side profile migration is sufficient and document multi-device ordering.
- Run external-AI V2 integration/cutover-order validation with the exact Functions artifact; prove freeze and V1 gate failure. Do not deploy V2 Functions into a V1 phase or leave V1 Functions after V2 cutover.
- Prepare a managed production export/restore validation and immutable manifest for Nodes, V2 records/receipts/profile, gates and control state.
- Define operation-receipt/audit retention and post-cutover monitoring/STOP criteria.
- Resolve documentation drift: README describes the broad production Rules as normal setup, while the cutover runbook requires a stricter freeze/gate transition.

### CAN AFTER CUTOVER

- Remove V1 runtime, codec and `@taskmemo/nodes/v1` only after the observation/rollback window closes and all supported clients are rejected/migrated.
- Remove schema 1/2 and legacy Node/Routine transforms only after the backup compatibility support window.
- Remove migration planners/rehearsal assets only after retained backups are independently restorable and migration is formally closed.
- Prune only explicitly resolved legacy pinned-note candidates; keep the recovery structure through the support window.

### OPTIONAL CLEANUP

- Consolidate/remove standalone foundation store/outbox/engine and their unused keys after coverage review.
- Archive/remove the hardcoded orphan deletion and dev sort-key repair executables while preserving audit evidence.
- Rename version-suffixed preference keys only if a real storage migration benefit justifies the risk; the suffix alone is not a reason.

## Latest-HEAD verification performed

No production connection was made.

- Offline fixture dry-run: 8 source / 8 output, 0 issues, 0 lost fields, 0 changed fields.
- Related unit tests: 7 files, 32 tests passed (migration, backup schemas, V1 local/Firestore codecs, gate, read-only request, provisioning).
- Formal isolated Emulator rehearsal using the existing private read-only snapshot: 120 backup / 120 restored / 120 migrated; exact equality; 0 source issues/lost fields; old-client read/write/tombstone resurrection rejected; V2 Node smoke applied.

Conclusion: the Node migration/rehearsal assets are executable and valid on latest HEAD for their stated Node scope. They are not complete evidence for the newer profile/features and external-AI cutover surface, so production cutover remains blocked.
