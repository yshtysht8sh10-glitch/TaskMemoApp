# TaskMemoApp Data Management Matrix

## Purpose

This document is the design baseline for how every kind of data held by TaskMemoApp participates in persistence, Cloud Sync, Undo/Redo, Export, Import, and migration.

この文書は、TaskMemoAppが保持する各データについて、次の扱いを明示する横断的な設計基準である。

- 保存場所と回復方法
- Cloud Sync対象か
- Undo/Redo対象か
- Export対象か
- Import対象か
- 端末固有か、ユーザー共通か
- schema変更やmigrationが必要か

個別機能の詳細仕様を複製する文書ではない。Nodeのドメイン仕様は[DESIGN.md](DESIGN.md)、V2同期機構は[SYNC_V2.md](SYNC_V2.md)、production移行手順は[SYNC_V2_CUTOVER_RUNBOOK.md](SYNC_V2_CUTOVER_RUNBOOK.md)、テスト方針は[TESTING.md](TESTING.md)、外部AIは[external-ai-mcp.md](external-ai-mcp.md)を正本とする。本書はそれらをデータ種別ごとに横断して判断するための索引兼matrixである。

Current matrixはcommit `ee8d89c9974f46c72d8660a71ae5ed7d8357b974`の実装を基準にした。Target matrixは将来の設計目標であり、実装済みという意味ではない。

### Related documents and responsibilities

| Document | Responsibility |
| --- | --- |
| [DESIGN.md](DESIGN.md) | Node、Category、Memo、期限、完了、並び順、削除のドメイン設計 |
| [architecture.md](architecture.md) | ソース配置と外部サービス分離の短い全体方針 |
| [SYNC_V2.md](SYNC_V2.md) | state machine、outbox、revision、競合、WAL、Firebase adapter |
| [SYNC_V2_CUTOVER_RUNBOOK.md](SYNC_V2_CUTOVER_RUNBOOK.md) | production移行・停止条件・回復手順 |
| [SYNC_V2_REHEARSAL_2026-09-19.md](SYNC_V2_REHEARSAL_2026-09-19.md) | migration rehearsalの実施証跡 |
| [SYNC_V2_FINAL_VALIDATION.md](SYNC_V2_FINAL_VALIDATION.md) | production切替前のV2検証結果 |
| [V2_RC_MANUAL_CHECKLIST.md](V2_RC_MANUAL_CHECKLIST.md) | RC実機確認項目 |
| [TESTING.md](TESTING.md) | 回帰テスト、永続化round-trip、手動確認方針 |
| [external-ai-mcp.md](external-ai-mcp.md) | Remote MCP、OAuth、監査、デプロイ状態 |
| This document | 上記をCloud Sync / Undo/Redo / Export / Import / persistenceの共通軸で横断する正本 |

### Legend

- `○`: 対象
- `×`: 対象外
- `△`: 一部のみ、または条件付き
- `―`: 意図的に対象外
- `?`: コードから確定不能

## Data inventory

### User content

| Data | Representation | Notes |
| --- | --- | --- |
| Category | `CategoryNode` | 通常CategoryとRoutine用Categoryを含む |
| Memo / Task | `MemoNode` | タイトル、本文、期限、完了状態、所属、並び順を保持 |
| Idea | `MemoNode` with `memoType: "idea"` | 独立Node型ではなくMemo subtype |
| Routine definition | Routine Category + `MemoNode.repeatRule` | 独立resourceではない |
| Routine History | `MemoNode.routineHistory` | 日付ごとの完了時刻または完了取消tombstone |
| Delete / purge state | `deletedAt`, `purgedAt`, `deletionBatchId` | Nodeのライフサイクル情報 |
| Pinned note | V2 `profile.pinnedNote` | Nodeとは別のV2 profile resource |
| Legacy pinned-note candidates | `profile.legacyPinnedNoteCandidates` | 既存cloud値と異なる旧local常設メモの回復用退避 |

`Routine`は独立した永続型ではない。`CategoryNode.categoryKind`、`MemoNode.repeatRule`、`MemoNode.routineHistory`の組合せで表現する。型の正本は[`src/models/node.ts`](../src/models/node.ts)、動作は[`src/domain/routine.ts`](../src/domain/routine.ts)にある。

### Persistent user preferences

| Preference group | Fields |
| --- | --- |
| List display | `visibleGroupIds`, `showPinnedNote`, `todayGranularity`, `pinnedNoteHeight` |
| Tree display | `showCompletedMemos` |
| Reminders | `enabled`, `sameDay`, `dayBefore` |
| Theme | `system`, `light`, `dark` |
| Feature preferences | `ideasEnabled` |

### Sync and recovery state

- V2 authoritative `domain`
- versioned `profile.pinnedNote`
- unified Node/pinned-note `past` and `future` History
- durable outbox
- `seenOpIds`
- `deviceId` and `nextLocalSeq`
- `revision`, `lastOpId`, `lastDeviceId`, `lastLocalSeq`
- committed application envelope and write-ahead journal
- Firestore operation receipts and compatibility metadata

These are recovery or protocol data, not portable user content. Their internal structure is defined by [`src/sync/taskMemoApplicationStore.ts`](../src/sync/taskMemoApplicationStore.ts), [`src/sync/types.ts`](../src/sync/types.ts), and [SYNC_V2.md](SYNC_V2.md).

### Authentication, integration, and audit data

- Firebase Authentication account and client session
- External-AI OAuth client, authorization request/code, token hash, expiry, and revocation state
- External-AI operation audit logs
- Global and per-user V1/V2 compatibility gates

These are security or operational records. They must not be included in ordinary user-data Export files.

### Temporary UI and session state

The following are React state, refs, module memory, animation state, or browser/native state and are intentionally not user-data persistence:

- current main view and expanded deadline groups
- modal/sheet/editor open state
- editor and quick-add drafts before commit
- selection mode and selected IDs
- moving Node, drag/drop candidate, resize state
- completion animation and snackbar notices
- tree expansion retained only during the current JavaScript process
- scroll, keyboard compensation, measurement, and diagnostic state
- sync status/error and offline simulation state
- sign-in form email/password
- external-AI panel busy/message/status display

## Persistence

### AsyncStorage and local persistence

| Key or namespace | Contents | Status | Owner/path |
| --- | --- | --- | --- |
| `@taskmemo/nodes/v1` | V1 Node array | Active for V1; bypassed by V2 UI | [`nodeStorage.ts`](../src/services/nodeStorage.ts) |
| `@taskmemo/profile/pinned-note/v1` | `{ body, updatedAt }` | Active for V1; V2 migration source and local compatibility mirror | [`pinnedNoteStorage.ts`](../src/services/pinnedNoteStorage.ts) |
| `@taskmemo/view/list-display/v1` | List display preferences | Active | [`viewPreferences.ts`](../src/services/viewPreferences.ts) |
| `@taskmemo/view/tree-display/v1` | Tree display preferences | Active | [`viewPreferences.ts`](../src/services/viewPreferences.ts) |
| `@taskmemo/settings/reminders/v1` | Reminder preferences | Active | [`reminderPreferences.ts`](../src/services/reminderPreferences.ts) |
| `@taskmemo/settings/features/v1` | Feature preferences | Active | [`featurePreferences.ts`](../src/services/featurePreferences.ts) |
| `@taskmemo/settings/theme/v1` | Theme mode | Active | [`theme.tsx`](../src/theme/theme.tsx) |
| `@taskmemo/sync-v2/taskmemo-application/v2/{scope}` | V2 committed application envelope | Active for V2; `scope` is project/account-specific | [`applicationStorage.ts`](../src/sync/applicationStorage.ts) |
| `@taskmemo/sync-v2/taskmemo-application-journal/v2/{scope}` | V2 WAL/recovery marker | Active for V2; removed after successful commit | [`applicationStorage.ts`](../src/sync/applicationStorage.ts) |
| `@taskmemo/sync-v2/application/v1` | Generic V2 foundation envelope | Foundation/test-only; not used by the real UI | [`applicationStorage.ts`](../src/sync/applicationStorage.ts) |
| `@taskmemo/sync-v2/application-journal/v1` | Generic foundation WAL | Foundation/test-only | [`applicationStorage.ts`](../src/sync/applicationStorage.ts) |
| `@taskmemo/sync-outbox/v1` | Standalone durable-outbox prototype | Foundation/test-only | [`outboxStorage.ts`](../src/sync/outboxStorage.ts) |
| Firebase Auth SDK-managed persistence | Native authentication session | Active; exact key is SDK-owned and therefore not specified by this repository | [`firebaseClient.native.ts`](../src/services/firebaseClient.native.ts) |

Scheduled native notifications are stored by the operating system. Web reminder timers are memory-only. Both are derived from Node data and reminder preferences rather than treated as authoritative backup data.

### Firestore

| Path | Contents | Status |
| --- | --- | --- |
| `users/{uid}/nodes/{nodeId}` | V1 Node document | Active V1/legacy path |
| `users/{uid}/nodesV2/{nodeId}` | V2 versioned Node | Active V2 path |
| `users/{uid}/profileV2/pinnedNote` | V2 versioned pinned note | Active V2 path |
| `users/{uid}/profileV2/features` | V2 versioned user-wide feature preferences (`ideasEnabled` only) | Active V2 path; local AsyncStorage remains migration source/cache |
| `users/{uid}/syncOperationsV2/{opId}` | Immutable operation receipt and acknowledgement | Active V2 protocol data |
| `users/{uid}/syncMetadataV2/compatibility` | Per-user protocol gate | Active operational metadata |
| `syncControl/current` | Global write/maintenance control | Active operational metadata |
| `users/{uid}/externalAiAuditLogs/{id}` | External-AI write audit | Implemented server path; production Functions not deployed |
| `externalAiOAuthClients/{clientId}` | OAuth client registration | Implemented server path; production Functions not deployed |
| `externalAiOAuthRequests/{id}` | Temporary authorization request | Implemented temporary server path; production Functions not deployed |
| `externalAiOAuthCodes/{hash}` | One-time authorization code | Implemented temporary server path; production Functions not deployed |
| `externalAiOAuthTokens/{hash}` | Hashed access/refresh token metadata | Implemented server path; production Functions not deployed |

The V2 client paths are defined by [`firebaseSyncAdapter.ts`](../src/sync/firebaseSyncAdapter.ts). The External-AI collections are defined by [`functions/src/firestoreOAuthStore.ts`](../functions/src/firestoreOAuthStore.ts) and [`functions/src/firestoreNodeRepository.ts`](../functions/src/firestoreNodeRepository.ts).

## Current matrix

This table records current behavior, not desired behavior. `Cloud Sync ○` for pinnedNote means the V2 path; the V1 fallback keeps pinnedNote local-only.

| Data | Persistence | Cloud Sync | Undo/Redo | Export | Import | Classification | Notes |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| Category | V1/V2 local + Firestore Node | ○ | ○ | ○ | ○ | User content | Parent, sort, deletion metadata included |
| Routine Category | Category Node fields | ○ | ○ | ○ | ○ | User content | Not a separate resource |
| Task Memo | V1/V2 local + Firestore Node | ○ | ○ | ○ | ○ | User content | Body, due, completion, repeat metadata included |
| Idea | Memo subtype | ○ | ○ | ○ | ○ | User content | Missing legacy `memoType` becomes Task |
| Routine definition | Memo/Category fields | ○ | ○ | ○ | ○ | User content | `repeatRule` is retained by object serialization |
| Routine History | Memo field | ○ | ○ | ○ | ○ | User content | Completion-cancellation tombstones included |
| Soft-delete state | Node fields | ○ | ○ | ○ | ○ | Content lifecycle | Restorable |
| Purge tombstone | Node fields | ○ | △ | ○ | ○ | Content lifecycle | Single purge omits history; batch path currently records a history entry |
| Pinned note | Legacy key + V2 envelope + `profileV2` | ○ | ○ | ○ | ○ | User content | V2 has WAL, History, outbox, revision, echo handling |
| Legacy pinned-note candidates | V2 envelope only | × | ― | ○ | ○ | Recovery content | Settings UI supports compare/adopt/discard; schema 4 preserves unresolved candidates |
| List display preferences | AsyncStorage | × | ― | ○ | ○ | Persistent setting | Four settings share one record |
| Tree display preferences | AsyncStorage | × | ― | ○ | ○ | Persistent setting | `showCompletedMemos` |
| Reminder preferences | AsyncStorage | × | ― | ○ | ○ | Persistent setting | OS permission and scheduled notifications are separate |
| Theme | AsyncStorage | × | ― | ○ | ○ | Persistent setting | `system`/`light`/`dark` |
| Feature preferences | AsyncStorage + V2 envelope + `profileV2/features` | ○ | ― | ○ | ○ | Persistent user setting | Only `ideasEnabled` is synchronized; other preference records remain device-local |
| V2 History | Scoped V2 envelope | × | ― | × | × | Local operational state | Persists across restart; remote/self echo preserves it |
| V1 History | React state | × | ― | × | × | Session state | Node-only and lost on restart |
| V2 WAL/outbox | Scoped V2 envelope/journal | △ | ― | × | × | Sync/recovery state | Receipt is uploaded; local queue itself is not restored from cloud |
| Revision/echo metadata | V2 local + Firestore | ○ | ― | × | × | Sync protocol state | Backup contains current values, not protocol metadata |
| Firebase Auth | Firebase Auth + SDK persistence | ― | ― | × | × | Authentication/security | Cloud-managed identity, not TaskMemo data sync |
| External-AI OAuth | Server Firestore | ― | ― | × | × | Authentication/security | Implemented but production Functions not deployed |
| External-AI audit | Server Firestore | ― | ― | × | × | Audit | Implemented but production Functions not deployed |
| Scheduled reminders | OS state or Web memory | × | ― | × | × | Derived operational data | Rebuilt from Nodes and preferences |
| Temporary UI/session state | Memory | ― | ― | ― | ― | Temporary UI | Intentionally discarded |

### Current Export/Import schema

The UI uses `serializeTaskMemoBackup` and `parseTaskMemoBackup` in [`nodeBackup.ts`](../src/services/nodeBackup.ts).

- Current export `schemaVersion`: `4`
- Schema 4 extends schema 3 with validated `content.legacyPinnedNoteCandidates`; candidates remain local recovery data and are not Cloud Sync resources.
- Deleted and purged Node records remain in the exported Node array.
- Schema 4 import restores Nodes, pinnedNote, settings and unresolved recovery candidates. Schema 3 remains compatible with an empty candidate list. Under V2, imported `ideasEnabled` additionally becomes a normal profile operation, while every other setting stays local-only.
- Schemas 1 and 2 remain import-compatible. Missing pinnedNote/settings/candidates are represented as absent or empty and leave current settings unchanged.
- History, WAL, outbox, revision, device identity, authentication, Firebase internals and audit records are not exported. Unresolved pinned-note recovery candidates are exported by schema 4.

## Target matrix

This table is a proposal and does not claim implementation.

| Data | Persistence target | Cloud Sync | Undo/Redo | Export | Import | Scope | Notes |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| Category | V2 content state | ○ | ○ | ○ | ○ | User-wide | Keep current behavior |
| Task Memo | V2 content state | ○ | ○ | ○ | ○ | User-wide | Keep current behavior |
| Idea | V2 content state | ○ | ○ | ○ | ○ | User-wide | Keep current behavior |
| Routine definition/history | V2 content state | ○ | ○ | ○ | ○ | User-wide | Keep current behavior |
| Soft-delete state | V2 content state | ○ | ○ | ○ | ○ | User-wide | Keep current behavior |
| Purge tombstone | V2 content state | ○ | ― | ○ | ○ | User-wide | Define permanent deletion as non-Undoable consistently |
| Pinned note | V2 profile state | ○ | ○ | ○ | ○ | User-wide | Keep current behavior |
| Unresolved pinned-note candidate | V2 local recovery state + backup | × | ― | ○ | ○ | Device recovery | Keep device-local; explicit user resolution only |
| `ideasEnabled` | V2 user preference | ○ | × | ○ | ○ | User-wide | Feature meaning should follow the account |
| List display preferences | Local preferences | × | × | ○ | ○ | Device-specific | PC/mobile layouts may differ |
| Tree display preferences | Local preferences | × | × | ○ | ○ | Device-specific | Restore on the importing device |
| Reminder preferences | Local preferences | × | × | ○ | ○ | Device-specific | Avoid implicit notifications on every device |
| Theme | Local preferences | × | × | ○ | ○ | Device-specific | Respect per-device/system appearance |
| History | Local application envelope | × | ― | × | × | Device-specific | Do not transfer ephemeral operation history |
| WAL/outbox/revision | Local/cloud protocol storage | × | ― | × | × | Protocol-specific | Rebuild through normal import commands |
| Auth/OAuth | Managed security stores | × | ― | × | × | Security-specific | Never export secrets or sessions |
| Audit logs | Server audit storage | ― | ― | × | × | Server/user account | Retain independently of backup and content sync |
| Temporary UI state | Memory | × | × | × | × | Session-only | Intentionally transient |

## Known gaps

The facts below describe the current implementation. The recommendations are separate and require their own approved implementation work.

### 1. Persistent preferences Export/Import — resolved

**Current fact:** schema 4 retains schema 3's validated list/tree display, reminder, theme and feature preferences and adds recovery candidates. Import applies list/tree display, reminder and theme only to the importing device; imported `ideasEnabled` participates in its separately defined V2 Cloud Sync. Schemas 1/2 preserve current device settings because those schemas have no settings section.

### 2. `ideasEnabled` Cloud Sync — resolved

**Current fact:** `ideasEnabled` is a separate versioned V2 profile resource at `users/{uid}/profileV2/features`. Changes and schema-3 imports produce durable operations with revision, operation identity, echo/duplicate handling, restart recovery, and deterministic Node-style winner selection. It is intentionally excluded from Undo/Redo History. The AsyncStorage value is retained as the pre-V2 migration source and local cache.

Initial migration is deterministic: an existing Cloud record is authoritative; when no Cloud record exists, legacy `true` is promoted and legacy `false`/default emits no write. This prevents an arbitrary first OFF/default device from erasing an existing ON preference.

### 3. `legacyPinnedNoteCandidates` recovery — resolved

**Current fact:** conflicting pre-V2 local text is preserved inside the local V2 envelope and exposed in Settings for side-by-side comparison. A user can adopt it through the normal pinned-note V2 operation or explicitly discard it. Unresolved candidates are included in schema 4 Export/Import and are never automatically merged, overwritten, timestamp-selected, synchronized, or deleted.

**Cleanup rule:** only explicit adoption or discard removes a candidate. Production cutover alone is not a cleanup condition.

### 4. Purge Undo rules are inconsistent

**Current fact:** single-item permanent deletion uses `recordHistory: false`, while a batch permanent-deletion path passes through normal batch History. The purge-wins convergence rule prevents a stale normal record from reviving a tombstone.

**Target proposal:** formally define purge as non-Undoable and apply that rule to every single/batch entry point, or design a separate explicit recovery operation. Do not rely on an unusable History entry.

### 5. External AI directly operates V1 `nodes`

**Current fact:** [`firestoreNodeRepository.ts`](../functions/src/firestoreNodeRepository.ts) now reads V2 winners and produces transactional V2 operations with revision preconditions, stable producer/request identity, operation/request receipts, compatibility-gate enforcement, and audit. It has no V1 Node fallback. Production Functions deployment has not occurred, as recorded in [external-ai-mcp.md](external-ai-mcp.md).

**Remaining deployment gate:** deploy only as an explicitly coordinated part of V2 cutover; never enable this V2-only Functions build during a V1 phase or retain a V1-writing Functions build after cutover.

### 6. V1/V2 local-storage retirement is undefined

**Current fact:** V2 bypasses `@taskmemo/nodes/v1`, but the key is not retired. `@taskmemo/profile/pinned-note/v1` remains a migration source and compatibility mirror.

**Target proposal:** define the release, migration confirmation, retention period, and recovery evidence required before deleting or ignoring each V1 key permanently.

### 7. Foundation-only keys remain present

**Current fact:** `@taskmemo/sync-outbox/v1`, `@taskmemo/sync-v2/application/v1`, and `@taskmemo/sync-v2/application-journal/v1` belong to the standalone foundation/tests, not the current UI application store.

**Target proposal:** keep them explicitly test-only or remove/migrate them in a separately reviewed cleanup. They must not be mistaken for the authoritative V2 UI state.

## Update rules

This matrix is a maintained design baseline, not a one-time investigation record.

Whenever a new persistent field, resource, preference, cache, integration record, or migration marker is introduced, the same change must update this document and answer all of the following:

1. What is the authoritative data type and owner?
2. Where is it stored locally and/or remotely?
3. Is it active, legacy, migration-only, recovery-only, derived, or test-only?
4. Does it participate in Cloud Sync? If so, what are its revision, conflict, self-echo, duplicate, and acknowledgement rules?
5. Does it participate in Undo/Redo? If not, is exclusion intentional?
6. Is it exported?
7. Is it imported, and what happens when the field is absent in an older schema?
8. Does adding it require a backup schema migration, local-storage migration, or Firestore migration?
9. Is it user-wide, device-specific, or session-only?
10. What recovery path prevents data loss after crash, reinstall, offline use, or migration conflict?

A feature is not complete merely because its primary UI works. Its row in the Current matrix must match implementation and tests, and any intentional difference from the Target matrix must be recorded under Known gaps.
