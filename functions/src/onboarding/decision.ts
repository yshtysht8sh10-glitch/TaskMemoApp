export const GATE = Object.freeze({ schemaVersion: 1, minimumSyncProtocol: 2, v1WritesAllowed: false, v2Enabled: true });
export const GATE_FINGERPRINT = 'schema1:protocol2:v1false:v2true';
export class OnboardingBlocked extends Error {
  constructor(public readonly reason: string) { super(reason); }
}
const stop = (reason: string): never => { throw new OnboardingBlocked(reason); };
export function validateRequest(value: unknown) {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || Object.keys(v).sort().join(',') !== 'protocol,schemaVersion' || v.schemaVersion !== 1 || v.protocol !== 2)
    stop('request-invalid');
}
export type DecisionInput = { uid: string; projectId: string; authCreatedAt: number; provider: string;
  global: Record<string, unknown> | null; policy: Record<string, unknown> | null; gate: Record<string, unknown> | null;
  receipt: Record<string, unknown> | null; lifecycle: Record<string, unknown> | null; nonempty: boolean };
export function decide(v: DecisionInput): 'create' | 'existing' {
  if (v.global?.schemaVersion !== 1 || v.global.writesEnabled !== true) stop('maintenance');
  if (v.lifecycle && v.lifecycle.state !== 'onboarded') stop('recovery-active');
  if (v.gate) {
    if (!Object.entries(GATE).every(([k, value]) => v.gate![k] === value)) stop('incompatible-gate');
    if (v.lifecycle && !v.receipt) stop('receipt-inconsistent');
    if (v.receipt && (v.receipt.schemaVersion !== 1 || v.receipt.uid !== v.uid || v.receipt.projectId !== v.projectId ||
      v.receipt.databaseId !== '(default)' || v.receipt.tenantId !== null || v.receipt.authCreatedAt !== v.authCreatedAt ||
      v.receipt.protocol !== 2 || v.receipt.gateFingerprint !== GATE_FINGERPRINT ||
      typeof v.receipt.policyVersion !== 'string' || !Number.isFinite(v.receipt.provisionedAt))) stop('receipt-inconsistent');
    return 'existing';
  }
  if (v.receipt || v.lifecycle) stop('receipt-inconsistent');
  const p = v.policy;
  if (!p || p.schemaVersion !== 1 || p.protocol !== 2 || typeof p.policyVersion !== 'string' || !p.policyVersion ||
    !Number.isFinite(p.eligibleCreatedAfter) || p.writerFenceVersion !== 1) stop('policy-invalid');
  if (p!.enabled !== true) stop('onboarding-disabled');
  if (!Number.isFinite(v.authCreatedAt) || v.authCreatedAt < Number(p!.eligibleCreatedAfter)) stop('legacy-account');
  if (v.provider !== 'password') stop('provider-ineligible');
  if (v.nonempty) stop('nonempty-account');
  return 'create';
}
