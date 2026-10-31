import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbTaskMemoApplicationJournal } from './indexedDbApplicationStorage';
import { TaskMemoV2ApplicationStore } from './taskMemoApplicationStore';
import { InMemoryRevisionServer } from './revisionModel';
import { createTaskQueue, queueHead, dissolveTaskQueue } from '../domain/taskQueue';
import { createNode, completeMemo, moveNode } from '../domain/nodeOperations';
import { parseNodeBackup, serializeNodeBackup } from '../services/nodeBackup';
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }));
it('keeps concurrent completion and reorder, restart, offline queue progression and Undo/Redo of dissolution', async () => {
  const factory=new IDBFactory(), p=await IndexedDbTaskMemoApplicationJournal.open('queue-A',factory);
  let a=await TaskMemoV2ApplicationStore.open(p,[],{deviceId:'queue-A'});
  const b=await TaskMemoV2ApplicationStore.open(await IndexedDbTaskMemoApplicationJournal.open('queue-B',factory),[],{deviceId:'queue-B'});
  const server=new InMemoryRevisionServer();
  const flush=async(source:TaskMemoV2ApplicationStore,target:TaskMemoV2ApplicationStore)=>{
    for(const op of source.outbox){const ack=server.apply(op);await source.acknowledge(op.opId,ack.record);await target.receive(ack.record!);}
  };
  await a.command('queue','create',n=>createTaskQueue(n,'Project',null,new Date(),'q'));
  for(const id of ['a','b','c']) await a.command('task','create',n=>createNode(n,'memo',{title:id,parentId:'q'},new Date(),id));
  await flush(a,b);
  // Both clients change the same Task from the same base while offline.
  await a.command('complete','update',n=>completeMemo(n,'a'));
  await b.command('reorder','update',n=>moveNode(n,'a','q',undefined));
  const moved=b.nodes.find(n=>n.id==='a')!.sortKey;
  await flush(a,b);await flush(b,a);
  expect(a.nodes.find(n=>n.id==='a')).toMatchObject({status:'completed',sortKey:moved});
  expect(b.nodes.find(n=>n.id==='a')).toMatchObject({status:'completed',sortKey:moved});
  expect(queueHead(a.nodes,'q')?.id).toBe('b');
  const restored=parseNodeBackup(serializeNodeBackup(a.nodes));
  expect(queueHead(restored,'q')?.id).toBe('b');
  expect(restored.find(n=>n.id==='a')).toMatchObject({queueState:{completion:{status:'completed'}}});
  a=await TaskMemoV2ApplicationStore.open(p,[],{deviceId:'ignored'});
  expect(queueHead(a.nodes,'q')?.id).toBe('b');
  await a.command('dissolve','softDelete',n=>dissolveTaskQueue(n,'q'));
  expect(a.outbox.filter(op=>op.targetNodeId!=='q').every(op=>op.type==='update')).toBe(true);
  expect(a.nodes.filter(n=>n.type==='memo').every(n=>n.parentId===null&&!n.deletedAt)).toBe(true);
  await a.undo();expect(queueHead(a.nodes,'q')?.id).toBe('b');
  await a.redo();expect(a.nodes.filter(n=>n.type==='memo').every(n=>n.parentId===null&&!n.deletedAt)).toBe(true);
  await flush(a,b);expect(b.nodes.filter(n=>n.type==='memo').every(n=>n.parentId===null&&!n.deletedAt)).toBe(true);
});

it('undoes/redoes head completion offline and rejects a failed save without partial dissolution or outbox',async()=>{
  let committed:string|null=null,journal:string|null=null,fail=false;
  const persistence={loadCommitted:async()=>committed,loadJournal:async()=>journal,
    writeJournal:async(v:string)=>{if(fail)throw Error('storage full');journal=v;},writeCommitted:async(v:string)=>{committed=v;},clearJournal:async()=>{journal=null;}};
  const a=await TaskMemoV2ApplicationStore.open(persistence,[],{deviceId:'offline-queue'});
  await a.command('queue','create',n=>createTaskQueue(n,'offline',null,new Date(),'q'));
  for(const id of ['a','b'])await a.command('task','create',n=>createNode(n,'memo',{title:id,parentId:'q'},new Date(),id));
  await a.command('complete','update',n=>completeMemo(n,'a'));
  expect(queueHead(a.nodes,'q')?.id).toBe('b');
  await a.undo();expect(queueHead(a.nodes,'q')?.id).toBe('a');
  await a.redo();expect(queueHead(a.nodes,'q')?.id).toBe('b');
  const previous=JSON.stringify({nodes:a.nodes,outbox:a.outbox});const saved=committed;
  fail=true;
  await expect(a.command('dissolve','softDelete',n=>dissolveTaskQueue(n,'q'))).rejects.toThrow('storage full');
  expect(JSON.stringify({nodes:a.nodes,outbox:a.outbox})).toBe(previous);expect(committed).toBe(saved);
});


