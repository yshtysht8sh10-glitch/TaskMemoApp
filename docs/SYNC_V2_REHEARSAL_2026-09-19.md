# V2 cutover rehearsal — 2026-09-19

Status: `BLOCKED_SOURCE_VALIDATION`. This is not production-cutover approval.

## Environment separation

| Purpose | Firebase project | Access performed |
| --- | --- | --- |
| Production source | `taskmemoapp-eabc3` | Firestore REST `runQuery` read only |
| Isolated rehearsal | `demo-taskmemo-rehearsal` | Local Auth/Firestore emulators on ports 9299/8280 |
| Release candidate | `taskmemoapp-dev` | Dev-only Rules, Auth, Firestore and Hosting |

Production received no Firestore writes, Rules changes, Hosting deployment, feature-flag change, or migration.

## Read-only production dry-run

The same production collection-group query was run twice. The decoded canonical snapshot SHA-256 was stable: `164e888bb393c40f1a9470398bb57c731507c73ee9c5314afa8700eb361e3d36`.

| Metric | Result |
| --- | ---: |
| users | 1 |
| Nodes before / after | 121 / 121 |
| active / deleted / purged tombstones | 100 / 17 / 4 |
| Category / Memo / Idea / Routine | 12 / 109 / 1 / 9 |
| completed | 9 |
| Routine history entries | 8 |
| due / dayPart | 72 / 8 |
| unknown fields | 0 |
| unexpected schema data | 0 |
| changed fields / lost fields | 0 / 0 |
| semantic meaning changes | 0 |
| orphan Nodes | **1** |

The orphan is the deleted Memo `ipa-morning`, whose `parentId` is `ipa`; that parent is absent. The Node has no children and is not a purged tombstone. It was reported without modification. This fails the production migration validation gate.

V2 migration adds only the transport metadata `revision`, `lastOpId`, `lastDeviceId`, `lastLocalSeq`, and `operationType`; V1 Node ID, parent/order/deadline/day-part/Routine/completion/deletion/tombstone fields remain semantically identical.

## Isolated backup / restore / migration rehearsal

The production read-only snapshot was copied with create-only semantics, restored to the isolated emulator, and compared recursively by document count, document ID, every field/value, nested data, tombstones, and unknown fields. All 121 documents were identical after restore.

The formal runbook stops at the orphan validation failure. To test the later mechanics only, the isolated rehearsal was explicitly continued with `--continue-after-validation-stop=orphan-preservation-only`; the orphan was preserved unchanged. This diagnostic continuation does not convert the rehearsal to PASS.

| Step | Measured time |
| --- | ---: |
| backup copy | 51.99 ms |
| restore | 237.79 ms |
| restore validation | 83.20 ms |
| V1→V2 write | 159.17 ms |
| migration validation | 54.55 ms |
| compatibility gate | 30.69 ms |
| diagnostic write-freeze window | 598.59 ms |
| total | 995.30 ms |

Results after diagnostic continuation:

- backup / restored / migrated: 121 / 121 / 121
- restore equality: exact
- migration semantic changes / lost fields: 0 / 0
- old V1 authenticated read: rejected
- old V1 write: rejected
- old V1 tombstone resurrection: rejected
- V2 adapter connection and smoke operation: applied

## Decision

Production cutover is **not ready**. Before a new formal rehearsal, an operator must explicitly decide how the pre-existing deleted orphan should be handled. It must not be silently repaired or ignored. The release-candidate device checklist must also pass before cutover authorization.
