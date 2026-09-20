/// <reference types="node" />
import { readFileSync, writeFileSync } from "node:fs";
import { createApprovedIpaMorningRepair } from "../src/sync/v1ExportSourceRepair";

const [inputPath, outputPath, auditPath, confirmation] = process.argv.slice(2);
if (!inputPath || !outputPath || !auditPath || confirmation !== "drop-approved:ipa-morning") throw new Error("Usage: tsx scripts/repair-approved-v1-export-source.ts <original> <new-repaired> <new-audit> drop-approved:ipa-morning");
const raw = readFileSync(inputPath, "utf8");
const result = createApprovedIpaMorningRepair(raw);
writeFileSync(outputPath, result.repairedRaw, { flag: "wx" });
writeFileSync(auditPath, JSON.stringify(result.audit, null, 2), { flag: "wx" });
console.log(JSON.stringify({ outputPath, auditPath, ...result.audit }, null, 2));
