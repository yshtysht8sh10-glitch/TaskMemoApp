import { describe, expect, it } from 'vitest';
import { accountScope, localScope, ScopeGeneration, ApplicationReadiness } from './ownership';

describe('Phase A ownership', () => {
  it('separates owners, environments and operation device identity', () => {
    expect(localScope('development', 'installation', 'profile')).not.toBe(accountScope('development', 'project', 'A'));
    expect(accountScope('production', 'project', 'A')).not.toBe(accountScope('development', 'project', 'A'));
    expect(accountScope('production', 'project', 'A')).not.toBe(accountScope('production', 'project', 'B'));
    expect(() => localScope('development', '', 'profile')).toThrow();
  });
  it('rejects stale operations after A → anonymous → B', () => {
    const generation = new ScopeGeneration();
    const a = generation.enter('A'); generation.enter('anonymous'); generation.enter('B');
    expect(() => generation.assert(a)).toThrow();
    expect(() => generation.assert(generation.current)).not.toThrow();
  });
  it('Application readiness does not require authentication or connection', () => {
    expect(new ApplicationReadiness('ready').canEdit).toBe(true);
    expect(new ApplicationReadiness('opening').canEdit).toBe(false);
    expect(new ApplicationReadiness('recovery-required').canEdit).toBe(false);
  });
});
