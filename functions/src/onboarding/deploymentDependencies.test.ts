import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('deployed Functions runtime dependencies', () => {
  it('ships fractional-indexing imported by the shared Domain loaded from the Functions entrypoint', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(manifest.dependencies['fractional-indexing']).toBeTruthy();
  });
});
