import { describe, expect, it, vi } from "vitest";
import { generateNKeysBetween } from "fractional-indexing";

import type { ApplicationJournalPersistence } from "./applicationStore";
import { observePendingJournalReceipts, recoverV2ApplicationAfterAudit } from "./recovery";
import type { SyncAdapter } from "./types";

class Persistence implements ApplicationJournalPersistence {
  committed: string | null = null;
  journal: string | null = null;
  loadCommitted = async () => this.committed;
  loadJournal = async () => this.journal;
  writeJournal = async (value: string) => { this.journal = value; };
  writeCommitted = async (value: string) => { this.committed = value; };
  clearJournal = async () => { this.journal = null; };
}

const envelope = (nodes: number, outbox = 0) => {
  const keys = generateNKeysBetween(null, null, nodes);
  return JSON.stringify({
  version: 2, deviceId: "device-a", nextLocalSeq: 2,
  domain: Object.fromEntries(Array.from({ length: nodes }, (_, index) => [`node-${index}`, { value: {
    id: `node-${index}`, type: "memo", parentId: null, sortKey: keys[index], title: `memo-${index}`, body: "", dueAt: null,
    duePreset: "none", status: "active", completedAt: null, createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z", deletedAt: null,
  }, revision: 0, lastOpId: "initial", lastDeviceId: "initial", lastLocalSeq: 0, operationType: "import" }])),
  history: { past: [], future: [] }, sync: { outbox: Array.from({ length: outbox }, (_, index) => ({
    opId: `device-a:${index + 1}`, deviceId: "device-a", localSeq: index + 1, targetNodeId: `node-${index % nodes}`,
    type: "update", baseRevision: 0, payload: {}, createdAt: "2026-09-26T00:00:00.000Z",
    status: "pending", attemptCount: 0, nextRetryAt: null, lastError: null,
  })), seenOpIds: [] },
  profile: { pinnedNote: { localBody: "", synced: null, dirtySince: null, migrationPending: false, legacyUpdatedAt: null },
    legacyPinnedNoteCandidates: [], features: { localIdeasEnabled: false, synced: null, migrationPending: false } },
});
};

describe("journal recovery receipt barrier", () => {
  it("records receipt progress but never promotes or clears the journal in observation mode", async () => {
    const persistence = new Persistence();
    persistence.committed = envelope(150, 969);
    persistence.journal = envelope(151, 1024);
    const committed = persistence.committed;
    const journal = persistence.journal;
    const writeCommitted = vi.spyOn(persistence, "writeCommitted");
    const clearJournal = vi.spyOn(persistence, "clearJournal");
    const progress = vi.fn();
    const adapter = { connect: vi.fn(async () => undefined), auditOutbox: vi.fn(async () => ({ received: 900, missing: 124 })) } as unknown as SyncAdapter;
    expect(await observePendingJournalReceipts(persistence, adapter, progress)).toEqual({ hadJournal: true, auditResult: { received: 900, missing: 124 } });
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ recoveryPhase: "firebase-connect-start", receiptComparisonTotal: 1024 }));
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ recoveryPhase: "receipt-comparison-complete", receiptComparisonCompleted: 1024 }));
    expect(writeCommitted).not.toHaveBeenCalled();
    expect(clearJournal).not.toHaveBeenCalled();
    expect(persistence.committed).toBe(committed);
    expect(persistence.journal).toBe(journal);
  });
  it("preserves both snapshots exactly if Firebase audit is unknown", async () => {
    const persistence = new Persistence();
    persistence.committed = envelope(150, 969);
    persistence.journal = envelope(151, 1024);
    const auditOutbox = vi.fn(async (_operations: unknown[]) => { throw { kind: "offline", message: "unknown" }; });
    const adapter = { connect: vi.fn(async () => undefined), auditOutbox } as unknown as SyncAdapter;
    await expect(observePendingJournalReceipts(persistence, adapter, () => undefined)).rejects.toMatchObject({ kind: "offline" });
    expect(JSON.parse(persistence.committed!).domain).toHaveProperty("node-149");
    expect(JSON.parse(persistence.journal!).domain).toHaveProperty("node-150");
    expect(auditOutbox).toHaveBeenCalledTimes(1);
    expect(auditOutbox.mock.calls[0][0]).toHaveLength(1024);
  });

  it("never promotes the 151-Node journal based only on receipt counts", async () => {
    const persistence = new Persistence();
    persistence.committed = envelope(150, 969);
    persistence.journal = envelope(151, 1024);
    const auditOutbox = vi.fn(async (_operations: unknown[]) => ({ received: 0, missing: 1024 }));
    const adapter = { connect: vi.fn(async () => undefined), auditOutbox } as unknown as SyncAdapter;
    await expect(recoverV2ApplicationAfterAudit(persistence, adapter, { deviceId: "ignored" }, true))
      .rejects.toThrow("最終Preflight");
    expect(persistence.journal).toBe(envelope(151, 1024));
    expect(auditOutbox).not.toHaveBeenCalled();
  });

  it("preserves the established non-production journal path", async () => {
    const persistence = new Persistence();
    persistence.committed = envelope(1);
    persistence.journal = envelope(2);
    const adapter = { connect: vi.fn(async () => undefined),
      auditOutbox: vi.fn(async () => ({ received: 0, missing: 0 })) } as unknown as SyncAdapter;
    const store = await recoverV2ApplicationAfterAudit(persistence, adapter, { deviceId: "ignored" });
    expect(store.nodes).toHaveLength(2);
    expect(persistence.journal).toBeNull();
  });
});
