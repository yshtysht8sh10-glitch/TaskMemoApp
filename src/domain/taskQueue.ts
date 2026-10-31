import type { CategoryNode, MemoNode, Node } from '../models/node';
import { compareNodes, createNode, deleteCategoryOnly } from './nodeOperations';

export const isTaskQueue = (node: Node | undefined): node is CategoryNode => node?.type === 'category' && node.taskQueue === true;
export function taskQueueFor(nodes: Node[], parentId: string | null) {
  return nodes.find((n): n is CategoryNode => n.id === parentId && isTaskQueue(n) && !n.deletedAt && !n.purgedAt);
}
export function queueTasks(nodes: Node[], id: string) {
  return nodes.filter((n): n is MemoNode => n.type === 'memo' && n.memoType !== 'idea' && n.parentId === id && !n.deletedAt && !n.purgedAt).sort(compareNodes);
}
export const queueHead = (nodes: Node[], id: string) => queueTasks(nodes,id).find(n => n.status === 'active');
export function queueProgress(nodes: Node[], id: string) {
  const tasks=queueTasks(nodes,id); return { total:tasks.length, completed:tasks.filter(n=>n.status==='completed').length };
}
export function visibleQueueTaskIds(nodes: Node[]) {
  return new Set(nodes.filter(isTaskQueue).filter(n=>!n.deletedAt&&!n.purgedAt).flatMap(n=>{const head=queueHead(nodes,n.id);return head?[head.id]:[];}));
}
export function createTaskQueue(nodes: Node[], title: string, parentId: string | null = null, now = new Date(), id?: string) {
  return createNode(nodes,'category',{title,parentId,taskQueue:true},now,id);
}
export function dissolveTaskQueue(nodes: Node[], id: string, now = new Date()) {
  if (!isTaskQueue(nodes.find(n=>n.id===id))) throw new Error('キューが見つかりません。');
  return deleteCategoryOnly(nodes,id,now);
}

/** Protect generic commands (including text editing and bulk delete), not just the queue screen. */
export function assertTaskQueueTransition(before: Node[], after: Node[]) {
  for(const node of after.filter(n=>!n.deletedAt&&!n.purgedAt)) {
    const parent=after.find(n=>n.id===node.parentId);
    const previous=before.find(n=>n.id===node.id);
    const oldParent=before.find(n=>n.id===previous?.parentId);
    if(isTaskQueue(parent) && (node.type!=='memo'||node.memoType==='idea')) throw new Error('キュー直下は通常Taskだけです。');
    if(node.type==='memo' && ((isTaskQueue(parent) && oldParent?.type==='category' && oldParent.categoryKind==='routineRoot') ||
      ((isTaskQueue(oldParent)||node.queueState) && parent?.type==='category' && parent.categoryKind==='routineRoot')))
      throw new Error('キューとRoutine間の暗黙変換はできません。');
    if(isTaskQueue(node) && parent?.type==='category' && (parent.taskQueue||parent.categoryKind)) throw new Error('キューを入れ子やRoutine内には配置できません。');
  }
  for(const queue of before.filter(isTaskQueue).filter(n=>!n.deletedAt&&!n.purgedAt)) {
    const next=after.find(n=>n.id===queue.id);
    if(!next||next.deletedAt||next.purgedAt) for(const task of queueTasks(before,queue.id)) {
      const kept=after.find(n=>n.id===task.id);
      if(!kept||kept.deletedAt||kept.purgedAt||kept.parentId===queue.id) throw new Error('キューはTaskを残して解散してください。');
    }
  }
}
