import { describe, expect, it } from "vitest";
import { inferSyncOperationType } from "../sync/operationType";

describe("dev V2 UI command classification", () => {
  it("maps normal UI labels to explicit operation semantics", () => {
    expect(inferSyncOperationType("Nodeを作成")).toBe("create");
    expect(inferSyncOperationType("Memoを完了")).toBe("complete");
    expect(inferSyncOperationType("完了を元に戻す")).toBe("uncomplete");
    expect(inferSyncOperationType("Nodeを復元")).toBe("restore");
    expect(inferSyncOperationType("選択Nodeを完全削除")).toBe("purge");
    expect(inferSyncOperationType("データを読み込む")).toBe("import");
    expect(inferSyncOperationType("Memoタイトルを変更")).toBe("update");
  });
});
