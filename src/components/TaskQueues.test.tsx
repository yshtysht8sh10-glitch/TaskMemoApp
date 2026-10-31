// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TaskQueues } from './TaskQueues';
import { queueHead } from '../domain/taskQueue';
import type { Node } from '../models/node';
vi.mock('react-native',()=>({
  Modal:({children,visible}:{children:React.ReactNode;visible:boolean})=>visible?<div>{children}</div>:null,
  View:({children}:{children:React.ReactNode})=><div>{children}</div>,
  ScrollView:({children}:{children:React.ReactNode})=><div>{children}</div>,
  Text:({children}:{children:React.ReactNode})=><span>{children}</span>,
  Pressable:({children,onPress,disabled,accessibilityLabel}:{children:React.ReactNode;onPress:()=>void;disabled:boolean;accessibilityLabel:string})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>,
}));
vi.mock('./FormTextInput',()=>({FormTextInput:({value,onChangeText,accessibilityLabel}:{value:string;onChangeText:(v:string)=>void;accessibilityLabel:string})=><input aria-label={accessibilityLabel} value={value} onChange={e=>onChangeText(e.target.value)}/> }));
vi.mock('../theme/theme',()=>({useAppTheme:()=>({colors:{}})}));
it('creates a queue, adds three Tasks, advances, edits, reorders and dissolves only after confirmation',async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  let nodes:Node[]=[];
  const host=document.createElement('div'),root=createRoot(host),edit=vi.fn();
  const render=()=>root.render(<TaskQueues visible nodes={nodes} onClose={()=>{}} onEdit={edit} onChange={async(_label,operation)=>{nodes=operation(nodes);render();return true;}}/>);
  const click=async(label:string)=>act(async()=>{const b=host.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;expect(b).not.toBeNull();b.click();});
  const fill=async(label:string,value:string)=>act(async()=>{
    const input=host.querySelector(`[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  try{
    await act(async()=>render());await fill('新しいキュー名','Project');await click('キューを作成');
    for(const name of ['spec','model','gui']){await fill('追加するTask名',name);await click('Taskを末尾に追加');}
    const id=nodes.find(n=>n.type==='category')!.id;
    expect(host.textContent).toContain('0/3');expect(queueHead(nodes,id)?.title).toBe('spec');
    await click('specを完了');expect(queueHead(nodes,id)?.title).toBe('model');
    await click('guiを上へ');expect(queueHead(nodes,id)?.title).toBe('gui');
    await click('guiを編集');expect(edit).toHaveBeenCalledWith(queueHead(nodes,id)!.id);
    await click('キューを解散');expect(nodes.find(n=>n.id===id)?.deletedAt).toBeNull();
    await click('キャンセル');expect(nodes.find(n=>n.id===id)?.deletedAt).toBeNull();
    await click('キューを解散');await click('確認して実行');
    expect(nodes.filter(n=>n.type==='memo')).toHaveLength(3);
    expect(nodes.filter(n=>n.type==='memo').every(n=>!n.deletedAt&&n.parentId===null)).toBe(true);
  }finally{await act(async()=>root.unmount());}
});
