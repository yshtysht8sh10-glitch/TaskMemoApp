import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import type { Node } from '../models/node';
import { createTaskQueue, dissolveTaskQueue, isTaskQueue, queueHead, queueProgress, queueTasks } from '../domain/taskQueue';
import { completeMemo, restoreMemo, createNode, moveNode, softDeleteNode, updateNode } from '../domain/nodeOperations';
import { routineCategoryForMemo } from '../domain/routine';
import { FormTextInput } from './FormTextInput';
import { useAppTheme } from '../theme/theme';

type Change = (label: string, transform: (nodes: Node[]) => Node[]) => Promise<boolean>;
export function TaskQueues({ visible, nodes, onClose, onChange, onEdit, initialQueueId }: {
  visible: boolean; nodes: Node[]; onClose: () => void; onChange: Change; onEdit: (id: string) => void; initialQueueId?: string | null;
}) {
  const { colors }=useAppTheme();
  const [selected,setSelected]=useState<string|null>(initialQueueId??null),[name,setName]=useState(nodes.find(n=>n.id===initialQueueId)?.title??''),[title,setTitle]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [confirm,setConfirm]=useState<{label:string;run:()=>Promise<void>}|null>(null);
  if(!visible)return null;
  const queues=nodes.filter(isTaskQueue).filter(q=>!q.purgedAt&&(!q.deletedAt||queueTasks(nodes,q.id).length>0));
  const queue=queues.find(q=>q.id===selected),tasks=queue?queueTasks(nodes,queue.id):[],head=queue?queueHead(nodes,queue.id):undefined;
  const run=async(label:string,operation:(n:Node[])=>Node[],done?:()=>void)=>{
    if(busy)return;setBusy(true);setError('');
    try{if(await onChange(label,operation))done?.();else setError('保存できませんでした。状態を確認してください。');}
    catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  const button=(label:string,action:()=>void,disabled=false)=><Pressable accessibilityRole="button" accessibilityLabel={label}
    disabled={busy||disabled} onPress={action} style={{minHeight:44,padding:10,justifyContent:'center',opacity:busy||disabled?0.45:1}}><Text style={{color:colors.accent}}>{label}</Text></Pressable>;
  const input={borderWidth:1,borderColor:colors.border,color:colors.text,borderRadius:6,padding:10,minHeight:44,fontSize:16};
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <View style={{flex:1,backgroundColor:colors.background,paddingTop:44,paddingHorizontal:16,paddingBottom:24}}>
      <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><Text style={{color:colors.text,fontSize:20,fontWeight:'700'}}>キュー管理</Text>{button('閉じる',onClose)}</View>
      {!!confirm && <View accessibilityRole="alert" style={{padding:12,borderWidth:1,borderColor:colors.border}}><Text style={{color:colors.text}}>{confirm.label}</Text>{button('キャンセル',()=>setConfirm(null))}{button('確認して実行',()=>void confirm.run())}</View>}
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={{color:colors.textSecondary}}>次の未完了Taskだけを日常の一覧に表示します。</Text>
        {queues.map(q=>{const p=queueProgress(nodes,q.id);return <View key={q.id} style={{borderBottomWidth:1,borderColor:colors.border}}>
          {button(`⏭ ${q.title} · ${p.completed}/${p.total}${q.deletedAt?'（解散後のTaskあり）':''}`,()=>{setSelected(q.id);setName(q.title);setError('');})}
        </View>;})}
        {!queue && <><FormTextInput accessibilityLabel="新しいキュー名" placeholder="新しいキュー名" value={name} onChangeText={setName} style={input}/>
          <Pressable accessibilityRole="button" accessibilityLabel="キューを作成" disabled={busy||!name.trim()}
            style={{minHeight:44,padding:10}} onPress={()=>{
              const id=`queue-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
              void run('キューを作成',n=>createTaskQueue(n,name,null,new Date(),id),()=>{setSelected(id);setTitle('');});
            }}><Text style={{color:colors.accent}}>キューを作成</Text></Pressable></>}
        {!!queue && <>
          {button('キュー一覧へ',()=>{setSelected(null);setName('');})}
          <Text style={{color:colors.text,fontSize:18,fontWeight:'700'}}>{queue.title} · {queueProgress(nodes,queue.id).completed}/{tasks.length}{tasks.length>0&&!head?' 完了':''}</Text>
          <FormTextInput accessibilityLabel="キュー名" value={name} onChangeText={setName} style={input}/>
          {button('キュー名を保存',()=>void run('キュー名を変更',n=>updateNode(n,queue.id,{title:name})),!name.trim()||!!queue.deletedAt)}
          <Text style={{color:colors.textSecondary}}>全工程（完了解除すると順番に従って先頭も戻ります）</Text>
          {tasks.map((task,index)=><View key={task.id} style={{borderWidth:1,borderColor:colors.border,borderRadius:6,marginTop:8,padding:8}}>
            <Text style={{color:colors.text,fontWeight:'600'}}>{index+1}. {task.title}{task.status==='completed'?' ✓':task.id===head?.id?' ← 次に着手':''}</Text>
            <View style={{flexDirection:'row',flexWrap:'wrap'}}>
              {button(`${task.title}を編集`,()=>onEdit(task.id))}
              {button(`${task.title}を${task.status==='completed'?'未完了に戻す':'完了'}`,()=>void run('キューTaskの完了を変更',n=>task.status==='completed'?restoreMemo(n,task.id):completeMemo(n,task.id)))}
              {button(`${task.title}を上へ`,()=>void run('キューTaskを並べ替え',n=>moveNode(n,task.id,queue.id,tasks[index-1]?.id)),index===0||!!queue.deletedAt)}
              {button(`${task.title}を下へ`,()=>void run('キューTaskを並べ替え',n=>moveNode(n,task.id,queue.id,tasks[index+2]?.id)),index===tasks.length-1||!!queue.deletedAt)}
              {button(`${task.title}を取り出す`,()=>void run('キューからTaskを取り出す',n=>moveNode(n,task.id,queue.parentId)))}
              {button(`${task.title}を削除`,()=>setConfirm({label:`「${task.title}」をゴミ箱へ移します。次のTaskが先頭になります。`,run:()=>run('キューTaskを削除',n=>softDeleteNode(n,task.id,false),()=>setConfirm(null))}))}
            </View>
          </View>)}
          {!queue.deletedAt && <>
            <FormTextInput accessibilityLabel="追加するTask名" placeholder="追加するTask名" value={title} onChangeText={setTitle} style={input}/>
            {button('Taskを末尾に追加',()=>void run('キューTaskを追加',n=>createNode(n,'memo',{title,parentId:queue.id,duePreset:'none',dueAt:null}),()=>setTitle('')),!title.trim())}
            <Text style={{color:colors.textSecondary}}>既存Taskを末尾へ移動（本文・期限・完了実績は保持）</Text>
            {nodes.filter(n=>n.type==='memo'&&n.memoType!=='idea'&&!n.deletedAt&&!n.purgedAt&&n.parentId!==queue.id&&!routineCategoryForMemo(nodes,n)).map(n=>
              <View key={n.id}>{button(`「${n.title}」をキューへ`,()=>void run('既存Taskをキューへ移動',current=>moveNode(current,n.id,queue.id)))}</View>)}
          </>}
          {button('キューを解散',()=>setConfirm({label:'キューを解散します。完了済みを含むTaskはすべて通常の親／無所属へ移して残します。',run:()=>run('キューを解散',n=>dissolveTaskQueue(n,queue.id),()=>{setConfirm(null);setSelected(null);setName('');})}))}
        </>}
        {!!error && <Text accessibilityRole="alert" style={{color:colors.danger}}>{error}</Text>}
      </ScrollView>
    </View>
  </Modal>;
}
