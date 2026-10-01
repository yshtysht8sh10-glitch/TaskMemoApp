# Web V2 migration conflict recovery (2026-10-01)

## Incident and preserved sources

The Web UI displayed zero Nodes and reported that legacy localStorage changed after the IndexedDB copy. The UI count was not evidence of data loss: the V2 startup stopped before publishing the loaded application state. The first complete browser snapshot was downloaded before any browser storage mutation. Its SHA-256 is `6eeed0a4789a53c5cdb88d161c03c62a3c231b4a2e66e86b0a9b9aad7716b052`.

| Source | Nodes | Roots | Children | Notes |
| --- | ---: | ---: | ---: | --- |
| V1 localStorage `@taskmemo/nodes/v1` | 120 | 101 | 19 | Older legacy source; no IDs absent from Cloud |
| Legacy V2 localStorage application | 165 | 96 | 69 | Journal absent, outbox empty |
| Current V2 IndexedDB application | 165 | 96 | 69 | Journal absent, outbox empty |
| IndexedDB preserved migration/recovery fields | 0 | — | — | No preserved generation present before this recovery |
| Firestore `users/<uid>/nodesV2` | 175 | 105 | 70 | Separate read-only snapshot saved |

The offline comparison found the same 165 IDs in legacy V2 and IndexedDB, with five different Node values. Cloud contains every Web V1 and V2 ID plus ten additional IDs. Of the 165 V2 IDs, 136 records match Cloud exactly and 29 have a higher Cloud revision. No local-only or local-higher-revision Node was found. Cloud Node, profile and sync metadata were read twice; canonical document content was unchanged between reads.

## Warning mechanism and likely cause

`IndexedDbTaskMemoApplicationJournal.open()` hashes the exact legacy V2 committed and journal strings as `SHA-256(JSON.stringify([committed, journal]))`. It compares this with `legacyFingerprint` in IndexedDB. A mismatch stops startup before the sync controller is created. The stored fingerprint was `bb7d378636e30755a6f95831b24cbfddd2465a0e1ef56027a85166b90423713c`; the current legacy pair hashes to `83184e6136ee3e4fcd25b45b97563f1a7a964eba1b8db7bb9acc566641114e1c`.

The changed content includes four records whose legacy revisions are higher than IndexedDB, one whose IndexedDB revision is higher, and differences in sequence/history/sync metadata. This rules out a mere serialization or timestamp-only mismatch. Current Web code selects IndexedDB for V2 and reads the old `TaskMemoV2ApplicationJournal` only for migration checks. It does not dual-write the old V2 keys. A concurrently running older bundle or tab is a plausible writer; the available snapshot does not identify the process that made the writes. Keep this distinction in incident reports.

## Safe recovery procedure

1. Do not clear site data, sign out, rerun migration, or push an empty list.
2. Use `/v2-recovery-backup` on the exact affected origin. It exports all `@taskmemo/` localStorage entries and the existing IndexedDB `scopes` records. It accepts a missing journal, because that is a valid committed state. Verify file size and SHA-256 after downloading.
3. Run `scripts/inspect-recovery-bundle.mjs` offline to create separate V1, legacy V2, IndexedDB and preserved-generation files. The script uses create-only writes, so it cannot replace a previous backup.
4. Capture Cloud with `scripts/capture-recovery-cloud-readonly.mjs`. The script uses only Firestore GET requests and writes a create-only JSON file.
5. Compare records with `scripts/compare-recovery-sources.mjs`. Do not select Cloud if any Web-only Node exists, any local revision is higher, or an equal revision has different content.
6. Build a plan with `scripts/prepare-cloud-recovery-plan.mjs`. It rejects an uncommitted journal, outbox, schema mismatch, missing Cloud Node, or unresolved profile difference.
7. Re-read Cloud immediately before applying the plan. If any document changes, build a fresh plan.
8. Open `/v2-cloud-recovery`, select the plan, and inspect. The page checks exact hashes of the local committed values and checks the stored fingerprint. Applying the plan updates one IndexedDB record in one transaction, preserving the old committed value and fingerprint inside that record. It never writes legacy localStorage or Firebase.
9. Reload the main app and compare displayed IDs/counts against the Cloud snapshot. Then verify bidirectional sync with one disposable test Node.

## Prevention

The V2 controller is constructed only after persistence hydration and migration checks succeed. It sends durable outbox operations, not a whole-list snapshot. `assertSafeNodeTransition` also rejects a large unrequested drop before outbox operations are created. Explicit deletion commands remain distinct from a transient empty loading state. Keep the legacy fingerprint stop condition: it is a safety signal that should lead to comparison and backup, not to clearing storage.

During verification, two Web tabs sharing the persisted `deviceId` exposed a separate listener problem: a tab ignored the other tab's Cloud operation merely because the device ID matched. The listener now treats an operation as its own echo only when its exact operation ID is still in that tab's outbox, and advances the local sequence past an observed same-device operation. Concurrent edits from two tabs still require a separate atomic compare-and-swap design; avoid simultaneous editing in multiple Web tabs until that is implemented.

A second verification found a local record at revision 1 while its operation ID was already in `seenOpIds` and Cloud had revision 2. The listener now skips a seen operation only when the local record is at least as new. This lets a fresh Cloud snapshot repair a stale local record after another tab has replaced IndexedDB state.

## Outcome

The Web IndexedDB application was rebuilt from the verified 175-record Cloud snapshot in a single transaction. The previous IndexedDB committed string and fingerprint remain in the record as `preservedCloudRecoveryCommitted` and `preservedCloudRecoveryFingerprint`, and a separate post-recovery JSON copy was saved. After reload, the Web UI showed Nodes and reported `同期済み`. A single test Node was created from Web; Firestore reported revision 1 and 176 total records. A second Web tab updated that test Node. After the listener corrections, the first tab received the revision 3 title without reloading. The test Node remains in the account and can be removed by the user after checking the iPhone. iPhone device behavior and a full browser-process restart were not executed in this session.
