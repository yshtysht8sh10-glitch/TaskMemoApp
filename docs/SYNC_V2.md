# TaskMemo sync V2 foundation

This document describes the state-machine and durable-outbox foundation. It is
not a production migration plan. V2 Firebase writes are restricted to the
development project or an explicitly selected Emulator.

## Responsibility boundary

```text
Domain state           Undo/Redo history         Sync foundation
current Node[]         past/future entries       identity + durable outbox
                                                state machine + adapter
```

A remote snapshot or acknowledgement is not an Undo/Redo event. The sync
foundation has no API that can replace `NodeHistory`.

## State machine

| State | Meaning | Entered by | Exited by | Pending operations |
|---|---|---|---|---|
| `connecting` | Adapter bootstrap is bounded by a timeout | engine start/reconnect | connected, offline, retrying, or error | may be zero or more |
| `synced` | Adapter is connected and durable outbox is empty | connect/ack with zero remaining | local operation or connection failure | always zero |
| `pending` | One or more durable operations await/in upload | enqueue, connected with restored work | ack, failure | always one or more |
| `offline` | Adapter reported no network | connect/upload failure | explicit/automatic retry | may be zero or more |
| `retrying` | Temporary failure is waiting for or running retry | timeout/temporary failure | ack, offline, next retry, or error | normally one or more |
| `error` | Permanent failure or retry limit reached | classified permanent failure/max attempts | user/system recovery action | failed operation is retained |

The reducer enforces the central invariant: `synced` is impossible while the
outbox contains an operation. A connect promise is wrapped in a timeout, so
`connecting` always transitions to another state.

## Durable outbox

AsyncStorage key: `@taskmemo/sync-outbox/v1`.

One JSON envelope stores `deviceId`, `nextLocalSeq`, and operations together.
Enqueue persists the incremented sequence and operation before returning.
Acknowledgement is the only successful path that removes an operation.
Failures update attempt metadata without deleting the payload.

Each operation contains:

- `opId` (`deviceId:localSeq`)
- persistent `deviceId`
- monotonically increasing `localSeq`
- `targetNodeId`, operation `type`, and payload
- ISO `createdAt`
- status, attempt count, next retry time, and last error

## Retry and adapter

Temporary failures use exponential delays (`base * 2^attemptCount`). Offline
failures retain work and wait for reconnect. Permanent failures, acknowledgement
mismatches, or the retry limit move to `error` while retaining the operation.
An interrupted `retrying` operation is loaded from AsyncStorage after restart.

`SyncAdapter` exposes only `connect()` and idempotent `upload(operation)`. The
Firebase implementation stores each operation at
`users/{uid}/syncOperationsV2/{opId}` in a transaction. If that document already
exists, the same `opId` is acknowledged without a second write.

## Revision and deterministic convergence

Each operation carries the revision it was based on. Its candidate revision is
`baseRevision + 1`; client wall-clock time is not part of winner selection.
Higher revisions win. Operations created concurrently from the same base have
the same candidate revision, so ties are resolved by deletion rank
(`purge > soft delete > normal`) and then lexicographically by globally unique
`opId`. This order is independent of upload or snapshot delivery order.

A purge tombstone dominates a normal Node even when a stale offline client
reconnects. Soft deletion wins same-revision ties and can only be undone later
by an explicit restore based on the deletion revision. Losing operations remain
in `syncOperationsV2` with a `superseded` acknowledgement and winning record for
future diagnostics.

The Firebase adapter transaction reads both the operation document and
`nodesV2/{nodeId}`. A new operation writes its acknowledgement and, only when it
wins, the Node record with a server timestamp. A repeated `opId` returns the
stored acknowledgement; reuse of the same ID with a different payload is a
permanent error.

## Echo and duplicate handling

`lastOpId` and `lastDeviceId` are stored with every versioned Node. An incoming
record from the installation's own device is a self echo: it acknowledges the
matching outbox item but does not reapply Domain state, create another
operation, or touch Undo/Redo history. Seen operation IDs are retained in a
bounded local list so duplicate listener delivery is ignored.

## Application command journal

The V2 application store persists three separate responsibilities in one
recoverable envelope:

```text
domain:  versioned Node records
history: past / future entries
sync:    outbox / seen operation IDs / device sequence
```

Before replacing the committed envelope, it writes the complete next envelope
to `@taskmemo/sync-v2/application-journal/v1`. The committed key is
`@taskmemo/sync-v2/application/v1`. Startup replays a remaining journal before
loading state. Therefore a crash between the visible Domain change and outbox
commit recovers both the Node and its exact operation, while a crash before the
journal retains the previous consistent state.

Normal edits, Undo, and Redo all call the same command path. Undo and Redo use
the current revision as their base and create a new operation/revision; they do
not move cloud time backward.

## Real Node codec and listener integration

The dev-only TaskMemo V2 store serializes every current Node field, including
tree/deadline sort keys, `duePreset` (`morning` and `afternoon` are the current
day-part representation), completion state, repeat rules, routine history,
soft-deletion metadata, and purge tombstones. Known Date fields use canonical
ISO strings in the revision payload. Decode also accepts Firestore Timestamp
values. Both directions spread the complete record so an unknown field from a
newer/legacy migration is not silently removed.

`TaskMemoV2SyncController` owns the dev listener lifecycle. Snapshot records go
through duplicate detection, self-echo detection, deterministic winner
selection, WAL persistence, and only then state refresh. Listener metadata
replays and reconnect re-delivery are harmless. Commands, Undo, and Redo enter
`pending` before upload; `synced` is emitted only after the WAL outbox is empty.
The existing v1 hook does not import this controller.

## Dev Firestore Rules responsibility

`firestore.dev.rules` is selected by `firebase.emulator.json` and was deployed
only to `taskmemoapp-dev`. Rules enforce authentication, path UID ownership,
an `ownerUid` equal to the authenticated UID, schema version 2, required
revision/operation identity fields, Node ID/path consistency, nondecreasing
revision, and immutable operation receipts. They do not choose a conflict
winner or validate TaskMemo business transitions; the transaction adapter and
domain tests own those responsibilities. Existing v1 `nodes` access remains
owner-only. All unspecified paths are denied.

## Cutover and migration plan (not executed)

1. Ship a minimum supported client that understands a server-controlled sync
   mode and refuses V1 writes once cutover begins. Old PWA service workers and
   Android builds are the main rollback risk; before migration, require a
   compatibility gate/forced refresh and server-side denial of legacy writes.
2. Take a read-only backup of `users/{uid}/nodes`. Convert each full V1 Node to
   `nodesV2` with `schemaVersion: 2`, `revision: 0`, a deterministic migration
   op ID/device ID, and preserved `updatedAt`, `purgedAt`, `routineHistory`, and
   unknown fields. `updatedAt` remains display/audit metadata, never ordering.
3. Do not migrate local Undo/Redo history. It is device-local UX state and may
   refer to pre-cutover revisions. Start history empty after a clearly signaled
   one-time cutover while preserving current Domain state.
4. Do not allow long-lived V1/V2 dual-write. During a short, observed migration
   window, V1 is the frozen source and V2 is read-back verified. Then switch the
   compatibility gate atomically to V2 and reject all V1 writes. A legacy
   client reconnect therefore cannot resurrect deleted or stale Nodes.
5. Verify per-user counts, IDs, tombstones, Routine histories, and content
   hashes before enabling V2 reads. Retain V1 backup and migration manifest.
6. Rollback means disabling V2 clients and restoring the immutable V1 backup;
   it is not a reverse merge. V2-only edits made after cutover require an
   explicit export/reconciliation tool before rollback.

## Remaining before production switch

- wire the controller into the React application behind a dev-only feature flag
  and run Web/Android UI smoke tests;
- add the compatibility/minimum-client gate that blocks stale V1 clients;
- implement and dry-run the per-user migration/read-back verifier and rollback
  tooling against copied dev data;
- decide retention/diagnostic export for superseded operations;
- repeat Emulator stress tests with process termination and flaky transport;
- obtain explicit approval for production Rules, migration, and client cutover.

The V2 foundation remains disconnected from the current V1 application hook.
Production migration and client cutover require a separate approval.
