const fs = require('node:fs');
const path = require('node:path');

const expectedProjects = {
  development: 'taskmemoapp-dev',
  production: 'taskmemoapp-eabc3',
};

function localValues() {
  const result = new Map(Object.entries(process.env));
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return result;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!result.has(match[1])) result.set(match[1], value);
  }
  return result;
}

try {
  const values = localValues();
  const environment = values.get('EXPO_PUBLIC_TASKMEMO_ENV');
  if (!Object.hasOwn(expectedProjects, environment)) {
    throw new Error('EXPO_PUBLIC_TASKMEMO_ENV は development または production が必須です。');
  }
  const projectId = values.get('EXPO_PUBLIC_FIREBASE_PROJECT_ID');
  if (projectId !== expectedProjects[environment]) {
    throw new Error(`${environment} buildではFirebase project ${expectedProjects[environment]}だけを使用できます。`);
  }
  console.log(`Firebase environment check: ${environment} -> ${projectId}`);
} catch (error) {
  console.error(`Firebase environment check failed: ${error.message}`);
  process.exitCode = 1;
}
