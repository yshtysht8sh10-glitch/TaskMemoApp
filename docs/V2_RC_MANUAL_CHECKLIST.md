# V2 release-candidate manual checklist

RC identity: `v2-rc-20260919`. All builds and the PWA point to `taskmemoapp-dev`; production project `taskmemoapp-eabc3` is rejected by runtime configuration. The sync panel must display `DEV環境` and `同期プロトコル: V2` before testing.

Use the dedicated RC account delivered with the RC links. Do not use a production account. Use the PWA in a normal browser plus iPhone/Android builds as three distinct clients.

## Safety preflight

1. Open Settings → Cloud sync.
2. Confirm `DEV環境 · 本番データには接続しません` and `同期プロトコル: V2`.
3. STOP immediately if either is absent or if the project/account is unexpected.

## Functional sequence

- Create Category A/B; rename A; move A under B and back to root.
- Create a Task Memo in A; change title/body; move within A and then to B.
- Change due date through today/tomorrow/custom and each enabled day-part grouping.
- Enable Idea, create/edit/move an Idea, and confirm it has no completion/due controls.
- Under Routine, create daily and weekly items; edit, complete today's occurrence, then cancel completion.
- Complete/uncomplete the normal Memo.
- Delete the Memo, confirm Trash, restore it, and confirm its original parent/order.

## Multi-client and offline

- iPhone create → verify Android/PWA receives it.
- PWA edit → verify iPhone receives it.
- On one client use the RC-only Emulator/transport pause when available, or disable connectivity; edit; edit the same Node on another client; reconnect and verify all clients converge.
- Verify the sync label transitions through pending/offline and returns to synced.

## Mandatory #45 regression

1. Edit a title.
2. Undo.
3. Wait until sync shows synced, then wait another five seconds.
4. Confirm Redo is still enabled.
5. Redo.
6. Wait until synced, then another five seconds.
7. Confirm the Redo result remains on every client and does not revert.

Record device/browser versions, timestamps, pass/fail, screenshots for failures, and whether pending outbox cleared. Issue #45 stays open until this checklist passes.
