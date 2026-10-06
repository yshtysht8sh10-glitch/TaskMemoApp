import { describe, expect, it, vi } from 'vitest';
import { ensureOnboarding } from './accountOnboarding';
describe('Account readiness is a fenced server operation', () => {
  it('retries a temporary response loss with a bounded count', async () => {
    const call = vi.fn().mockRejectedValueOnce({ code: 'functions/unavailable' })
      .mockResolvedValue({ schemaVersion: 1, state: 'ready', protocol: 2, result: 'existing' });
    await ensureOnboarding(call, () => true, async () => {});
    expect(call).toHaveBeenCalledTimes(2);
  });
  it('calls the fixed contract and rechecks the UID generation', async () => {
    let active = true;
    const call = vi.fn(async () => { active = false; return { schemaVersion: 1, state: 'ready', protocol: 2, result: 'created' }; });
    await expect(ensureOnboarding(call, () => active)).rejects.toThrow('切り替わ');
  });
  it('rejects invalid success responses and propagates failures', async () => {
    await expect(ensureOnboarding(async () => ({ state: 'ready' }), () => true)).rejects.toThrow();
    await expect(ensureOnboarding(async () => { throw new Error('offline'); }, () => true)).rejects.toThrow('offline');
  });
});
