import type { Node } from "../models/node";
import { parseTaskMemoBackup } from "../services/nodeBackup";
import { planV1ToV2Migration, type MigrationDryRun } from "./migrationDryRun";

export const PRODUCTION_V1_PROFILE_POLICY = {
  classification: "USER-APPROVED DATA LOSS" as const,
  pinnedNote: { body: "", updatedAt: "1970-01-01T00:00:00.000Z" },
  ideasEnabled: false,
  legacyPinnedNoteCandidates: [] as const,
};

export type PreparedV1Export = {
  exportedAt: string;
  nodes: Node[];
  canonicalNodes: Record<string, unknown>[];
  migration: MigrationDryRun;
  profilePolicy: typeof PRODUCTION_V1_PROFILE_POLICY;
};

export type NodeComparison = {
  nodeId: string;
  classification: "IDENTICAL" | "EXPORT_ONLY" | "FIRESTORE_ONLY" | "FIELD_DIFFERENCE";
  differingFields: string[];
  exportNode?: Record<string, unknown>;
  firestoreNode?: Record<string, unknown>;
};

const stable = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stable(item)]),
  );
  return value;
};
const record = (node: Node | Record<string, unknown>) => stable(node) as Record<string, unknown>;
const same = (left: unknown, right: unknown) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));

export function prepareSchema1V1Export(raw: string, migrationId: string): PreparedV1Export {
  let source: unknown;
  try { source = JSON.parse(raw); } catch { throw new Error("V1 Export is not valid JSON."); }
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("V1 Export root must be an object.");
  const envelope = source as Record<string, unknown>;
  if (envelope.schemaVersion !== 1) throw new Error("V1 Export schemaVersion must be exactly 1.");
  if (typeof envelope.exportedAt !== "string" || !Number.isFinite(Date.parse(envelope.exportedAt))) throw new Error("V1 Export exportedAt is invalid.");
  const parsed = parseTaskMemoBackup(raw);
  const migration = planV1ToV2Migration(parsed.nodes, migrationId);
  if (migration.issues.length) throw new Error(`V1 Export source validation failed with ${migration.issues.length} issue(s).`);
  if (migration.changedFields.length) throw new Error(`V1 Export requires ${migration.changedFields.length} semantic normalization(s).`);
  if (migration.lostFieldCount) throw new Error(`V1 Export would lose ${migration.lostFieldCount} field(s).`);
  return {
    exportedAt: new Date(envelope.exportedAt).toISOString(),
    nodes: parsed.nodes,
    canonicalNodes: parsed.nodes.map(record).sort((left, right) => String(left.id).localeCompare(String(right.id))),
    migration,
    profilePolicy: PRODUCTION_V1_PROFILE_POLICY,
  };
}

export function compareV1NodeSources(exportNodes: Node[], firestoreNodes: Record<string, unknown>[]): NodeComparison[] {
  const exportById = new Map(exportNodes.map((node) => [node.id, record(node)]));
  const firestoreById = new Map(firestoreNodes.map((node) => [String(node.id), record(node)]));
  const ids = [...new Set([...exportById.keys(), ...firestoreById.keys()])].sort();
  return ids.map((nodeId) => {
    const exportNode = exportById.get(nodeId);
    const firestoreNode = firestoreById.get(nodeId);
    if (!exportNode) return { nodeId, classification: "FIRESTORE_ONLY", differingFields: [], firestoreNode };
    if (!firestoreNode) return { nodeId, classification: "EXPORT_ONLY", differingFields: [], exportNode };
    if (same(exportNode, firestoreNode)) return { nodeId, classification: "IDENTICAL", differingFields: [], exportNode, firestoreNode };
    const fields = [...new Set([...Object.keys(exportNode), ...Object.keys(firestoreNode)])].sort();
    return {
      nodeId,
      classification: "FIELD_DIFFERENCE",
      differingFields: fields.filter((field) => !same(exportNode[field], firestoreNode[field])),
      exportNode,
      firestoreNode,
    };
  });
}
