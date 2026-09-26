import { readFileSync, writeFileSync } from 'node:fs';

const commit = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(commit ?? '')) throw new Error('A full git commit SHA is required.');
const version = JSON.parse(readFileSync('app.json', 'utf8')).expo.version;
for (const path of ['dist/storage-diagnostics.html', 'dist/v2-recovery-backup.html']) {
  let html = readFileSync(path, 'utf8');
  for (const [token, value] of [
    ['__TASKMEMO_DIAGNOSTIC_VERSION__', version],
    ['__TASKMEMO_DIAGNOSTIC_COMMIT__', commit],
  ]) {
    if (html.includes(token)) html = html.replaceAll(token, value);
    else if (token === '__TASKMEMO_DIAGNOSTIC_COMMIT__') throw new Error(`Missing diagnostic build placeholder: ${token} in ${path}`);
  }
  writeFileSync(path, html);
}
