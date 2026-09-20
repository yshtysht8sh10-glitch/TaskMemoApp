import { readFileSync, writeFileSync } from "node:fs";
import { assessCutoverDiagnostics } from "./lib/cutoverDiagnostics.mjs";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Usage: node scripts/analyze-cutover-diagnostics.mjs <collected-private-input.json> <new-private-report.json>");
const input = JSON.parse(readFileSync(inputPath, "utf8"));
const result = assessCutoverDiagnostics(input);
writeFileSync(outputPath, JSON.stringify({ capturedAt: input.capturedAt, ...result }, null, 2), { flag: "wx" });
console.log(JSON.stringify(result));
if (result.decision === "STOP") process.exitCode = 2;
