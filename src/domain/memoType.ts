import type { MemoNode, MemoType, Node } from "@/models/node";
import { routineCategoryForMemo } from "./routine";

export const memoTypeOf = (memo: MemoNode): MemoType =>
  memo.memoType === "idea" ? "idea" : "task";
export const isIdea = (memo: MemoNode) => memoTypeOf(memo) === "idea";
export const isTask = (memo: MemoNode) => memoTypeOf(memo) === "task";

export function convertMemoType(
  nodes: Node[],
  id: string,
  memoType: MemoType,
  now = new Date(),
) {
  const memo = nodes.find(
    (node): node is MemoNode =>
      node.id === id &&
      node.type === "memo" &&
      node.deletedAt === null &&
      !node.purgedAt,
  );
  if (!memo) throw new Error("変換するMemoが見つかりません。");
  if (memoTypeOf(memo) === memoType) return nodes;
  if (memoType === "idea" && routineCategoryForMemo(nodes, memo))
    throw new Error("ルーティーン内のTaskはIdeaへ変換できません。");
  return nodes.map((node): Node => {
    if (node.id !== id || node.type !== "memo") return node;
    if (memoType === "task")
      return {
        ...node,
        memoType: "task",
        dueAt: null,
        duePreset: "none",
        status: "active",
        completedAt: null,
        repeatRule: null,
        updatedAt: now,
      };
    const {
      routineHistory: _routineHistory,
      deadlineSortKey: _deadlineSortKey,
      ...common
    } = node;
    return {
      ...common,
      memoType: "idea",
      dueAt: null,
      duePreset: "none",
      status: "active",
      completedAt: null,
      repeatRule: null,
      updatedAt: now,
    };
  });
}
