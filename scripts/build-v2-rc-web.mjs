import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const envFile = readFileSync(".env.local", "utf8");
if (!/EXPO_PUBLIC_TASKMEMO_ENV\s*=\s*["']?development/.test(envFile) || !/EXPO_PUBLIC_FIREBASE_PROJECT_ID\s*=\s*["']?taskmemoapp-dev/.test(envFile))
  throw new Error("V2 RC export requires .env.local development/taskmemoapp-dev.");
const env = { ...process.env, EXPO_PUBLIC_TASKMEMO_ENV: "development", EXPO_PUBLIC_SYNC_V2_ENABLED: "true", EXPO_PUBLIC_RELEASE_CHANNEL: "v2-rc-20260919" };
for (const [command, args] of [["node", ["scripts/verify-firebase-environment.js"]], ["npx", ["expo", "export", "--platform", "web", "--clear"]], ["node", ["scripts/verify-firebase-web-export.js"]]]) {
  const result = spawnSync(command, args, { env, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("V2 RC web export: development/taskmemoapp-dev, explicit V2 flag, channel v2-rc-20260919.");
