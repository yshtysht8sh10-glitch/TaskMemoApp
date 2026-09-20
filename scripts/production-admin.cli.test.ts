import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const common = ["--project", "taskmemoapp-eabc3", "--expected-project", "taskmemoapp-eabc3", "--uid", "fixture-user", "--migration-id", "fixture-migration"];
function run(firstNodes: unknown[], secondNodes: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), "taskmemo-admin-"));
  const first = join(dir, "first.json"); const second = join(dir, "second.json"); const audit = join(dir, "audit.json");
  const snapshot = (nodes: unknown[]) => JSON.stringify({ projectId: "taskmemoapp-eabc3", nodes: nodes.map(node => ({ uid: "fixture-user", node })) });
  writeFileSync(first, snapshot(firstNodes)); writeFileSync(second, snapshot(secondNodes));
  const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/production-admin.ts", "compare-snapshots", ...common, "--first", first, "--second", second, "--expected-count", String(firstNodes.length), "--audit", audit], { cwd: process.cwd(), encoding: "utf8" });
  return { result, report: JSON.parse(readFileSync(audit, "utf8")) };
}

describe("production admin CLI exit contract", () => {
  it("returns 0/PASS and a secret-free create-only audit", () => {
    const { result, report } = run([{ id: "a", title: "A" }], [{ title: "A", id: "a" }]);
    expect(result.status).toBe(0); expect(report.decision).toBe("PASS"); expect(JSON.stringify(report)).not.toMatch(/token|authorization/i);
  });
  it("returns 2/STOP for a snapshot difference", () => {
    const { result, report } = run([{ id: "a", title: "A" }], [{ id: "a", title: "B" }]);
    expect(result.status).toBe(2); expect(report.decision).toBe("STOP");
  });
  it("returns 1 and does not overwrite an existing audit", () => {
    const dir = mkdtempSync(join(tmpdir(), "taskmemo-admin-existing-")); const file = join(dir, "same.json"); const audit = join(dir, "audit.json");
    writeFileSync(file, JSON.stringify({ projectId: "taskmemoapp-eabc3", nodes: [] })); writeFileSync(audit, "keep");
    const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/production-admin.ts", "compare-snapshots", ...common, "--first", file, "--second", file, "--expected-count", "1", "--audit", audit], { cwd: process.cwd(), encoding: "utf8" });
    expect(result.status).toBe(1); expect(readFileSync(audit, "utf8")).toBe("keep");
  });
});
