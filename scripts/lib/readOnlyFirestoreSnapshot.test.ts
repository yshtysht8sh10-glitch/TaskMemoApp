import { describe, expect, it } from "vitest";
import { decodeFirestoreFields, productionV1ReadRequest } from "./readOnlyFirestoreSnapshot.mjs";

describe("read-only production snapshot boundary", () => {
  it("only constructs the fixed V1 collection-group read request", () => {
    const request = productionV1ReadRequest("taskmemoapp-eabc3", "read-only:taskmemoapp-eabc3");
    expect(request).toEqual({
      url: "https://firestore.googleapis.com/v1/projects/taskmemoapp-eabc3/databases/(default)/documents:runQuery",
      method: "POST",
      body: { structuredQuery: { from: [{ collectionId: "nodes", allDescendants: true }] } },
    });
    expect(() => productionV1ReadRequest("taskmemoapp-dev", "read-only:taskmemoapp-eabc3")).toThrow();
    expect(() => productionV1ReadRequest("taskmemoapp-eabc3", "write")).toThrow();
  });

  it("losslessly decodes nested REST values without normalizing application fields", () => {
    expect(decodeFirestoreFields({ nested: { mapValue: { fields: { values: { arrayValue: { values: [{ integerValue: "7" }, { nullValue: null }] } } } } }, stamp: { timestampValue: "2026-09-19T00:00:00Z" } })).toEqual({ nested: { values: [7, null] }, stamp: "2026-09-19T00:00:00Z" });
  });
});
