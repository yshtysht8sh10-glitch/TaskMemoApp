# V2 cutover rehearsal — 2026-09-19

Status: `PASSED` after the explicitly approved deletion of the obsolete production orphan. This is not production-cutover approval.

## Environment separation

| Purpose | Firebase project | Access performed |
| --- | --- | --- |
| Production source | `taskmemoapp-eabc3` | Firestore REST `runQuery` read only |
| Isolated rehearsal | `demo-taskmemo-rehearsal` | Local Auth/Firestore emulators on ports 9299/8280 |
| Release candidate | `taskmemoapp-dev` | Dev-only Rules, Auth, Firestore and Hosting |

Production received exactly one owner-approved deletion (`ipa-morning`). It received no other Firestore write, Rules change, Hosting deployment, feature-flag change, or migration.

## Read-only production dry-run

The initial production collection-group query was run twice and stable. After the approved deletion, a fresh read-only snapshot SHA-256 was `b77cbe1b523e9656885ef54c1d0a7c1f01703ec993b57c51c95b48e94798f5ea`.

| Metric | Result |
| --- | ---: |
| users | 1 |
| Nodes before / after migration | 120 / 120 |
| active / deleted / purged tombstones | 100 / 16 / 4 |
| Category / Memo / Idea / Routine | 12 / 108 / 1 / 9 |
| completed | 8 |
| Routine history entries | 8 |
| due / dayPart | 71 / 7 |
| unknown fields | 0 |
| unexpected schema data | 0 |
| changed fields / lost fields | 0 / 0 |
| semantic meaning changes | 0 |
| orphan Nodes | 0 |

The first dry-run found the deleted Memo `ipa-morning`, whose `parentId` was `ipa`; that parent was absent. After the owner explicitly identified it as obsolete and authorized deletion of that exact ID, the live document was backed up privately and deleted with an `updateTime` precondition. The deletion verification proved 121 → 120 documents, zero children, and all 119 non-target documents unchanged.

The post-deletion read-only dry-run produced 120 → 120 Nodes, orphan count 0, issue count 0, changed/lost fields 0, and semantic meaning changes 0. The migration validation STOP condition is therefore resolved.

V2 migration adds only the transport metadata `revision`, `lastOpId`, `lastDeviceId`, `lastLocalSeq`, and `operationType`; V1 Node ID, parent/order/deadline/day-part/Routine/completion/deletion/tombstone fields remain semantically identical.

## Isolated backup / restore / migration rehearsal

The production read-only snapshot was copied with create-only semantics, restored to the isolated emulator, and compared recursively by document count, document ID, every field/value, nested data, tombstones, and unknown fields. All 120 documents were identical after restore.

The earlier diagnostic continuation preserved the orphan unchanged. After the approved deletion, a new formal rehearsal used `--validation-must-pass`, which stops before migration on any source issue. The clean 120-Node snapshot passed without diagnostic continuation.

| Step | Measured time |
| --- | ---: |
| backup copy | 19.15 ms |
| restore | 511.81 ms |
| restore validation | 222.10 ms |
| V1→V2 write | 222.90 ms |
| migration validation | 60.12 ms |
| compatibility gate | 27.41 ms |
| write-freeze rehearsal window | 708.52 ms |
| total | 2,327.02 ms |

Formal post-cleanup results:

- backup / restored / migrated: 120 / 120 / 120
- restore equality: exact
- migration semantic changes / lost fields: 0 / 0
- old V1 authenticated read: rejected
- old V1 write: rejected
- old V1 tombstone resurrection: rejected
- V2 adapter connection and smoke operation: applied

## Decision

The data-validation and formal-rehearsal blockers are resolved. By owner decision, Apple Developer Program enrollment and an iOS native RC are outside this cutover's scope and are not blockers. Production cutover is still **not authorized** until the Windows PWA, iPhone Safari PWA, and Android APK checklist is reported complete.
