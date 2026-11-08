# Issue #120: list emphasis — legacy synchronization safety gate

Status: **BLOCKED before feature implementation**. This branch is an investigation/review artifact, not a release candidate. No star UI, Node property, schema, sync behavior, Rules, or production data has been changed.

## Requested behavior and safety decision

#120 requires a dark-red, conspicuous ★ on selected list cards, list-menu ON/OFF, light/dark and iPhone support, durable restart/sync/backup behavior, unchanged completion/order, and no Routine side effects. The current user instruction overrides the Issue body's older deployment authorization: the development role must not deploy.

The prerequisite old-client gate is red. A plain optional Node boolean also fails the new acceptance gate. Consequently we stop before adding the field or UI. Sequential unknown-field round trips are insufficient evidence of safe mixed-version synchronization.

## Branch isolation

- Branch: `investigate/120-list-emphasis-compat`.
- Published base: `de5bd087f7603831216b4d10a38a7fb41aa76b43`, reachable from refreshed `origin/main`.
- The initial working tree was clean at `perf/startup-local-first`, HEAD `44623f899d8fc830f4f68e34d0098332bd78e71a`, with five commits not reachable from origin.
- This branch does not inherit those unpublished #116/startup commits, the Production-only unpublished chain, #107 Queue, or #114. The #109 implementation is already part of the published baseline/Production history; no #109 change was added here.
- The current Production reference from the previous investigation is `0c4ac60ef97ea8a80fca62fcaaf445d2c91143b1`. This branch deliberately does NOT roll that application back or replace it. The older published base is used only to make the investigation shareable without silently publishing unrelated local history.
- `src/sync/revisionModel.ts` has identical blob `dd57f764960e9518b80e77d3d2e9c2ad11e1af53` in de5bd08 and 0c4ac60. The relevant dependency files routineRoot, routineOutcomeMerge, routineLifecycleRegister and textFormat/syntax also have no source diff. The first probe used exact 0c4ac60 and de5bd08. The committed probe uses the published equivalent reducer and asserts its blob, so a reviewer does not need unpublished Git objects.

## Existing prerequisite failure

Re-ran the existing `scripts/check-queue-legacy-compat.mjs` in the original DEV worktree (44623f8, synthetic data only): **1/7 PASS, 6 FAIL, exit 1**. This matches the review report. The failure has not been skipped, relabeled PASS, or fixed under #120.

Upstream gate and analysis:
- https://github.com/yshtysht8sh10-glitch/TaskMemoApp/blob/f3c8253650657b66ac30edd6861ccd5903391ffa/scripts/check-queue-legacy-compat.mjs
- https://github.com/yshtysht8sh10-glitch/TaskMemoApp/blob/f3c8253650657b66ac30edd6861ccd5903391ffa/docs/ISSUE107_LEGACY_SYNC_COMPATIBILITY.md
- https://github.com/yshtysht8sh10-glitch/TaskMemoApp/issues/107#issuecomment-6541163991

That Queue gate is not included in this older-base branch because doing so would import unrelated implementation. Its recorded failure is a separate prerequisite, not the result of the new #120 gate.

## New acceptance gate: optional boolean candidate

Run with dependencies installed and full published Git history:

```powershell
npx tsx scripts/check-list-emphasis-legacy-compat.mjs report.json
```

The script archives published Git sources into a temporary fixture and uses actual revision reducers. It sends no Firebase request, reads no user storage, and does not alter the app. `listEmphasized` is a hypothetical payload field inside the fixture only; no model/codec/UI field was implemented.

|Acceptance check|Observed result|
|---|---|
|Old client has already received ★ and completes the Task sequentially|PASS: ★ and completion both survive|
|Old client sends an edit based on a snapshot from before ★ existed|FAIL: ★ becomes absent|
|Offline legacy completion arrives before a concurrent ★ edit|FAIL: completed becomes active|
|Offline legacy completion arrives after the concurrent ★ edit|FAIL: completed becomes active (the old intent may be superseded)|
|Old client edits its cached ★=true after another client explicitly set OFF|FAIL: OFF returns to true|

Final result: **1/5 PASS, 4 FAIL, exit 1**. The gate remains an intentionally failing release blocker, analogous to the upstream compatibility gate. Do not add it as an expected-pass test or weaken its assertions.

The completion operation and emphasis operation use the same base revision and valid distinct opIds. Their ordering is a legitimate example of a concurrent tie, not a claim that every operation is lost. The old payload that lacks ★ is naturally produced by a snapshot taken before the new field was observed; it does not assume that every old codec strips unknown fields.

Control without a new field: an ordinary body edit based on the same stale Node can also beat completion. Thus this is an existing full-Node LWW limitation, not proof that #120 created a new algorithm defect. Adding another display-only Node write would nevertheless add a trigger for completion rollback, violating the requested “display only / completion unchanged” safety requirement. We cannot call it safe simply because similar writes already exist.

## Why the small alternatives do not satisfy the current constraints

1. **Plain optional boolean**: minimal codec/backup change, but the acceptance failures above remain.
2. **Client-only independent version register**: old transactions still run old whole-Node winner selection. Superseded intent can remain in immutable receipts while disappearing from the current Node/ack. New receive-only merge is insufficient; the existing Queue gate demonstrates this class of failure.
3. **Separate per-Node attribute document/collection**: can isolate display writes from Task completion, but the current Rules default-deny unknown paths. The features document explicitly permits only `ideasEnabled`. A safe new namespace/permission contract needs separately reviewed changes, and Rules changes are forbidden in this task.
4. **Receipt-backed intent projection**: potentially viable, but changes protocol, source-of-truth, replay, repair, Outbox/receipt interpretation, backup and older-client semantics. This is not a minimal UI feature or an unreviewed workaround.
5. **Local-only emphasis**: can avoid Cloud Node writes, but fails the explicit cross-device sync requirement; it needs a user-approved scope change.

Do not encode a hidden flag in titles/bodies, reuse Routine lifecycle fields, create fake tombstone/hidden Nodes, or force old clients to reset. These would violate data meaning, Routine isolation or preservation constraints.

## Choices for review/user decision

- Recommended: resolve or separately approve an intent/metadata synchronization contract before implementing durable cross-device emphasis. Assess the Queue work as a related protocol concern; do not silently implement its backend/protocol under #120.
- Alternative: approve a dedicated attribute namespace with narrowly scoped permissions and explicit backup/Undo semantics. This requires lifting the present “no Rules changes” restriction through a separate task.
- Alternative: explicitly reduce MVP to device-local emphasis. Do not describe that variant as satisfying the current Issue.

No claim is made that all conceivable designs are impossible. The conclusion is that no safe minimal implementation under the current Node contract/constraints has been established. A reviewer must choose/review the architecture before the feature continues.

## Deferred feature design (not implemented)

After the storage contract is approved, scope the MVP to ordinary Memo/Task only. Routine definitions and daily/overdue projections must not expose the toggle or inherit a shared all-days flag accidentally. Preserve sort/deadline/status, use existing Application commands/Undo and validated persistence, and keep other screens unchanged. Render a large dark-red text ★ (not yellow emoji) with an accessible emphasis label and theme-specific contrast; test actual narrow layouts. These are acceptance requirements, not completed work.

## Validation and limits

- Known Queue gate: 1/7 PASS, six failures, exit 1.
- New emphasis safety gate: 1/5 PASS, four failures, exit 1, reproduced with exact Production reference and the published equivalent reducer.
- `node --check` and `git diff --check`: passed.
- No app/Functions/Rules source was changed. Full application tests, TypeScript, app lint and Web export were not rerun: the mandatory safety gate stopped work before a feature candidate existed. Prior green suites do not replace this failed gate.
- No visual/mobile, live Firebase, backup feature, or deployment result is claimed. No Production connection, Rules update, Journal/Outbox deletion, migration or deployment occurred.

## Reviewer handoff

Review the provenance/assumptions of the fixture, the completion and OFF-loss counterexamples, and the storage alternatives. This is a draft investigation review, not a ready-to-merge feature PR or release approval. Keep #120 Open. Development stops here pending the architecture decision. Implementation, full regression/build, DEV validation, review approval and a separately authorized release are future work for their respective roles.
