import type { QueueTaskState } from '../models/node';
import { isValidSortKey } from './sortKeys';
type Value = Record<string, unknown>;
const positive = (v: unknown) => Number.isSafeInteger(v) && (v as number)>0;
export function validQueueState(value: unknown): value is QueueTaskState {
  if (!value || typeof value!=='object') return false;
  const {position:p,completion:c}=value as QueueTaskState;
  return !!p && !!c && positive(p.version) && positive(c.version) &&
    (p.parentId===null || typeof p.parentId==='string') && typeof p.sortKey==='string' && isValidSortKey(p.sortKey) &&
    (c.status==='active' || c.status==='completed') &&
    (c.status==='active' ? c.completedAt===null : typeof c.completedAt==='string' && Number.isFinite(Date.parse(c.completedAt)));
}
const stable = (v: unknown): string => JSON.stringify(v && typeof v==='object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable((v as Value)[k]))])) : v);
function choose<T extends {version:number}>(a:T|undefined,b:T|undefined):T|undefined {
  if(!a)return b;if(!b)return a;return a.version!==b.version ? (a.version>b.version?a:b) : stable(a)>stable(b)?a:b;
}
export function mergeQueueValue<T extends Value>(a:T|undefined,b:T,winner:T):T {
  if(winner.type!=='memo'||winner.purgedAt)return winner;
  const x=a?.queueState as QueueTaskState|undefined,y=b.queueState as QueueTaskState|undefined;
  if(!x&&!y)return winner;
  if((x&&!validQueueState(x))||(y&&!validQueueState(y))) throw new Error('キューTaskの状態が不正です。原本を保持して停止します。');
  const position=choose(x?.position,y?.position)!,completion=choose(x?.completion,y?.completion)!;
  return {...winner,parentId:position.parentId,sortKey:position.sortKey,status:completion.status,completedAt:completion.completedAt,queueState:{position,completion}};
}
/** Explicit command/replay only; never called by a read or listener. */
export function stampQueueValue<T extends Value>(before:T|undefined,after:T,participating=false):T {
  if(after.type!=='memo'||after.purgedAt||(!participating&&!before?.queueState&&!after.queueState))return after;
  const old=before?.queueState as QueueTaskState|undefined,next=after.queueState as QueueTaskState|undefined;
  const p=choose(old?.position,next?.position),c=choose(old?.completion,next?.completion);
  const position={version:(p?.version??0)+(before && (before.parentId!==after.parentId||before.sortKey!==after.sortKey)?1:0)||1,parentId:after.parentId as string|null,sortKey:after.sortKey as string};
  const completion={version:(c?.version??0)+(before && (before.status!==after.status||before.completedAt!==after.completedAt)?1:0)||1,status:after.status as 'active'|'completed',completedAt:after.completedAt as string|null};
  return {...after,queueState:{position,completion}};
}
