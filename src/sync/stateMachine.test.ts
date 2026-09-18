import { describe, expect, it } from "vitest";

import { initialSyncState, transitionSyncState } from "./stateMachine";

describe("sync state machine", () => {
  it("moves through connecting, synced, pending, retrying, offline, and error", () => {
    let state = initialSyncState();
    expect(state.phase).toBe("connecting");
    state = transitionSyncState(state, { type: "connected", pendingCount: 0 });
    expect(state.phase).toBe("synced");
    state = transitionSyncState(state, { type: "local-operation", pendingCount: 1 });
    expect(state.phase).toBe("pending");
    state = transitionSyncState(state, { type: "failure", kind: "temporary", pendingCount: 1, message: "retry" });
    expect(state.phase).toBe("retrying");
    state = transitionSyncState(state, { type: "failure", kind: "offline", pendingCount: 1, message: "offline" });
    expect(state.phase).toBe("offline");
    state = transitionSyncState(state, { type: "failure", kind: "permanent", pendingCount: 1, message: "denied" });
    expect(state.phase).toBe("error");
  });

  it("does not report synced until every operation is acknowledged", () => {
    const pending = transitionSyncState(initialSyncState(2), { type: "acknowledged", pendingCount: 1 });
    const empty = transitionSyncState(pending, { type: "acknowledged", pendingCount: 0 });
    expect(pending.phase).toBe("pending");
    expect(empty.phase).toBe("synced");
  });
});
