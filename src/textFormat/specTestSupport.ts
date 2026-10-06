import { it } from 'vitest';
import specs from '../../docs/text-workspace-specs.json';

/** One explicit registration per atomic specification, with its stable ID in test results. */
export function spec(id: string, run: () => unknown | Promise<unknown>) {
  const entry = specs.find(row => row.id === id);
  if (!entry || entry.status === 'device-only') throw new Error(`Unknown automated Spec ID: ${id}`);
  it(entry.test!, async () => { await run(); });
}
