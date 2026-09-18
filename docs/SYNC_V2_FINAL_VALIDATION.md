# Sync V2 pre-production validation — 2026-09-19

Scope was development/Emulator only. No production data, Rules, Hosting, EAS build, migration, or feature flag was changed.

## Automated evidence

- Explicit boundary: V2 requires development plus `EXPO_PUBLIC_SYNC_V2_ENABLED=true`; production/test/missing/malformed values fail closed.
- UI bridge: V2 owns account-scoped persistence, does not hydrate/save the V1 local cache, and does not fall back to V1 mutations while V2 initializes.
- WAL/history: overlapping UI commands are serialized; no title/body, history entry, or operation ID is lost. Local durable state publishes before upload. An operation added while another upload is in progress is drained.
- Listener lifecycle: self echoes retain Undo/Redo; stopped connections cannot subscribe after late connection completion.
- Compatibility: Emulator Rules reject V1 for a V2 user, V2 for a V1 user, malformed dual-write markers, missing markers, cross-owner access, and both protocols during maintenance.
- Domain scenarios cover Category/Memo creation/edit/move, due/day-part, task/idea, normal and Routine completion/cancellation, soft delete/restore/purge and Undo/Redo. Two-device Emulator scenarios cover reverse/duplicate delivery, restart, backlog, conflict, and purge versus stale child edit.
- Migration fixture: 8 Nodes (2 Category, 6 Memo, 1 Routine, 1 completed, 1 deleted, 1 purged), 2 routine-history entries and 2 unknown fields. Output 8, issues 0, changed fields 0, lost fields 0. IDs, parent/sort/deadline keys, histories and tombstones round-trip.

## Actual React UI evidence

Two browser origins (`localhost` and `127.0.0.1`) supplied distinct Web persistence/device identities against Auth/Firestore Emulator. Through the rendered UI:

- A logged into the V2 account and created Category `V2 Category A`.
- B logged into the same account and received that Category through the listener.
- A created `V2 Memo A`, selected the Tomorrow deadline and saved body text; B received it.
- B changed the inline title to `V2 Memo B-edited`; A received it.
- B performed Undo, waited for listener traffic, retained an enabled Redo, then Redo restored the edit.
- A's disconnected edit and B's competing edit converged deterministically after reconnect/reload; the resulting server winner was shown by the client.

The complete command matrix is automated through the same application store/controller/domain path, but drag/touch geometry, Android lifecycle, and a full visual pass of every modal remain manual release checks.

## Readiness judgment

The protocol implementation, dev UI bridge, compatibility gate, offline migration tool and human runbook are ready for review. Production cutover must **not** begin yet. Remaining gates are: run the dry-run on an approved production-equivalent export, perform the documented isolated restore rehearsal, review/deploy production Rules while frozen, and complete iPhone/Android/PWA manual smoke with the release candidate. Issue #45 remains open until those are explicitly approved.
