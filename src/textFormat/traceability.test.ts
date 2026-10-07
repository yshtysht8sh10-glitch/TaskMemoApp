import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import specs from '../../docs/text-workspace-specs.json';
import { matrix, registrations, traceErrors, resultErrors } from '../../scripts/text-workspace-traceability';
it('[TW-TRACE-001] every automated Spec ID has exactly one enabled direct test registration', () => expect(traceErrors(specs, registrations())).toEqual([]));
it('[TW-TRACE-002] generated matrix matches the specification registry', () => expect(readFileSync('docs/TEXT_WORKSPACE_TRACEABILITY.md', 'utf8').replace(/\r\n/g, '\n')).toBe(matrix()));
it('[TW-TRACE-003] coverage guard rejects missing duplicate disabled unknown and planned mappings', () => {
  const rows = [{ id: 'TW-DEMO-001', requirement: 'demo', file: 'src/demo.test.ts', test: '[TW-DEMO-001] demo', level: 'unit', coverage: 'new', status: 'automated' }];
  const t = { id: rows[0].id, file: rows[0].file, title: rows[0].test, disabled: false };
  expect(traceErrors(rows, [t])).toEqual([]);
  for (const tests of [[], [t, t], [{ ...t, disabled: true }], [{ ...t, id: 'TW-UNKNOWN-001' }]]) expect(traceErrors(rows, tests).length).toBeGreaterThan(0);
  expect(traceErrors([{ ...rows[0], status: 'planned' }], [t]).length).toBeGreaterThan(0);
  expect(traceErrors([{ ...rows[0], status: 'device-only', file: undefined, test: undefined }], []).length).toBeGreaterThan(0);
});
it('[TW-TRACE-004] executed-results guard refuses skipped failed and unexecuted specifications', () => {
  const row = specs.find(s => s.id === 'TW-FMT-001')!;
  for (const status of ['pending', 'failed', 'skipped']) expect(resultErrors([row], { testResults: [{ name: '/workspace/' + row.file, assertionResults: [{ fullName: row.test!, status }] }] })).toHaveLength(1);
  expect(resultErrors([row], { testResults: [] })).toHaveLength(1);
  expect(resultErrors([row], { testResults: [{ name: '/workspace/' + row.file, assertionResults: [{ fullName: row.test!, status: 'passed' }] }] })).toEqual([]);
});
