import { expect, it } from 'vitest';
import { createTaskQueue, queueTasks, queueHead, dissolveTaskQueue, assertTaskQueueTransition } from './taskQueue';
import { createNode, completeMemo, restoreMemo, moveNode, softDeleteNode, ensureRoutineCategories } from './nodeOperations';
import { deadlineGroups } from './deadlineView';
import { convertMemoType } from './memoType';
import { deleteSelectedNodes } from './nodeSelection';
import { parseNodeBackup, serializeNodeBackup } from '../services/nodeBackup';
const now = new Date(2026, 9, 31, 8);
export function queueFixture() {
  let nodes = createTaskQueue([], 'Release', null, now, 'q');
  for (const id of ['spec', 'model', 'gui']) nodes = createNode(nodes, 'memo', { title: id, parentId: 'q', dueAt: new Date(2026,9,31,23,59), duePreset: 'custom' }, now, id);
  return nodes;
}
const shown = (nodes: ReturnType<typeof queueFixture>) => deadlineGroups(nodes, now).flatMap(g => g.memos).map(m => m.id);
it('shows one head per queue, advances, rewinds without erasing later completion, and resumes an all-complete queue', () => {
  let n = queueFixture(); n = createTaskQueue(n, 'Other', null, now, 'q2');
  n = createNode(n, 'memo', { title: 'other', parentId: 'q2' }, now, 'other');
  n = createNode(n, 'memo', { title: 'normal', parentId: null }, now, 'normal');
  expect(shown(n).sort()).toEqual(['normal','other','spec']);
  n = completeMemo(n, 'spec', now); expect(queueHead(n,'q')?.id).toBe('model');
  n = completeMemo(n, 'model', now); n = restoreMemo(n,'spec',now);
  expect(queueHead(n,'q')?.id).toBe('spec'); expect(n.find(x=>x.id==='model')).toMatchObject({status:'completed'});
  n = completeMemo(completeMemo(n,'spec',now),'gui',now); expect(queueHead(n,'q')).toBeUndefined();
  expect(n.some(x=>x.id==='q' && !x.deletedAt)).toBe(true);
  n = createNode(n,'memo',{title:'release',parentId:'q'},now,'release'); expect(queueHead(n,'q')?.id).toBe('release');
});
it('reorders, removes, restores and extracts the same Task without changing identity or deadline', () => {
  let n = queueFixture(); const original=n.find(x=>x.id==='spec')!;
  n = moveNode(n,'gui','q','spec',now); expect(queueHead(n,'q')?.id).toBe('gui');
  n = softDeleteNode(n,'gui',false,now); expect(queueHead(n,'q')?.id).toBe('spec');
  n = moveNode(n,'spec',null,undefined,now); expect(queueHead(n,'q')?.id).toBe('model');
  expect(n.find(x=>x.id==='spec')).toMatchObject({id:original.id,createdAt:original.createdAt,dueAt:(original as {dueAt:Date}).dueAt});
});
it('dissolves directly or through bulk/cascade delete without deleting any Task, including completed Tasks', () => {
  const n=completeMemo(queueFixture(),'spec',now);
  for(const result of [dissolveTaskQueue(n,'q',now),softDeleteNode(n,'q',true,now)]) {
    expect(queueTasks(result,'q')).toHaveLength(0);
    for(const id of ['spec','model','gui']) expect(result.find(x=>x.id===id)).toMatchObject({parentId:null,deletedAt:null});
    expect(result.find(x=>x.id==='spec')).toMatchObject({status:'completed'});
  }
});
it('rejects nested queues, Ideas and Routine transfers, preserving existing structures', () => {
  let n=ensureRoutineCategories(queueFixture()); const r=n.find(x=>x.type==='category'&&x.categoryKind==='routineRoot')!.id;
  expect(()=>createNode(n,'memo',{title:'idea',memoType:'idea',parentId:'q'},now)).toThrow();
  expect(()=>createNode(n,'category',{title:'folder',parentId:'q'},now)).toThrow();
  expect(()=>createTaskQueue(n,'nested','q',now)).toThrow();
  expect(()=>moveNode(n,'q',r,undefined,now)).toThrow();
  expect(()=>moveNode(n,'spec',r,undefined,now)).toThrow();
  expect(()=>convertMemoType(n,'spec','idea',now)).toThrow();
  n=createNode(n,'memo',{title:'routine',parentId:r},now,'daily');
  expect(()=>moveNode(n,'daily','q',undefined,now)).toThrow();
});
it('retains queue metadata and progress through backup restore and leaves legacy Tasks visible', () => {
  const n=completeMemo(queueFixture(),'spec',now);
  const restored=parseNodeBackup(serializeNodeBackup(n));
  expect(queueHead(restored,'q')?.id).toBe('model'); expect(shown(restored)).toEqual(['model']);
  expect(restored.find(x=>x.id==='q')).toMatchObject({taskQueue:true});
});
it('selects by queue sequence before deadline grouping and converges ties without read-time writes',()=>{
  const n=queueFixture().map(x=>x.type==='memo'?{...x,sortKey:'a0'}:x);
  const before=JSON.stringify(n);
  expect(queueHead(n,'q')?.id).toBe('gui');
  expect(queueHead([...n].reverse(),'q')?.id).toBe('gui');
  expect(deadlineGroups(n,now).flatMap(g=>g.memos).map(m=>m.id)).toEqual(['gui']);
  expect(JSON.stringify(n)).toBe(before);
});
it('protects generic bulk deletion, parent cascades and raw text-style reparenting',()=>{
  let n=queueFixture();
  const dissolved=deleteSelectedNodes(n,['q','spec'],now);
  expect(dissolved.filter(x=>x.type==='memo').every(x=>!x.deletedAt&&x.parentId===null)).toBe(true);
  expect(()=>assertTaskQueueTransition(n,n.map(x=>({...x,deletedAt:now})))).toThrow(/残して/);
  n=createNode(n,'category',{title:'outer',parentId:null},now,'outer');
  n=moveNode(n,'q','outer',undefined,now);
  expect(()=>softDeleteNode(n,'outer',true,now)).toThrow(/先に解散/);
  const routine=ensureRoutineCategories(n),r=routine.find(x=>x.type==='category'&&x.categoryKind==='routineRoot')!.id;
  expect(()=>assertTaskQueueTransition(routine,routine.map(x=>x.id==='spec'?{...x,parentId:r}:x))).toThrow(/暗黙変換/);
});
