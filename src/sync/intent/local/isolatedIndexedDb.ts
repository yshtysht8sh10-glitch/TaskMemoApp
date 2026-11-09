import type { AtomicStorage, RawPair } from './types';

const DATABASE = 'taskmemo-intent-phase2a-isolated-test';
const STORE = 'synthetic-scopes';
type Row = RawPair & { scope: string };

/** No global factory, legacy storage, migration, or production DB name is ever selected. */
export async function openIsolatedStorage(factory: IDBFactory, scope: string): Promise<AtomicStorage> {
  if (!scope.startsWith('synthetic:') || !factory) throw Error('isolated-synthetic-store-only');
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'scope' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('isolated-database-blocked'));
  });
  const run = <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, row: Row | undefined) => T, signal?: AbortSignal): Promise<T> =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(Error('aborted-before-transaction')); return; }
      const tx = db.transaction(STORE, mode), store = tx.objectStore(STORE);
      let value: T, failure: unknown;
      const abort = () => { try { tx.abort(); } catch { /* Already complete; durable success wins. */ } };
      signal?.addEventListener('abort', abort, { once: true });
      const finish = () => signal?.removeEventListener('abort', abort);
      tx.oncomplete = () => { finish(); resolve(value); };
      tx.onabort = () => { finish(); reject(failure ?? tx.error ?? Error('atomic-transaction-aborted')); };
      tx.onerror = () => { /* onabort is the terminal failure; never report success on request completion. */ };
      const get = store.get(scope) as IDBRequest<Row | undefined>;
      get.onsuccess = () => {
        try {
          if (signal?.aborted) throw Error('aborted-before-write');
          const row = get.result;
          if (row && (row.scope !== scope || (row.committed !== null && typeof row.committed !== 'string') ||
            (row.journal !== null && typeof row.journal !== 'string') ||
            Object.keys(row).sort().join(',') !== 'committed,journal,scope')) throw Error('unknown-isolated-row');
          value = action(store, get.result);
        } catch (error) { failure = error; abort(); }
      };
    });
  return {
    scope,
    read: () => run('readonly', (_store, row) => ({ committed: row?.committed ?? null, journal: row?.journal ?? null })),
    writeAtomic: (expected, value, signal) => run('readwrite', (store, row) => {
      if ((row?.committed ?? null) !== expected || (row?.journal ?? null) !== null) throw Error('raw-CAS-or-Journal-mismatch');
      store.put({ ...row, scope, committed: value, journal: null });
    }, signal),
  };
}
