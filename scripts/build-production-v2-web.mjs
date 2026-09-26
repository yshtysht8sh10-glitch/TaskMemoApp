import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const environmentFile = ".env.production-v2.local";
const envFile = readFileSync(environmentFile, "utf8");
if (!/EXPO_PUBLIC_TASKMEMO_ENV\s*=\s*["']?production/.test(envFile) || !/EXPO_PUBLIC_FIREBASE_PROJECT_ID\s*=\s*["']?taskmemoapp-eabc3/.test(envFile))
  throw new Error(`Production V2 export requires ${environmentFile} for taskmemoapp-eabc3.`);
const parsed = Object.fromEntries(envFile.split(/\r?\n/).map(line => line.match(/^\s*([A-Z0-9_]+)\s*=\s*["']?(.*?)["']?\s*$/)).filter(Boolean).map(match => [match[1], match[2]]));
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const env = { ...process.env, ...parsed, TASKMEMO_ENV_FILE: environmentFile, EXPO_PUBLIC_BUILD_SHA: commit, EXPO_PUBLIC_TASKMEMO_ENV: "production", EXPO_PUBLIC_SYNC_V2_ENABLED: "true", EXPO_PUBLIC_RECOVERY_OBSERVATION_ONLY: "true", EXPO_PUBLIC_RELEASE_CHANNEL: "production-v2-cutover" };
execFileSync(process.execPath, ["scripts/verify-firebase-environment.js"], { stdio: "inherit", env });
const exported = spawnSync("npx", ["expo", "export", "--platform", "web", "--clear"], { stdio: "inherit", env, shell: process.platform === "win32" });
if (exported.status !== 0) process.exit(exported.status ?? 1);
execFileSync(process.execPath, ["scripts/stamp-storage-diagnostics.mjs", commit], { stdio: "inherit", env });
execFileSync(process.execPath, ["scripts/verify-firebase-web-export.js"], { stdio: "inherit", env });
const files = directory => readdirSync(directory).flatMap(name => { const path = join(directory, name); return statSync(path).isDirectory() ? files(path) : [path]; }).filter(path => !path.endsWith("taskmemo-build-manifest.json")).sort();
const artifactHash = createHash("sha256");
for (const path of files("dist")) artifactHash.update(relative("dist", path).replaceAll("\\", "/")).update("\0").update(readFileSync(path));
const manifest = { schemaVersion: 1, builtAt: new Date().toISOString(), environment: "production", firebaseProjectId: "taskmemoapp-eabc3", syncV2Enabled: true, recoveryObservationOnly: true, releaseChannel: "production-v2-cutover", commit, artifactPath: "dist", canonicalArtifactSha256: artifactHash.digest("hex") };
writeFileSync("dist/taskmemo-build-manifest.json", JSON.stringify(manifest, null, 2), { flag: "wx" });
console.log("Production V2 web artifact exported locally only; no deploy was performed.");
