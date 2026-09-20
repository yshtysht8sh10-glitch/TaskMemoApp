import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Usage: node scripts/create-cutover-release-manifest.mjs <private-input.json> <new-private-manifest.json>");
const input = JSON.parse(readFileSync(inputPath, "utf8"));
const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const requireArtifact = (name, artifact) => {
  if (!artifact || !["READY", "BLOCKED"].includes(artifact.status)) throw new Error(`${name} must explicitly be READY or BLOCKED.`);
  if (artifact.status === "BLOCKED") { if (!artifact.reason) throw new Error(`${name} BLOCKED reason is required.`); return `${name}: ${artifact.reason}`; }
  if (!artifact.path || !artifact.sha256 || hash(artifact.path) !== artifact.sha256) throw new Error(`${name} artifact hash mismatch.`);
  return null;
};
const blockers = [
  requireArtifact("functionsRollback", input.functionsRollback), requireArtifact("pwa", input.pwa),
  requireArtifact("android", input.android), requireArtifact("immutableBackup", input.immutableBackup),
  requireArtifact("canary", input.canary), requireArtifact("canaryRehearsal", input.canaryRehearsal),
].filter(Boolean);
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const manifest = {
  schemaVersion: 1, kind: "taskmemo-v2-cutover-release-manifest", decision: blockers.length ? "BLOCKED_CUTOVER_MATERIALS" : "READY_FOR_PHASE_0",
  generatedAt: new Date().toISOString(), productionProjectId: "taskmemoapp-eabc3", migrationId: "iphone-authoritative-20260920",
  authoritativeSource: { sha256: "4da5ae29e427831025da485e40f84fc21180591421c40b26e62d3d7817bcae73", nodeCount: 124 },
  gitCommit: commit, adminToolingCommit: commit, runbookCommit: commit,
  artifacts: { functionsRollback: input.functionsRollback, pwa: input.pwa, android: input.android, immutableBackup: input.immutableBackup, canary: input.canary, canaryRehearsal: input.canaryRehearsal },
  repositoryHashes: {
    firebaseCutoverJson: hash("firebase.cutover.json"), firestoreRules: hash("firestore.dev.rules"), rootPackage: hash("package.json"), rootLockfile: hash("package-lock.json"),
    functionsPackage: hash("functions/package.json"), functionsLockfile: hash("functions/package-lock.json"), runbook: hash("docs/SYNC_V2_CUTOVER_RUNBOOK.md"), adminTooling: hash("docs/PRODUCTION_ADMIN_TOOLING.md"),
  },
  expectedProfile: { pinnedNote: "", ideasEnabled: false, legacyPinnedNoteCandidates: 0 },
  userApprovedDataLoss: ["ipa-morning", "legacy pinnedNote value", "legacy ideasEnabled value", "legacyPinnedNoteCandidates"],
  excludedNodeIds: ["ipa-morning"], expectedSemanticChanges: 0, expectedLostFields: 0, blockers,
};
writeFileSync(outputPath, JSON.stringify(manifest, null, 2), { flag: "wx" });
console.log(JSON.stringify({ decision: manifest.decision, outputPath, sha256: hash(outputPath), blockers }));
if (blockers.length) process.exitCode = 2;
