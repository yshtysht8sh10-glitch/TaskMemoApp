import { spawnSync } from 'node:child_process';
if (process.env.GCLOUD_PROJECT !== 'demo-taskmemo-onboarding' || !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST)
  throw new Error('Onboarding tests require isolated Auth/Firestore/Functions demo emulators.');
const deadline = Date.now() + 60000;
while (true) {
  const response = await fetch('http://127.0.0.1:5101/demo-taskmemo-onboarding/asia-northeast1/ensureAccountV2Ready',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { schemaVersion: 1, protocol: 2 } }) }).catch(() => null);
  if (response?.status === 401) break;
  if (Date.now() >= deadline) throw new Error('Callable emulator did not become ready.');
  await new Promise(resolve => setTimeout(resolve, 1000));
}
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--testTimeout=30000', 'functions/src/onboarding/integration.test.ts'],
  { stdio: 'inherit', env: { ...process.env, TASKMEMO_ONBOARDING_E2E: '1' } });
process.exit(result.status ?? 1);
