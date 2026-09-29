import { describe, expect, it } from "vitest";
import { memoCreationNotice } from "./memoCreationFeedback";

describe("メモ追加の通知", () => {
  it("追加成功時だけタイトルを含む通知を作る", () => {
    expect(memoCreationNotice(true, "memo-1", "買い物", "token-1")).toEqual({
      kind: "created",
      id: "memo-1",
      title: "買い物",
      token: "token-1",
    });
    expect(memoCreationNotice(false, "memo-1", "買い物", "token-2")).toBeNull();
  });
});
