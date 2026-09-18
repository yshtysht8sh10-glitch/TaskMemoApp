import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";

import type { MemoNode } from "@/models/node";
import { nodeFromV2Value, nodeToV2Value } from "./nodeV2Codec";

describe("V2 Node codec", () => {
  it("round-trips every persisted Memo field and preserves unknown migration fields", () => {
    const at = new Date("2026-09-18T01:02:03.000Z");
    const source = {
      id: "memo-a", type: "memo", memoType: "task", parentId: "category-a", sortKey: "a0",
      deadlineSortKey: "d0", title: "Title", body: "Body", dueAt: at, duePreset: "afternoon",
      status: "completed", completedAt: at, repeatRule: { frequency: "week", interval: 2, startsOn: "2026-09-18", weekdays: [1, 5] },
      routineHistory: { "2026-09-18": at.toISOString(), "2026-09-17": null }, createdAt: at, updatedAt: at,
      deletedAt: null, deletionBatchId: "batch-a", purgedAt: null, futureField: { retained: true },
    } as MemoNode & { futureField: { retained: boolean } };
    const encoded = nodeToV2Value(source);
    expect(encoded.createdAt).toBe(at.toISOString());
    expect(nodeFromV2Value(encoded)).toEqual(source);
  });

  it("decodes Firestore Timestamp values without discarding unknown fields", () => {
    const at = new Date("2026-09-18T01:02:03.000Z");
    const decoded = nodeFromV2Value({
      id: "category-a", type: "category", parentId: null, sortKey: "a0", title: "Category",
      createdAt: Timestamp.fromDate(at), updatedAt: Timestamp.fromDate(at), deletedAt: null,
      categoryKind: "routineWeekly", routineWeekday: 5, unknownLegacyValue: "keep",
    });
    expect(decoded.createdAt).toEqual(at);
    expect((decoded as unknown as Record<string, unknown>).unknownLegacyValue).toBe("keep");
  });
});
