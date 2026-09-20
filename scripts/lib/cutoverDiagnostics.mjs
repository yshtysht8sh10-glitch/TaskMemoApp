const CRITICAL = new Set([
  "v1-write-attempt",
  "schema-owner-failure",
  "receipt-missing",
  "duplicate-receipt",
  "revision-regression",
  "permanent-sync-error",
  "functions-partial-transaction",
]);

export function assessCutoverDiagnostics(input) {
  if (!input || typeof input !== "object" || !Array.isArray(input.events) || !Array.isArray(input.clients)) throw new Error("Invalid cutover diagnostics input.");
  const reasons = [];
  for (const event of input.events) {
    if (!event || typeof event.kind !== "string" || !Number.isInteger(event.count) || event.count < 0) throw new Error("Invalid diagnostic event.");
    if (CRITICAL.has(event.kind) && event.count > 0) reasons.push(`${event.kind}:${event.count}`);
  }
  for (const client of input.clients) {
    if (!client || typeof client.id !== "string" || typeof client.convergenceHash !== "string" || typeof client.outboxOldestAgeMs !== "number") throw new Error("Invalid client probe.");
    if (client.syncPhase === "error") reasons.push(`sync-error:${client.id}`);
    if (client.outboxOldestAgeMs > 300_000 && client.networkConfirmedOnline === true) reasons.push(`outbox-over-5m:${client.id}`);
  }
  const hashes = new Set(input.clients.map((client) => client.convergenceHash));
  if (hashes.size > 1) reasons.push("convergence-mismatch");
  return { decision: reasons.length ? "STOP" : "CONTINUE", reasons };
}
