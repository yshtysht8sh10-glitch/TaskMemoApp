# #107 legacy synchronization release blocker

## Decision (2026-10-31)

No production-code workaround or deployable replacement for `24d4b46` is
proposed by this investigation. Production remains `de5bd08`. The requirement
includes offline/concurrent legacy writes, not just sequential completion.
Changing only the new reader's field precedence cannot satisfy that contract.
This is the explicitly requested stop-and-propose-protocol path, not a fixed
release awaiting deployment. #107 and #114 remain open.

## Exact legacy reproduction

Run `npx tsx scripts/check-queue-legacy-compat.mjs report.json` from the repository.
The release gate extracts the exact `de5bd087f7603831216b4d10a38a7fb41aa76b43`
sources into a fresh OS temporary directory, links existing dependencies, and
imports its real revision model alongside the current one. It retains the
fixture for investigation. It uses synthetic values and never connects to
Firebase. Exit 1 means **blocked**, not an expected-success test. The gate is
separate from the existing Vitest suite; a green `npm run verify` is insufficient
for a legacy-compatible release. Do not weaken these assertions to unblock it.

Initial result: 1/7 pass, 6 failures. Failures cover legacy completion, legacy
cancellation, offline completion versus new reorder in both delivery orders,
unknown queue-field omission, and late legacy completion after dissolution and
new membership. New completion through a legacy transaction without contention
passes. These are revision/merge contract tests, not real-device/SDK tests.
Queue placement assertions pass where reached, but completion does not survive.

## Cause and why a reader-only patch is insufficient

1. Both versions store ordinary `status`/`completedAt` on the same Memo Node.
   New clients also store independent position/completion `queueState` registers.
2. Legacy `completeMemo` changes ordinary fields and preserves unknown fields;
   its Application command never stamps queue registers. New `mergeQueueValue`
   overwrites ordinary fields with the unchanged embedded register. Completion
   becomes active; cancellation has the symmetric failure.
3. Legacy `firebaseSyncAdapter` runs **its bundled** `applyRevisionOperation`
   inside the SDK transaction. This is not a centrally upgraded merge service.
   Legacy Node-level resolution chooses revision/deletion rank/opId. It can
   supersede an offline completion against a concurrent reorder and write no
   Node at all. ACK removes that operation from the legacy Outbox.
4. The immutable `syncOperationsV2` receipt DOES retain the original operation
   payload, including a superseded completion. It is not destroyed. However,
   current Node listeners/ACK merge do not reduce this receipt stream. A new
   Node reader cannot recover an edit absent from the Node it receives.
5. Promoting a raw/register discrepancy to register version + 1 only fixes the
   sequential case. It cannot recover a superseded edit. A payload omitting
   registers can also be an old snapshot rather than an intentional cancellation;
   accepting all Node winners as completion edits reintroduces lost completion.
   Preferring completed unconditionally makes intentional cancellation fail.

Ordinary completion history is projected from Node status/completedAt by
`completionHistoryGroups`; there is no independent ordinary-Task completion
event ledger. Thus losing status also removes the completion from that view.
Existing Routine history is a separate mechanism and is not a substitute.

## Recommended protocol extension (proposal, not implemented)

Use the existing immutable operation receipts as the input to a centralized,
idempotent queue projection/legacy bridge. A backend reducer is recommended over
requiring a particular new browser to stay online. Deploying only a new shared
TypeScript library does not update legacy SDK transactions or deployed MCP.

- New clients emit explicit queue membership/order and completion/cancellation
  intents with stable event IDs and observed per-field causal bases. Ordinary
  status/completedAt stay available to legacy readers. Preserve Node IDs.
- A backend receipt consumer handles both applied and superseded legacy writes.
  When a legacy payload retains queueState, compare ordinary fields to that
  embedded baseline to identify a completion/cancellation intent independently
  of placement. Deduplicate by opId; never invent an intent from a mere read.
- For missing metadata, recover the operation's observed baseline from retained
  revision/receipt information when possible. If the baseline or intent is
  ambiguous, retain the operation as an explicit unresolved conflict, show that
  sync is not fully converged, and require resolution. Do not silently overwrite
  state or claim all legacy writes are inferable.
- Preserve conflicting intents and completion timestamps in an immutable event
  history, including cancelled and superseded completions. Define causal
  ordering and deterministic concurrent tie resolution; surface same-field
  conflicts. Reordering must not advance the completion register.
- Recompute and transactionally persist the ordinary Node projection and queue
  metadata with an increasing revision, deduplicated projection identity and
  replay watermark. A later legacy Node write can temporarily race the bridge;
  reconcile it from receipts. Queue-capable readers must recognize pending
  projection and must not report convergence prematurely. Avoid recursive
  projection receipts and preserve existing operation idempotency.
- Dissolution/re-creation are membership events on the same Tasks; concurrent
  stale membership and deletion intents must be retained as conflicts, never
  interpreted as permission to erase Tasks. This proposal does not make legacy
  folder cascade deletion safe automatically; that requires explicit policy.
- Update MCP and client capabilities together. Feature readiness must distinguish
  a bridge-capable account/backend from the existing generic V2 protocol gate.
  Simply bumping minimumSyncProtocol blocks old writers rather than accepting
  their completion, so it does not by itself satisfy the requested compatibility.

### Rollout and migration proposal

1. Implement/test the bridge in DEV and demo Emulator first, with legacy code
   exercising actual SDK transactions and receipts in both reconnect orders.
   Include duplicates, restarts, dropped listener events, missing metadata,
   completion/cancellation conflicts, history, backups and membership changes.
2. Use additive metadata/event storage only. Preserve existing Nodes, receipts,
   IDs, timestamps and backup originals. Existing ordinary Production Tasks need
   no bulk rewrite. Existing DEV queues require a reviewed baseline capture and
   receipt reconciliation; do not synthesize missing completion history as fact.
3. Keep queues disabled for accounts without verified bridge readiness. Capture
   a read-only inventory before any future rollout. Backend deployment, capability
   changes and any baseline initialization need a separate reviewed plan and
   explicit authorization; none are performed by this investigation.
4. Stop/retry projection safely if partial. Roll back feature exposure while
   retaining events and all data; a Hosting rollback alone cannot undo a backend
   protocol change. Do not overwrite Production data from an old snapshot.

No Production Firestore, Rules, Functions, Auth or Hosting writes are authorized
or performed here. There is currently no safe new Production candidate SHA.
