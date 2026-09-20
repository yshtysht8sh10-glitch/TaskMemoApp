import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
type ConfigResult = {
  extra: {
    taskMemoBuild: {
      commit: string;
      environment: string;
      syncProtocol: string;
    };
  };
};
const configureApp = require("../../app.config.js") as (input: {
  config: Record<string, unknown>;
}) => ConfigResult;

const originalBuildSha = process.env.EXPO_PUBLIC_BUILD_SHA;
const originalEasCommit = process.env.EAS_BUILD_GIT_COMMIT_HASH;
const originalEnvironment = process.env.EXPO_PUBLIC_TASKMEMO_ENV;
const originalSyncV2 = process.env.EXPO_PUBLIC_SYNC_V2_ENABLED;

afterEach(() => {
  setOrDelete("EXPO_PUBLIC_BUILD_SHA", originalBuildSha);
  setOrDelete("EAS_BUILD_GIT_COMMIT_HASH", originalEasCommit);
  setOrDelete("EXPO_PUBLIC_TASKMEMO_ENV", originalEnvironment);
  setOrDelete("EXPO_PUBLIC_SYNC_V2_ENABLED", originalSyncV2);
});

describe("Expo build metadata", () => {
  it("PWA buildで注入したcommitと実行環境をbundle設定へ保持する", () => {
    process.env.EXPO_PUBLIC_BUILD_SHA = "0123456789abcdef";
    delete process.env.EAS_BUILD_GIT_COMMIT_HASH;
    process.env.EXPO_PUBLIC_TASKMEMO_ENV = "production";
    process.env.EXPO_PUBLIC_SYNC_V2_ENABLED = "true";

    expect(configureApp({ config: { version: "1.0.0" } }).extra.taskMemoBuild).toEqual({
      commit: "0123456789abcdef",
      environment: "production",
      syncProtocol: "V2",
    });
  });

  it("Android EAS Buildのsource commitをbundle設定へ保持する", () => {
    process.env.EXPO_PUBLIC_BUILD_SHA = "stale-explicit-value";
    process.env.EAS_BUILD_GIT_COMMIT_HASH = "abcdef0123456789";
    process.env.EXPO_PUBLIC_TASKMEMO_ENV = "development";
    process.env.EXPO_PUBLIC_SYNC_V2_ENABLED = "true";

    expect(configureApp({ config: { version: "1.0.0" } }).extra.taskMemoBuild.commit).toBe("abcdef0123456789");
  });
});

function setOrDelete(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
