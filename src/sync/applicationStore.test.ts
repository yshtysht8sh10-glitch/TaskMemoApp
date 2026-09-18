import { describe, expect, it } from "vitest";

import { V2ApplicationStore, type ApplicationJournalPersistence } from "./applicationStore";

class CrashPersistence implements ApplicationJournalPersistence {
  committed: string | null = null;
  journal: string | null = null;
  crashAfterJournal = false;
  async loadCommitted() { return this.committed; }
  async loadJournal() { return this.journal; }
  async writeJournal(value: string) { this.journal = value; }
  async writeCommitted(value: string) { if (this.crashAfterJournal) throw new Error("crash"); this.committed = value; }
  async clearJournal() { this.journal = null; }
}

describe("V2 application command journal", () => {
  it("F: recovers domain and matching outbox operation after a crash boundary", async () => {
    const persistence = new CrashPersistence();
    const store = await V2ApplicationStore.open(persistence, [{ id: "a", title: "A", purgedAt: null }], { idFactory: () => "device-a" });
    persistence.crashAfterJournal = true;
    await expect(store.execute("update", "a", { id: "a", title: "B", purgedAt: null })).rejects.toThrow("crash");
    persistence.crashAfterJournal = false;
    const recovered = await V2ApplicationStore.open(persistence, [], { idFactory: () => "other" });
    expect(recovered.node("a")?.value.title).toBe("B");
    expect(recovered.outbox).toHaveLength(1);
    expect(recovered.outbox[0].payload.node).toMatchObject({ title: "B" });
  });

  it("G: edit, undo, and redo are successive new revisions and operations", async () => {
    const persistence = new CrashPersistence();
    const store = await V2ApplicationStore.open(persistence, [{ id: "a", title: "A", purgedAt: null }], { idFactory: () => "device-a" });
    await store.execute("update", "a", { id: "a", title: "B", purgedAt: null });
    await store.undo();
    await store.redo();
    expect(store.outbox.map((item) => [item.type, item.baseRevision])).toEqual([["update", 0], ["undo", 1], ["redo", 2]]);
    expect(store.node("a")).toMatchObject({ revision: 3, value: { title: "B" } });
  });

  it("A: self echo acknowledges outbox without changing domain or Undo/Redo history", async () => {
    const persistence = new CrashPersistence();
    const store = await V2ApplicationStore.open(persistence, [{ id: "a", title: "A", purgedAt: null }], { idFactory: () => "device-a" });
    await store.execute("update", "a", { id: "a", title: "B", purgedAt: null });
    const beforeEcho = store.node("a");
    const historyBefore = store.historyDepths;
    expect(await store.receive(beforeEcho!)).toBe("self-echo");
    expect(store.node("a")).toEqual(beforeEcho);
    expect(store.historyDepths).toEqual(historyBefore);
    expect(store.outbox).toHaveLength(0);
  });
});
