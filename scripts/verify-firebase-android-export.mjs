import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const outputDirectory = process.argv[2];
if (!outputDirectory) throw new Error("Usage: node scripts/verify-firebase-android-export.mjs <expo-export-directory>");
const values = new Map();
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (!match) continue;
  const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
  values.set(match[1], value);
}
const bundleDirectory = join(outputDirectory, "_expo", "static", "js", "android");
const bundleName = readdirSync(bundleDirectory).find(name => name.endsWith(".hbc"));
if (!bundleName) throw new Error("Android Hermes bundle was not found.");
const compiler = join("node_modules", "hermes-compiler", "hermesc", "win64-bin", "hermesc.exe");
const dump = execFileSync(compiler, ["-dump-bytecode", join(bundleDirectory, bundleName)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const required = [
  "EXPO_PUBLIC_FIREBASE_API_KEY", "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN", "EXPO_PUBLIC_FIREBASE_PROJECT_ID",
  "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET", "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", "EXPO_PUBLIC_FIREBASE_APP_ID",
  "EXPO_PUBLIC_TASKMEMO_ENV",
];
const included = Object.fromEntries(required.map(name => [name, Boolean(values.get(name) && dump.includes(values.get(name)))]));
if (Object.values(included).some(value => !value)) throw new Error(`Android Firebase bundle verification failed: ${JSON.stringify(included)}`);
console.log(`Android Firebase bundle verification passed for ${required.length} public configuration values (values hidden).`);
