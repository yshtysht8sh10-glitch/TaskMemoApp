import { beforeEach, describe, expect, it, vi } from "vitest";

import { AsyncStorageApplicationJournal } from "./applicationStorage";
import { V2ApplicationStore } from "./applicationStore";

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {
  getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
  removeItem: vi.fn(async (key: string) => { storage.delete(key); }),
} }));

describe("V2 application AsyncStorage journal", () => {
  beforeEach(() => storage.clear());

  it("round-trips domain, history, identity, and outbox in one committed envelope", async () => {
    const persistence = new AsyncStorageApplicationJournal();
    const first = await V2ApplicationStore.open(persistence, [{ id: "a", title: "A" }], { idFactory: () => "device-a" });
    await first.execute("update", "a", { id: "a", title: "B" });
    const restored = await V2ApplicationStore.open(persistence, [], { idFactory: () => "other" });
    expect(restored.node("a")).toMatchObject({ revision: 1, value: { title: "B" } });
    expect(restored.historyDepths).toEqual({ past: 1, future: 0 });
    expect(restored.outbox[0]).toMatchObject({ opId: "device-a:1", baseRevision: 0 });
    expect([...storage.keys()]).toEqual(["@taskmemo/sync-v2/application/v1"]);
  });
});
