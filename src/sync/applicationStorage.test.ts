import { beforeEach, describe, expect, it, vi } from "vitest";

import { AsyncStorageApplicationJournal, TaskMemoV2ApplicationJournal, claimNativeScopeWriter } from "./applicationStorage";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { V2ApplicationStore } from "./applicationStore";

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {
  getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
  removeItem: vi.fn(async (key: string) => { storage.delete(key); }),
} }));

describe("V2 application AsyncStorage journal", () => {
  it('rejects a second Native writer and unowned writes while allowing backup reads', async () => {
    const lease = claimNativeScopeWriter('exclusive-native');
    try {
      expect(() => claimNativeScopeWriter('exclusive-native')).toThrow();
      const owner = new TaskMemoV2ApplicationJournal('exclusive-native', lease.token);
      const other = new TaskMemoV2ApplicationJournal('exclusive-native');
      await owner.writeAtomic(null, 'owned');
      await expect(other.writeCommitted('overwrite')).rejects.toThrow();
      expect(await other.loadCommitted()).toBe('owned');
    } finally { lease.release(); }
  });
  beforeEach(() => storage.clear());

  it('native text commit replaces one envelope without a replayable journal', async () => {
    const p = new TaskMemoV2ApplicationJournal('native-text');
    await p.writeCommitted('before');
    const failure = vi.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('quota'));
    try { await expect(p.writeAtomic('before', 'after')).rejects.toThrow('quota'); }
    finally { failure.mockRestore(); }
    expect(await p.loadCommitted()).toBe('before'); expect(await p.loadJournal()).toBeNull();
    await p.writeAtomic('before', 'after'); expect(await p.loadCommitted()).toBe('after');
    await expect(p.writeAtomic('before', 'stale')).rejects.toThrow('更新');
    expect([...storage.keys()]).toHaveLength(1);
  });

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
