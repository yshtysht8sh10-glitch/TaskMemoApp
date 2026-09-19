import { describe, expect, it } from "vitest";

import { createFirebaseSyncAdapter } from "./firebaseSyncAdapter";

const firestore = (projectId: string) => ({ app: { options: { projectId } } });

describe("Firebase V2 adapter environment boundary", () => {
  it("allows production only with the exact production project", () => {
    expect(() => createFirebaseSyncAdapter(firestore("taskmemoapp-eabc3") as never, "uid", "production")).not.toThrow();
    expect(() => createFirebaseSyncAdapter(firestore("taskmemoapp-dev") as never, "uid", "production")).toThrow("disabled");
  });

  it("refuses a production project from development", () => {
    expect(() => createFirebaseSyncAdapter(firestore("taskmemoapp-eabc3") as never, "uid", "development")).toThrow("disabled");
  });

  it("allows test only when the caller explicitly selects an emulator", () => {
    expect(() => createFirebaseSyncAdapter(firestore("demo-taskmemo") as never, "uid", "test")).toThrow("disabled");
    expect(() => createFirebaseSyncAdapter(firestore("demo-taskmemo") as never, "uid", "test", { emulator: true })).not.toThrow();
  });
});
