import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it.each([
  { GCLOUD_PROJECT: '', FIRESTORE_EMULATOR_HOST: '' },
  { GCLOUD_PROJECT: 'taskmemoapp-eabc3', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180' },
  { GCLOUD_PROJECT: 'demo-taskmemo-v2', FIRESTORE_EMULATOR_HOST: 'example.invalid:8180' },
])('the data-protection Emulator runner refuses unsafe targets before launching tests: %j', environment => {
  const result = spawnSync(process.execPath, ['scripts/run-final-rc-emulator-tests.mjs'], {
    encoding: 'utf8', env: { ...process.env, ...environment }, timeout: 5000,
  });
  expect(result.error).toBeUndefined(); expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('isolated demo-taskmemo-v2 loopback emulator');
  expect(result.stdout).not.toContain('RUN  v');
});
