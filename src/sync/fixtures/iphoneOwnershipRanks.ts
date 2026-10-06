/** Anonymized metadata from the 2026-10-06 iPhone archive + DEV Cloud.
 * Observed: distinct Memo IDs, root/a0, active, neither deleted nor purged.
 * Private content was not supplied: title/body/dates/deadline below are synthetic. */
const memo = (id: string) => ({ id, type: 'memo', title: 'fixture', body: '',
  parentId: null, sortKey: 'a0', status: 'active', memoType: 'task', duePreset: 'none',
  createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', deletedAt: null });
export const iphoneOwnershipRanks = { local: memo('iphone-local'), account: memo('iphone-account') };
