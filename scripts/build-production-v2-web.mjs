import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const envFile = readFileSync(".env.local", "utf8");
if (!/EXPO_PUBLIC_TASKMEMO_ENV\s*=\s*["']?production/.test(envFile) || !/EXPO_PUBLIC_FIREBASE_PROJECT_ID\s*=\s*["']?taskmemoapp-eabc3/.test(envFile))
  throw new Error("Production V2 export requires an explicit production .env.local for taskmemoapp-eabc3.");
const env = { ...process.env, EXPO_PUBLIC_TASKMEMO_ENV: "production", EXPO_PUBLIC_SYNC_V2_ENABLED: "true", EXPO_PUBLIC_RELEASE_CHANNEL: "production-v2-cutover" };
execFileSync(process.execPath, ["scripts/verify-firebase-environment.js"], { stdio: "inherit", env });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["expo", "export", "--platform", "web", "--clear"], { stdio: "inherit", env });
execFileSync(process.execPath, ["scripts/verify-firebase-web-export.js"], { stdio: "inherit", env });
writeFileSync("dist/taskmemo-build-manifest.json", JSON.stringify({ schemaVersion: 1, environment: "production", firebaseProjectId: "taskmemoapp-eabc3", syncV2Enabled: true, releaseChannel: "production-v2-cutover", commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() }, null, 2), { flag: "wx" });
console.log("Production V2 web artifact exported locally only; no deploy was performed.");
