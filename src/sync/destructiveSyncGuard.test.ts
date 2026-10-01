import { expect, it } from 'vitest';
import type { Node } from '../models/node';
import { assertSafeNodeTransition } from './destructiveSyncGuard';

const nodes = (count: number) => Array.from({ length: count }, (_, index) => ({ id: String(index) })) as Node[];

it('blocks an unintentional 165 to zero transition before any outbox operation is created', () => {
  expect(() => assertSafeNodeTransition(nodes(165), [], 'update')).toThrow(/急減/);
  expect(() => assertSafeNodeTransition(nodes(165), [], 'import')).toThrow(/急減/);
});

it('allows a user initiated deletion of all Nodes and ordinary edits', () => {
  expect(() => assertSafeNodeTransition(nodes(165), [], 'softDelete')).not.toThrow();
  expect(() => assertSafeNodeTransition(nodes(165), nodes(164), 'update')).not.toThrow();
});

it('does not interpret a loading placeholder as a populated source', () => {
  expect(() => assertSafeNodeTransition([], [], 'update')).not.toThrow();
});
