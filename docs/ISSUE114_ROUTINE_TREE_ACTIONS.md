# Routine tree definition actions (#114)

`NodeTree` already derives `MemoRow.routine` from `routineCategoryForMemo(nodes,
memo)` in both Web and Native renderers. Use that existing context to omit
the normal Task completion action for every definition, active or completed.
Do not use repeatRule alone to identify the context: daily projections still
need normal completion in DeadlineView.

Definition rows render only their menu, using the existing 42px-wide menu
target, instead of reserving the Task completion action width. The title can
use the freed space on narrow screens. Menu text retains the neutral action
color and stops event propagation to the row's edit action. Selection mode
still renders its existing selection controls. Tree layout and drag handlers
are unchanged. Imports in the three rendered components were made relative
to the same modules so the real components can be mounted in the existing
Vitest setup (the initial harness could not resolve the alias/mock pair).

No data or lifecycle changes. RoutineCompletionButton in the editor and
CompletedRoutines resume actions are unchanged. No sync, schema, Rules,
Functions, Auth or generation changes. Production remains de5bd08; this
change is for DEV only.

Regression: after fixing harness import resolution, the active-definition
case failed because its Task completion action was present; the other three
cases passed. After the rendering fix all four pass: active definition,
completed definition, ordinary Task, and daily projection. Real MemoRow and
MemoRowActions are mounted with RN primitives mocked; callbacks for menu,
open and long press, and absence of data mutations are checked. Related
RoutineCompletion, DeadlineView drag and lifecycle tests also pass (22
tests including the new file). Full verify, TypeScript, lint and Functions
build/unit pass. This does not replace real iPhone touch/viewport checks.

## iPhone DEV acceptance (keep Issue open)

1. Refresh https://taskmemoapp-dev.firebaseapp.com/ and check the SHA recorded
   in Issue #114. Do not clear site data.
2. Open the Routine tree. Active definitions have only the menu, without a
   normal Task completion button or an empty completion-button slot.
3. Turn on "完了を表示". Completed definitions also have only the menu;
   hierarchy, titles, cycle labels and completion markers remain visible.
4. Use a DEV test Routine's editor to cancel/confirm "Routineを完了"; resume
   it with the existing dedicated action. Check the completed definition list.
5. In the daily list, confirm ordinary Task and Routine today/past occurrence
   completion buttons still work (use test data only).
6. Confirm tree open/close, title editing, menus, selection, drag order and
   deletion confirmation entry points remain reachable on the phone. Test
   deletion only on a disposable DEV Routine.

DEV iPhone acceptance remains pending. Final SHA and build/deploy evidence
are recorded on the Issue; do not close it or deploy this UI to Production.
