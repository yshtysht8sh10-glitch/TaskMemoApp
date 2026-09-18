import { describe, expect, it } from "vitest";

import { candidateForOperation, InMemoryRevisionServer, receiveVersionedNode } from "./revisionModel";
import type { SyncOperation, VersionedNode } from "./types";

const node = (title: string, purgedAt: string | null = null) => ({ id: "a", title, purgedAt });
const operation = (deviceId: string, localSeq: number, title: string, type: SyncOperation["type"] = "update", baseRevision = 10): SyncOperation => ({
  opId: `${deviceId}:${localSeq}`, deviceId, localSeq, targetNodeId: "a", type,
  baseRevision, payload: { node: node(title, type === "purge" ? "2026-09-18T00:00:00.000Z" : null) },
  createdAt: "2026-09-18T00:00:00.000Z", status: "pending", attemptCount: 0, nextRetryAt: null, lastError: null,
});
const initial: VersionedNode = { value: node("A"), revision: 10, lastOpId: "seed:10", lastDeviceId: "seed", lastLocalSeq: 10, operationType: "update" };

describe("revision model", () => {
  it("A: classifies own listener result as self echo without applying domain/history again", () => {
    const echo: VersionedNode = { ...initial, value: node("B"), revision: 11, lastOpId: "device-a:1", lastDeviceId: "device-a", lastLocalSeq: 1 };
    const received = receiveVersionedNode({ deviceId: "device-a", current: echo, seenOpIds: new Set(), historyRevision: 7 }, echo);
    expect(received).toMatchObject({ kind: "self-echo", current: echo, historyRevision: 7, createOutboxOperation: false });
  });

  it("B: applies a newer remote edit without touching local history", () => {
    const remote: VersionedNode = { ...initial, value: node("B"), revision: 11, lastOpId: "device-a:1", lastDeviceId: "device-a", lastLocalSeq: 1 };
    const received = receiveVersionedNode({ deviceId: "device-b", current: initial, seenOpIds: new Set(), historyRevision: 3 }, remote);
    expect(received).toMatchObject({ kind: "remote", current: remote, historyRevision: 3, createOutboxOperation: false });
  });

  it("C/D: concurrent edits converge to the same winner in either delivery order", () => {
    const editB = operation("device-a", 1, "B");
    const editC = operation("device-b", 1, "C");
    const forward = new InMemoryRevisionServer([initial]); forward.apply(editB); forward.apply(editC);
    const reverse = new InMemoryRevisionServer([initial]); reverse.apply(editC); reverse.apply(editB);
    expect(forward.get("a")).toEqual(reverse.get("a"));
    expect(forward.get("a")?.revision).toBe(11);
    const cloud = forward.get("a")!;
    const deviceA = receiveVersionedNode({ deviceId: "device-a", current: candidateForOperation(editB), seenOpIds: new Set(), historyRevision: 1 }, cloud).current;
    const deviceB = receiveVersionedNode({ deviceId: "device-b", current: candidateForOperation(editC), seenOpIds: new Set(), historyRevision: 1 }, cloud).current;
    expect(deviceA).toEqual(cloud);
    expect(deviceB).toEqual(cloud);
  });

  it("E: duplicate opId is acknowledged once without a second application", () => {
    const server = new InMemoryRevisionServer([initial]);
    const edit = operation("device-a", 1, "B");
    const first = server.apply(edit); const duplicate = server.apply(edit);
    expect(duplicate).toEqual(first);
    expect(server.processedOperationCount).toBe(1);
  });

  it("ignores duplicate listener delivery without changing history", () => {
    const incoming: VersionedNode = { ...initial, value: node("B"), revision: 11, lastOpId: "remote:1", lastDeviceId: "remote", lastLocalSeq: 1 };
    const result = receiveVersionedNode({ deviceId: "local", current: incoming, seenOpIds: new Set(["remote:1"]), historyRevision: 4 }, incoming);
    expect(result).toMatchObject({ kind: "duplicate", current: incoming, historyRevision: 4, createOutboxOperation: false });
  });

  it("retains a superseded operation result for future diagnosis", () => {
    const server = new InMemoryRevisionServer([{ ...initial, revision: 12 }]);
    const stale = operation("stale", 1, "lost", "update", 10);
    server.apply(stale);
    expect(server.acknowledgement(stale.opId)).toMatchObject({ result: "superseded", record: { revision: 12 } });
  });

  it("H: stale client cannot roll a newer revision backward", () => {
    const server = new InMemoryRevisionServer([{ ...initial, value: node("new"), revision: 12 }]);
    const result = server.apply(operation("stale", 1, "old", "update", 10));
    expect(result.result).toBe("superseded");
    expect(server.get("a")?.value.title).toBe("new");
  });

  it("I: purge tombstone wins over a stale or concurrent normal node", () => {
    const staleEdit = operation("device-z", 1, "resurrected", "update", 10);
    const purge = operation("device-a", 1, "deleted", "purge", 10);
    const forward = new InMemoryRevisionServer([initial]); forward.apply(purge); forward.apply(staleEdit);
    const reverse = new InMemoryRevisionServer([initial]); reverse.apply(staleEdit); reverse.apply(purge);
    expect(forward.get("a")).toEqual(reverse.get("a"));
    expect(forward.get("a")?.value.purgedAt).toBeTruthy();
  });
});
