# Sequential Task queues (#107)

## Approved MVP

The user approved the recommended specifications on 2026-10-31. A queue is an
ordinary Category with optional `taskQueue: true`; its Tasks are existing
MemoNodes with their original IDs. `parentId + sortKey` defines sequence,
`status` defines completion. There is no separate Task, cursor, saved head,
new collection, automatic migration or read-time write.

The deadline list filters each live queue to its earliest active, nondeleted,
nonpurged Task before ordinary deadline classification. Completed predecessors
are skipped. Returning an earlier Task to active rewinds visibility without
changing later completion records. All-complete queues remain available in
management and resume when a Task is added or restored. Multiple queues are
independent; overdue successors stay hidden until they become the head.

Task deletion is ordinary soft delete; the next Task appears, and restoration
recomputes the head. Taking a Task out moves that same Node into the queue's
ordinary parent (or unassigned). There is no dedicated skip state: reorder to
postpone. Queue dissolution moves every nondeleted Task, including completed
ones, to the ordinary parent and soft deletes only the container. Generic bulk
deletion follows this contract. Cascading deletion of a folder containing a
live queue is refused until its queue is dissolved. Purging a queue container
with live Tasks is also refused. Previously deleted Tasks remain in Trash.

No nested queue, Category child, Idea child, or implicit Routine conversion.
Direct and bulk movement, Memo conversion, creation, and Application text/raw
commands enforce the restrictions. Queue containers may be moved under ordinary
folders with existing tree operations. The general Memo editor remains the
editor for body/deadline/status; queue title editing and Task quick addition
are available in the queue screen.

## Persistence, concurrency and safety

The first concurrency test reproduced a real loss: completing and reordering
the same Task offline let the Node-level winner restore active status. Queue
participation therefore adds optional `queueState` to the same Memo payload:
independent versioned placement (`parentId`, `sortKey`) and completion
(`status`, ISO `completedAt`) registers. An explicit command stamps only these
registers; listeners never generate commands or Outbox entries. Changes to
different registers merge independently. Equal-version same-register conflicts
use sorted-key JSON ordering to converge independently of arrival order.
This does not promise to preserve both incompatible edits to the same field.
The rest of each Node keeps the existing revision/operation winner contract.

Undo/Redo stamps a newer version from the desired existing history snapshot.
The existing operation/revision replay guard remains. ACK/self-echo consumes
merged queue records, and the existing server transaction persists a register
contribution even when the full Node lost. Receipts and Outbox are reused.
Soft-delete dissolution moves are emitted as updates for retained Tasks.
Permanent tombstones are never resurrected by register merging.

Backup/V2 decoding validates optional metadata. Backup exports and imports
retain it; recovery/content field inventories recognize it. Text editing
preserves metadata and is checked at the Application command boundary. A queue
removed concurrently with another device inserting a Task can retain a child
under its deleted container: such a Task is not hidden by the live-queue filter,
and queue management offers the deleted queue for extraction/dissolution.
No automatic repair or data deletion is introduced.

Old data without queue metadata behaves as before. Old bundles do not understand
queue visibility or register edits. All participating DEV clients must use the
new bundle; old-client/MCP writer queue semantics are not guaranteed. Shared
Functions code is built/tested, not deployed. No Rules, Auth settings, production
data, or Production Hosting changes are part of this feature.

## GUI and regression evidence

Tree toolbar: `⏭ キュー管理`. Queue folders have a distinct icon. The manager
shows all queues and completion counts, every Task (including completed), the
next head, ordinary editing, completion/cancellation, up/down ordering,
extraction, adding existing Tasks, and dissolution confirmation. A queue or
queue Task menu opens `キュー全体・進捗` directly. Destructive confirmations are
inline at the top of the screen, not native JS dialogs. Controls use at least
44px targets and wrap on phones; input text is at least 16px.

Tests include head advancement/rewind, independent queues, all-complete resume,
deadline filtering, stable ties, same-ID extraction, bulk/cascade safety,
Routine/Idea/nesting rejection, backup, malformed registers, concurrent
completion/reordering, IndexedDB restart, offline Undo/Redo, failed save without
partial state/Outbox changes, and real component creation/three Tasks/edit/
completion/reorder/dissolution confirmation. Emulator uses only
`demo-taskmemo-v2`: real SDK/Rules/receipts, two sessions, offline competition,
restart, dissolution and Undo. Logs and final counts/SHA are recorded on #107.

The first feature test import failed because the module was not implemented;
after the basic implementation the offline concurrency test failed specifically
with expected completed/actual active. That regression passed after independent
register merging. An initial backup test harness incorrectly treated
`parseNodeBackup` as returning an object; it was corrected to its Node[] API.

Public DEV phone-width smoke also reproduced a quick-add race: typing the next
Task while the preceding save was pending let that save's completion clear the
new draft. A deferred-save component test failed with expected `next` / actual
empty. Completion now clears only the submitted draft if it is still unchanged;
the new draft is preserved. The regression and full verification pass afterward.

## DEV iPhone acceptance (keep #107 Open)

1. Refresh https://taskmemoapp-dev.firebaseapp.com/ and verify the Issue's DEV
   SHA. Refresh the other participating DEV device too. Do not clear site data.
2. Tree → queue management → create a queue with `仕様 / データモデル / GUI /
   テスト / リリース`. Create a second queue and an ordinary Task.
3. The daily list shows one head per queue plus the ordinary Task. Completing
   the first reveals the next. Via its menu open all steps and progress.
4. Undo/Redo and return an earlier Task to incomplete. Verify the head rewinds
   while later completed steps stay completed. Reorder, edit a successor's
   body/deadline, remove a head, and restore it from Trash.
5. Move an existing Task in/out and confirm its ID/content/deadline/history
   survive. Cancel and confirm queue dissolution; all retained Tasks, including
   completed ones, remain under the ordinary parent/unassigned.
6. Complete every step; the container remains with n/n, no head in the daily
   list. Add a step or uncomplete one to resume. Reload/restart and export /
   restore a DEV test backup, verifying progress and order.
7. With two DEV devices, test offline completion and reorder, reconnect in both
   orders, and verify the same head and completion. Test same-field contention
   separately: one deterministic result is expected, not preservation of two
   incompatible orders.
8. Check ordinary Memo/Task/Routine, History, Undo/Redo, sync and light/dark
   phone layout. Test deletion/restore only with disposable DEV data.

No Production release is authorized. iPhone and real-account multi-device
acceptance remain user gates, distinct from jsdom/Emulator success.
