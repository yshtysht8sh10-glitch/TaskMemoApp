import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const script = path.join(process.cwd(), "scripts", "verify-firebase-environment.js");
const run = (environment, projectId) => () => execFileSync(process.execPath, [script], {
  cwd: process.cwd(),
  env: { ...process.env, EXPO_PUBLIC_TASKMEMO_ENV: environment, EXPO_PUBLIC_FIREBASE_PROJECT_ID: projectId },
  stdio: "pipe",
});

describe("Firebase build environment guard", () => {
  it("accepts the matching development project", () => {
    expect(run("development", "taskmemoapp-dev")).not.toThrow();
  });

  it("rejects a production project in a development build", () => {
    expect(run("development", "taskmemoapp-eabc3")).toThrow();
  });

  it("rejects a development project in a production build", () => {
    expect(run("production", "taskmemoapp-dev")).toThrow();
  });
});
