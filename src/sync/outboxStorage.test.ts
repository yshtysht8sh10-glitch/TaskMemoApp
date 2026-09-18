import { beforeEach, describe, expect, it, vi } from "vitest";

import { AsyncStorageSyncPersistence } from "./outboxStorage";
import { DurableOutbox } from "./outbox";

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {
  getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
} }));

describe("sync outbox persistence", () => {
  beforeEach(() => storage.clear());

  it("persists device identity, local sequence, payload, and pending operation", async () => {
    const persistence = new AsyncStorageSyncPersistence();
    const first = await DurableOutbox.open(persistence, { idFactory: () => "device-a" });
    const operation = await first.enqueue({ type: "update", targetNodeId: "memo", payload: { title: "B" }, createdAt: "2026-09-18T00:00:00.000Z" });
    const restored = await DurableOutbox.open(persistence, { idFactory: () => "must-not-change" });
    expect(operation).toMatchObject({ opId: "device-a:1", deviceId: "device-a", localSeq: 1, targetNodeId: "memo", type: "update" });
    expect(restored.deviceId).toBe("device-a");
    expect(restored.operations).toEqual([operation]);
    const next = await restored.enqueue({ type: "redo", targetNodeId: "memo", payload: { title: "C" }, createdAt: "2026-09-18T00:01:00.000Z" });
    expect(next.opId).toBe("device-a:2");
  });
});
