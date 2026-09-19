import { beforeEach, describe, expect, it, vi } from "vitest";

import { createNode } from "../domain/nodeOperations";
import { loadPinnedNote, savePinnedNote } from "../services/pinnedNoteStorage";
import type { ApplicationJournalPersistence } from "./applicationStore";
import { InMemoryRevisionServer } from "./revisionModel";
import { TaskMemoV2ApplicationStore } from "./taskMemoApplicationStore";

const deviceStorage = vi.hoisted(() => ({ current: "device-a", values: new Map<string, string>() }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {
  getItem: vi.fn(async (key: string) => deviceStorage.values.get(`${deviceStorage.current}:${key}`) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { deviceStorage.values.set(`${deviceStorage.current}:${key}`, value); }),
  removeItem: vi.fn(async (key: string) => { deviceStorage.values.delete(`${deviceStorage.current}:${key}`); }),
} }));

class MemoryPersistence implements ApplicationJournalPersistence {
  committed: string | null = null;
  journal: string | null = null;
  loadCommitted = async () => this.committed;
  loadJournal = async () => this.journal;
  writeJournal = async (value: string) => { this.journal = value; };
  writeCommitted = async (value: string) => { this.committed = value; };
  clearJournal = async () => { this.journal = null; };
}

async function deliver(source: TaskMemoV2ApplicationStore, target: TaskMemoV2ApplicationStore, server: InMemoryRevisionServer) {
  for (const operation of source.outbox) {
    const acknowledgement = server.apply(operation);
    await source.acknowledge(operation.opId, acknowledgement.record, acknowledgement.pinnedNoteRecord);
    if (acknowledgement.record) await target.receive(acknowledgement.record);
    if (acknowledgement.pinnedNoteRecord) await target.receivePinnedNote(acknowledgement.pinnedNoteRecord);
  }
}

describe("V2 pinned note integration", () => {
  beforeEach(() => { deviceStorage.current = "device-a"; deviceStorage.values.clear(); });

  it("synchronizes an ordinary memo through V2 persistence, outbox, and remote apply", async () => {
    const a = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [], { deviceId: "device-a" });
    const b = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [], { deviceId: "device-b" });
    const server = new InMemoryRevisionServer();
    await a.command("Nodeを作成", "create", (nodes) => createNode(nodes, "memo", { title: "shared", parentId: null }, new Date(0), "memo-shared"));
    expect(a.outbox).toHaveLength(1);
    await deliver(a, b, server);
    expect(b.nodes.find((node) => node.id === "memo-shared")?.title).toBe("shared");
  });

  it("synchronizes a pinned note through V2 persistence, outbox, and remote apply", async () => {
    const a = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [], { deviceId: "device-a" });
    const b = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [], { deviceId: "device-b" });
    const server = new InMemoryRevisionServer();

    deviceStorage.current = "device-a";
    await savePinnedNote("shared pinned note");
    expect((await loadPinnedNote()).body).toBe("shared pinned note");
    await a.setPinnedNoteDraft("shared pinned note");
    await a.queuePinnedNoteOperation();
    await deliver(a, b, server);

    deviceStorage.current = "device-b";
    expect(a.outbox).toHaveLength(0);
    expect(b.pinnedNote.body).toBe("shared pinned note");
    await savePinnedNote(b.pinnedNote.body);
    expect((await loadPinnedNote()).body).toBe("shared pinned note");

    await b.setPinnedNoteDraft("back from device B");
    await b.queuePinnedNoteOperation();
    await deliver(b, a, server);
    expect(a.pinnedNote.body).toBe("back from device B");
  });
});
