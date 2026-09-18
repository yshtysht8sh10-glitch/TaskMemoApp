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

Revision assignment, self-echo handling, remote Node application, and conflict
resolution belong to the next phase and are intentionally absent here.
