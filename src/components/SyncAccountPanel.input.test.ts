import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('gives both account inputs an explicit font size large enough to avoid small-input focus zoom', () => {
  const source = readFileSync('src/components/SyncAccountPanel.tsx', 'utf8');
  const inputStyle = source.match(/\binput:\s*\{([^}]+)\}/)?.[1] ?? '';
  const size = Number(inputStyle.match(/\bfontSize:\s*(\d+)/)?.[1]);
  expect(size).toBeGreaterThanOrEqual(16);
  expect(source.match(/<FormTextInput\b[^>]*style=\{styles\.input\}/g)).toHaveLength(2);
});
