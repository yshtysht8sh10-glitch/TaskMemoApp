const { execFileSync } = require('node:child_process');

function resolveBuildCommit() {
  const injected = process.env.EAS_BUILD_GIT_COMMIT_HASH || process.env.EXPO_PUBLIC_BUILD_SHA;
  if (injected) return injected.trim();
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    taskMemoBuild: {
      commit: resolveBuildCommit(),
      environment: process.env.EXPO_PUBLIC_TASKMEMO_ENV || 'development',
      syncProtocol: process.env.EXPO_PUBLIC_SYNC_V2_ENABLED === 'true' ? 'V2' : 'V1',
    },
  },
});
