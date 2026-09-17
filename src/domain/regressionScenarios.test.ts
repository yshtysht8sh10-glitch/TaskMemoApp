import { describe, expect, it } from "vitest";

import {
  commitNodeHistory,
  createNodeHistory,
  redoNodeHistory,
  undoNodeHistory,
} from "./nodeHistory";
import {
  completeMemo,
  createNode,
  moveNode,
  softDeleteNode,
  updateNode,
} from "./nodeOperations";
import { localDateKey } from "./routine";
import type { CategoryNode, MemoNode, Node } from "@/models/node";

const at = (minute: number) => new Date(2026, 8, 17, 10, minute);
const category = (id: string, sortKey: string): CategoryNode => ({
  id,
  type: "category",
  parentId: null,
  sortKey,
  title: id,
  createdAt: at(0),
  updatedAt: at(0),
  deletedAt: null,
});

const memoState = (nodes: Node[]) => {
  const memo = nodes.find((node) => node.id === "memo");
  if (!memo || memo.type !== "memo") throw new Error("memo expected");
  return {
    title: memo.title,
    body: memo.body,
    parentId: memo.parentId,
    sortKey: memo.sortKey,
    duePreset: memo.duePreset,
    dueAt: memo.dueAt,
    status: memo.status,
    completedAt: memo.completedAt,
  };
};

describe("user operation regression scenarios", () => {
  it("追加→本文を含む編集→Category移動→期限変更→完了を連続Undo/Redoできる", () => {
    let history = createNodeHistory([
      category("inbox", "a0"),
      category("work", "a1"),
    ]);

    history = commitNodeHistory(history, "Memo追加", (nodes) =>
      createNode(
        nodes,
        "memo",
        { title: "draft", parentId: "inbox" },
        at(1),
        "memo",
      ),
    );
    history = commitNodeHistory(history, "Memo編集", (nodes) =>
      updateNode(
        nodes,
        "memo",
        { title: "release", body: "release notes" },
        at(2),
      ),
    );
    history = commitNodeHistory(history, "Category移動", (nodes) =>
      moveNode(nodes, "memo", "work", undefined, at(3)),
    );
    const dueAt = new Date(2026, 8, 20, 23, 59, 59, 999);
    history = commitNodeHistory(history, "期限変更", (nodes) =>
      updateNode(
        nodes,
        "memo",
        { duePreset: "custom", dueAt },
        at(4),
      ),
    );
    history = commitNodeHistory(history, "完了", (nodes) =>
      completeMemo(nodes, "memo", at(5)),
    );

    const completed = memoState(history.nodes);
    expect(completed).toMatchObject({
      title: "release",
      body: "release notes",
      parentId: "work",
      duePreset: "custom",
      dueAt,
      status: "completed",
      completedAt: at(5),
    });
    expect(completed.sortKey).toBeTruthy();

    history = undoNodeHistory(history);
    expect(memoState(history.nodes)).toMatchObject({
      status: "active",
      completedAt: null,
      dueAt,
    });
    history = undoNodeHistory(history);
    expect(memoState(history.nodes)).toMatchObject({
      parentId: "work",
      duePreset: "none",
      dueAt: null,
    });
    history = undoNodeHistory(history);
    expect(memoState(history.nodes)).toMatchObject({
      title: "release",
      body: "release notes",
      parentId: "inbox",
    });

    history = redoNodeHistory(history);
    history = redoNodeHistory(history);
    history = redoNodeHistory(history);
    expect(memoState(history.nodes)).toEqual(completed);

    history = undoNodeHistory(history);
    history = undoNodeHistory(history);
    history = undoNodeHistory(history);
    history = undoNodeHistory(history);
    history = undoNodeHistory(history);
    expect(history.nodes.some((node) => node.id === "memo")).toBe(false);

    history = redoNodeHistory(history);
    history = redoNodeHistory(history);
    history = redoNodeHistory(history);
    history = redoNodeHistory(history);
    history = redoNodeHistory(history);
    expect(memoState(history.nodes)).toEqual(completed);
  });

  it("Category subtree削除をUndoで一括復元しRedoで同じ対象を再削除できる", () => {
    const parent = category("parent", "a0");
    const child = { ...category("child", "a1"), parentId: "parent" };
    const memo = createNode(
      [parent, child],
      "memo",
      { title: "nested", parentId: "child" },
      at(1),
      "memo",
    ).find((node) => node.id === "memo");
    if (!memo) throw new Error("memo expected");

    let history = createNodeHistory([parent, child, memo]);
    history = commitNodeHistory(history, "Category subtree削除", (nodes) =>
      softDeleteNode(nodes, "parent", true, at(2)),
    );
    expect(history.nodes.every((node) => node.deletedAt?.getTime() === at(2).getTime())).toBe(true);

    history = undoNodeHistory(history);
    expect(history.nodes.every((node) => node.deletedAt === null)).toBe(true);
    expect(history.nodes.find((node) => node.id === "child")?.parentId).toBe("parent");
    expect(history.nodes.find((node) => node.id === "memo")?.parentId).toBe("child");

    history = redoNodeHistory(history);
    expect(history.nodes.every((node) => node.deletedAt?.getTime() === at(2).getTime())).toBe(true);
  });

  it("Routine occurrence完了をUndo/RedoしてDefinition自体の状態を変えない", () => {
    const routineRoot: Node = {
      ...category("routine", "a0"),
      categoryKind: "routineRoot",
    };
    const routineMemo: MemoNode = {
      id: "memo",
      type: "memo",
      parentId: "routine",
      sortKey: "a0",
      title: "routine",
      body: "",
      dueAt: null,
      duePreset: "none",
      status: "active",
      completedAt: null,
      repeatRule: { frequency: "day", interval: 1, startsOn: "2026-09-17" },
      createdAt: at(0),
      updatedAt: at(0),
      deletedAt: null,
    };
    const key = localDateKey(at(5));
    let history = createNodeHistory([routineRoot, routineMemo]);

    history = commitNodeHistory(history, "Routine occurrence完了", (nodes) =>
      completeMemo(nodes, "memo", at(5)),
    );
    expect(memoState(history.nodes)).toMatchObject({ status: "active", completedAt: null });
    expect((history.nodes[1] as MemoNode).routineHistory?.[key]).toBeTruthy();

    history = undoNodeHistory(history);
    expect((history.nodes[1] as MemoNode).routineHistory?.[key]).toBeNull();
    expect(memoState(history.nodes)).toMatchObject({ status: "active", completedAt: null });

    history = redoNodeHistory(history);
    expect((history.nodes[1] as MemoNode).routineHistory?.[key]).toBeTruthy();
    expect(memoState(history.nodes)).toMatchObject({ status: "active", completedAt: null });
  });
});
