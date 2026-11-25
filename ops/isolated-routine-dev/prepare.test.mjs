import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validatePlan, candidateFiles } from './prepare.mjs';
const plan = JSON.parse(readFileSync(new URL('./plan.json', import.meta.url), 'utf8'));
const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
it('prepares only the dedicated proposal and deny-by-default UID configuration', () => {
  const files = candidateFiles(plan, rules), config = JSON.parse(files['firebase.isolated.json']);
  expect(config.hosting.site).toBe(plan.projectId);
  expect(config).not.toHaveProperty('functions');
  expect(files['firestore.isolated.rules']).toContain('request.auth.uid in []');
  expect(files['firestore.isolated.rules']).toContain('protocolWritable(userId, 2)');
  expect(files['firestore.isolated.rules']).toContain('allow update, delete: if false');
  expect(JSON.parse(files['bootstrap-spec.json']).accounts).toEqual([]);
});
it.each(['taskmemoapp-dev', 'taskmemoapp-eabc3', 'demo-unsafe', 'BadProject'])('rejects unsafe project %s', projectId => {
  expect(() => validatePlan({ ...plan, projectId, hostingSite: projectId })).toThrow();
});
it.each([{ deployFunctions: true }, { linkBillingAccount: true }, { billingPlan: 'Blaze' }, { hostingSite: 'taskmemoapp-dev' }, { ownerApproved: true }, { productBaseSha: 'unknown' }, { requiredAncestors: [] }])('rejects scope expansion %j', patch => {
  expect(() => validatePlan({ ...plan, ...patch })).toThrow();
});
it('renders an exact allowlist only and leaves protocol2/receipt protections intact', () => {
  const files = candidateFiles({ ...plan, testerUids: ['synthetic-owner'] }, rules);
  expect(files['firestore.isolated.rules']).toContain('request.auth.uid in ["synthetic-owner"]');
  expect(files['firestore.isolated.rules']).toContain("sign_in_provider == 'password'");
  expect(JSON.parse(files['bootstrap-spec.json']).accounts[0].value.minimumSyncProtocol).toBe(2);
});
it.each([[['bad/uid']], [['duplicate', 'duplicate']], [['one', 'two', 'three']]])('rejects invalid UID list %j', testerUids => {
  expect(() => validatePlan({ ...plan, testerUids })).toThrow();
});
it('fails closed on an unexpected source Rules layout', () => {
  expect(() => candidateFiles(plan, 'unknown rules')).toThrow();
});
