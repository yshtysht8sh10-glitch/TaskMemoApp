const fs = require('node:fs');
const path = require('node:path');

const requiredNames = [
  'EXPO_PUBLIC_TASKMEMO_ENV',
  'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'EXPO_PUBLIC_FIREBASE_APP_ID',
];

function readEnvLocal() {
  const envPath = path.join(process.cwd(), process.env.TASKMEMO_ENV_FILE || '.env.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('.env.local がありません。Firebase の公開設定を追加してください。');
  }

  const values = new Map();
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(EXPO_PUBLIC_(?:FIREBASE_[A-Z0-9_]+|TASKMEMO_ENV))\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values.set(match[1], value);
  }
  return values;
}

function bundleContainsAllValues(directory, values, found = new Set()) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) bundleContainsAllValues(entryPath, values, found);
    else if (entry.name.endsWith('.js')) {
      const contents = fs.readFileSync(entryPath, 'utf8');
      for (const [name, value] of values) {
        if (contents.includes(value)) found.add(name);
      }
    }
  }
  return found;
}

try {
  const values = readEnvLocal();
  const missing = requiredNames.filter((name) => !values.get(name));
  if (missing.length) throw new Error(`未設定の環境変数: ${missing.join(', ')}`);

  const distPath = path.join(process.cwd(), 'dist');
  if (!fs.existsSync(distPath)) throw new Error('dist が生成されていません。');
  const found = bundleContainsAllValues(
    distPath,
    requiredNames.map((name) => [name, values.get(name)]),
  );
  const absent = requiredNames.filter((name) => !found.has(name));
  if (absent.length) {
    throw new Error(`bundle に反映されていない環境変数: ${absent.join(', ')}`);
  }

  console.log('Firebase web export check: 環境名と6個の公開設定が bundle に反映されています（値は非表示）。');
} catch (error) {
  console.error(`Firebase web export check failed: ${error.message}`);
  process.exitCode = 1;
}
