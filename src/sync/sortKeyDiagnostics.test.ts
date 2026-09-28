import { afterEach, expect, it, vi } from "vitest";
import type { CategoryNode } from "../models/node";
import { getSortKeyDiagnostics, recordSortKeyPass } from "./sortKeyDiagnostics";

afterEach(() => vi.unstubAllGlobals());
it("records bounded field-free normalization and remote suppression counters", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } });
  const at = new Date("2026-09-28T00:00:00.000Z");
  const node: CategoryNode = { id: "private-id", type: "category", parentId: null, sortKey: "a0",
    title: "private-title", createdAt: at, updatedAt: at, deletedAt: null };
  recordSortKeyPass("remote-listener", [node], [{ ...node, sortKey: "a1" }], 0, at, 2);
  recordSortKeyPass("local-command", [{ ...node, sortKey: "a1" }], [{ ...node, sortKey: "a1" }], 0, at, 1);
  expect(getSortKeyDiagnostics()).toMatchObject({ normalizationPassCount: 2,
    scannedNodeCount: 2, changedNodeCount: 1, generatedOperationCount: 0,
    remoteOriginSuppressedCount: 1, suppressedNoOpOperationCount: 1,
    maxChangedNodesPerPass: 1, maxGeneratedOperationsPerPass: 0 });
  const serialized = [...values.values()].join("");
  expect(serialized).not.toContain("private-title");
  expect(serialized).not.toContain("private-id");
});
