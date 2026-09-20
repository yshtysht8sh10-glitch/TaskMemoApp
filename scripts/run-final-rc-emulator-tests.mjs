import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const commands = [
  { cwd: root, entry: resolve(root, "node_modules/vitest/vitest.mjs"), args: ["run", "src/sync/firebaseEmulatorV2.e2e.test.ts"] },
  { cwd: resolve(root, "functions"), entry: resolve(root, "functions/node_modules/vitest/vitest.mjs"), args: ["run", "src/oauthService.test.ts", "src/mcpServer.test.ts", "src/firestoreNodeRepository.test.ts"] },
];
for (const item of commands) {
  const result = spawnSync(process.execPath, [item.entry, ...item.args], { cwd: item.cwd, stdio: "inherit", env: { ...process.env, TASKMEMO_EMULATOR_E2E: "1", TASKMEMO_FUNCTIONS_EMULATOR_E2E: "1" } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
