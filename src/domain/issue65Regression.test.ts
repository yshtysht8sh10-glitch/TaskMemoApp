import { expect, it } from 'vitest';
import type { CategoryNode } from '../models/node';
import { canMoveNode, moveNode, siblingsOf } from './nodeOperations';
import { dropCandidateFor, resolveDropCandidate } from './treeDrop';

const at = new Date(2026, 9, 7, 8);
const cat = (id: string, parentId: string | null, sortKey: string): CategoryNode => ({ id, parentId, sortKey, type: 'category', title: id, createdAt: at, updatedAt: at, deletedAt: null });
const fixture = () => [cat('a', null, 'a0'), cat('b', null, 'a1'), cat('c', null, 'a2'), cat('child', 'a', 'a0'), cat('grandchild', 'child', 'a0')];
it.each(['before', 'on', 'after'] as const)('[65-POSITION] category %s placement updates parent and rank while retaining children', placement => {
  const nodes = fixture();
  const candidate = dropCandidateFor(nodes, 'a', nodes[2], placement)!;
  const moved = moveNode(nodes, 'a', candidate.parentId, candidate.beforeId, new Date(at.getTime()+1));
  expect(moved[0].parentId).toBe(placement === 'on' ? 'c' : null);
  expect(siblingsOf(moved, placement === 'on' ? 'c' : null).map(n => n.id)).toEqual(placement === 'on' ? ['a'] : placement === 'before' ? ['b', 'a', 'c'] : ['b', 'c', 'a']);
  expect(moved.slice(1)).toEqual(nodes.slice(1));
});
it('[65-ROOT] nested category returns to first root gap', () => {
  const nodes = fixture(), candidate = dropCandidateFor(nodes, 'child', nodes[0], 'before')!;
  const moved = moveNode(nodes, 'child', candidate.parentId, candidate.beforeId);
  expect(siblingsOf(moved, null).map(n => n.id)).toEqual(['child', 'a', 'b', 'c']);
  expect(moved[4]).toEqual(nodes[4]);
});
it('[65-CYCLE] rejects self descendants and pre-existing destination cycles', () => {
  const nodes = fixture();
  for (const id of ['a', 'child', 'grandchild']) expect(dropCandidateFor(nodes, 'a', nodes.find(n => n.id === id), 'on')).toBeNull();
  expect(canMoveNode([...nodes, cat('loop', 'loop', 'a0')], 'a', 'loop')).toBe(false);
});
it.each(['deletedAt', 'purgedAt'] as const)('[65-DELETED] rejects %s moving source, row anchor and destination ancestry', field => {
  const nodes = fixture();
  const badSource = nodes.map(n => n.id === 'a' ? { ...n, [field]: at } : n);
  expect(canMoveNode(badSource, 'a', null)).toBe(false);
  const badTarget = nodes.map(n => n.id === 'c' ? { ...n, [field]: at } : n);
  for (const placement of ['before', 'on', 'after'] as const) expect(dropCandidateFor(badTarget, 'a', badTarget[2], placement)).toBeNull();
  const badAncestor = nodes.map(n => n.id === 'a' ? { ...n, [field]: at } : n);
  expect(canMoveNode(badAncestor, 'b', 'grandchild')).toBe(false);
});
it('[65-RANK] rejects destination rank collisions even for append before changing metadata', () => {
  const nodes = [...fixture(), cat('duplicate', null, 'a1')];
  const before = structuredClone(nodes);
  expect(() => moveNode(nodes, 'child', null)).toThrow();
  expect(nodes).toEqual(before);
});
it('[65-TAIL] list tail below expanded children appends category at root', () => {
  const nodes = [cat('moving', null, 'a0'), cat('last', null, 'a1'), cat('nested', 'last', 'a0')];
  const hover = dropCandidateFor(nodes, 'moving', nodes[2], 'after')!;
  const candidate = resolveDropCandidate(nodes, 'moving', hover, [nodes[1], nodes[2], nodes[0]].map(node => ({ node })))!;
  expect(candidate.parentId).toBeNull();
  const moved = moveNode(nodes, 'moving', candidate.parentId, candidate.beforeId);
  expect(siblingsOf(moved, null).map(n => n.id)).toEqual(['last', 'moving']);
  expect(moved[2]).toEqual(nodes[2]);
});
