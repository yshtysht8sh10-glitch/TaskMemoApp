import { expect, it } from 'vitest';
import { mergeQueueValue, stampQueueValue, validQueueState } from './queueRegisters';
import type { QueueTaskState } from '../models/node';
type TestValue=Record<string,unknown>&{queueState?:QueueTaskState};
const original:TestValue={id:'t',type:'memo',parentId:'q',sortKey:'a0',status:'active',completedAt:null};
it('converges position/completion independently in either delivery order and preserves metadata against stale snapshots',()=>{
  const base=stampQueueValue(undefined,original,true);
  const completed=stampQueueValue(base,{...base,status:'completed',completedAt:'2026-10-31T00:00:00.000Z'});
  const reordered=stampQueueValue(base,{...base,sortKey:'a3'});
  const ab=mergeQueueValue(completed,reordered,reordered),ba=mergeQueueValue(reordered,completed,reordered);
  expect(ab).toEqual(ba);expect(ab).toMatchObject({status:'completed',sortKey:'a3'});
  expect(mergeQueueValue(ab,original,original)).toMatchObject({status:'completed',sortKey:'a3'});
  expect(validQueueState(ab.queueState)).toBe(true);
});
it('uses deterministic ties for same-field edits and advances versions on explicit undo/redo',()=>{
  const base=stampQueueValue(undefined,original,true);
  const x=stampQueueValue(base,{...base,sortKey:'a1'}),y=stampQueueValue(base,{...base,sortKey:'a2'});
  expect(mergeQueueValue(x,y,y)).toEqual(mergeQueueValue(y,x,y));
  const undo=stampQueueValue(x,base),redo=stampQueueValue(undo,x);
  expect(undo.queueState!.position.version).toBeGreaterThan(x.queueState!.position.version);
  expect(redo.queueState!.position.version).toBeGreaterThan(undo.queueState!.position.version);
  expect(mergeQueueValue(redo,x,x).sortKey).toBe('a1');
});
it.each([null,{}, {position:{version:0},completion:{}}, {position:{version:1,parentId:'q',sortKey:'bad'},completion:{version:1,status:'completed',completedAt:'bad'}}])('rejects malformed queue register %j',value=>{
  expect(validQueueState(value)).toBe(false);
});
