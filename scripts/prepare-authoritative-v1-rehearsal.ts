/// <reference types="node" />
import { readFileSync, writeFileSync } from "node:fs";
import { createAuthoritativeV1RehearsalBundle } from "../src/sync/authoritativeV1Source";

const [exportPath, snapshotPath, migrationId, bundlePath, auditPath, confirmation] = process.argv.slice(2);
if (!exportPath || !snapshotPath || !migrationId || !bundlePath || !auditPath || confirmation !== "authoritative:repaired-iphone-v1:124") throw new Error("Exact authoritative-source confirmation is required.");
const result = createAuthoritativeV1RehearsalBundle(readFileSync(exportPath, "utf8"), readFileSync(snapshotPath, "utf8"), migrationId);
writeFileSync(bundlePath, JSON.stringify(result.bundle, null, 2), { flag: "wx" });
writeFileSync(auditPath, JSON.stringify(result.audit, null, 2), { flag: "wx" });
console.log(JSON.stringify({ bundlePath, auditPath, ...result.audit }, null, 2));
