import { expect, it } from 'vitest';
import { assertCloudDominates } from '../../scripts/lib/recoverySourceSafety.mjs';

const record = (revision: number, title = 'a') => ({ revision, value: { id: 'one', title } });

it('accepts a changed legacy fingerprint when all legacy and current records are present in Cloud', () => {
  expect(() => assertCloudDominates([{ one: record(2) }, { one: record(1) }], { one: record(2) })).not.toThrow();
});

it('accepts current zero with a populated legacy and Cloud source, without selecting zero as a source', () => {
  expect(() => assertCloudDominates([{ one: record(1) }, {}], { one: record(2) })).not.toThrow();
});

it('rejects Cloud zero, a legacy-only Node, and a newer local revision', () => {
  expect(() => assertCloudDominates([{ one: record(1) }], {})).toThrow(/empty/);
  expect(() => assertCloudDominates([{ one: record(1) }], { two: record(1) })).toThrow(/lacks/);
  expect(() => assertCloudDominates([{ one: record(3) }], { one: record(2) })).toThrow(/newer/);
});

it('accepts Cloud-only Nodes and rejects unresolved equal-revision content conflicts', () => {
  expect(() => assertCloudDominates([{ one: record(1) }], { one: record(1), two: record(1) })).not.toThrow();
  expect(() => assertCloudDominates([{ one: record(1) }], { one: record(1, 'different') })).toThrow(/conflicting/);
});
