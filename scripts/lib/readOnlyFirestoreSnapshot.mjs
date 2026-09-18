const PRODUCTION_PROJECT = "taskmemoapp-eabc3";

export function productionV1ReadRequest(projectId, confirmation) {
  if (projectId !== PRODUCTION_PROJECT || confirmation !== `read-only:${PRODUCTION_PROJECT}`)
    throw new Error("Production snapshot requires the exact read-only project confirmation.");
  return {
    url: `https://firestore.googleapis.com/v1/projects/${PRODUCTION_PROJECT}/databases/(default)/documents:runQuery`,
    method: "POST",
    body: {
      structuredQuery: {
        from: [{ collectionId: "nodes", allDescendants: true }],
      },
    },
  };
}

export function decodeFirestoreValue(value) {
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("stringValue" in value) return value.stringValue;
  if ("bytesValue" in value) return { __firestoreBytes: value.bytesValue };
  if ("referenceValue" in value) return { __firestoreReference: value.referenceValue };
  if ("geoPointValue" in value) return { __firestoreGeoPoint: value.geoPointValue };
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(decodeFirestoreValue);
  if ("mapValue" in value) return decodeFirestoreFields(value.mapValue.fields ?? {});
  throw new Error(`Unsupported Firestore value: ${Object.keys(value).join(",")}`);
}

export function decodeFirestoreFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]));
}
