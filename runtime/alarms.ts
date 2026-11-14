import { createHash } from 'node:crypto';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineDoc, defineTask, defineExtension, type Harness } from '@earendil-works/pi-durable';

export type LocalAlarm = { reminderId:string; title:string; at:number; zone:string; owner:'local' };
export type NotificationResult = 'queued'|'denied'|'unknown';
export interface NotificationPort {
 enqueue(id:string,alarm:LocalAlarm,signal:AbortSignal):Promise<NotificationResult>;
 lookup(id:string,alarm:LocalAlarm):Promise<NotificationResult|'absent'>;
}
type Occurrence = {id:string;alarm:LocalAlarm;digest:string;revision:number;status:'proposed'|'scheduled'|'due'|'cancelled';notification:'none'|'intent-recorded'|NotificationResult;taskId:number};
type AlarmState = {occurrences:Occurrence[]};
const Alarms=defineDoc<AlarmState>({kind:'pip.local-alarms',version:1,scope:'session',initial:()=>({occurrences:[]}),checkpointWhen:()=>true});
function normalized(value:LocalAlarm):LocalAlarm {
 if(!value||Object.keys(value).sort().join(',')!=='at,owner,reminderId,title,zone'||value.owner!=='local')throw new Error('Only an explicitly local fallback may schedule here; native Reminders owns its own alarm.');
 if(typeof value.reminderId!=='string'||!value.reminderId||value.reminderId.length>100||typeof value.title!=='string'||!value.title.trim()||value.title.length>1000||typeof value.zone!=='string'||!value.zone||value.zone.length>100||!Number.isSafeInteger(value.at)||!Number.isFinite(new Date(value.at).getTime()))throw new Error('A local alarm needs a resolved absolute time and title.');
 new Intl.DateTimeFormat('en',{timeZone:value.zone});
 return {reminderId:value.reminderId,title:value.title,at:value.at,zone:value.zone,owner:'local'};
}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const alarmDigest=(value:LocalAlarm)=>hash(normalized(value));
export const occurrenceID=(value:LocalAlarm)=>{const a=normalized(value);return hash({owner:a.reminderId,at:a.at});};
/** Backend port: installed only by the explicitly isolated production host wiring.
 * Model tools can prepare its proposal, never approve or enqueue it directly.
 * Its caller must present the proposal/revision/digest for a deliberate approval.
 * Notification permission is never requested here. Queued is not a delivery claim.
 */
export function localAlarmBackend(sink:NotificationPort) {
 const Task=defineTask<{id:string},{phase:'wait'}|{phase:'reconcile'},null>({
  name:'pip.local-alarm',version:1,initial:()=>({phase:'wait'}),
  phases:{
   wait:async(task,runtime,ctx)=>{
    const current=(await runtime.snapshot(Alarms,ctx))?.occurrences.find(o=>o.id===task.input.id);
    if(!current||current.status==='cancelled'){await runtime.commit(()=>({status:'terminal',outcome:{status:'aborted'}}),ctx);return;}
    if(runtime.now()<current.alarm.at){await runtime.sleepUntil(current.alarm.at,{phase:'wait'},ctx);return;}
    // The durable checkpoint switches to read-only reconciliation before the effect.
    // A process interruption here cannot re-enter enqueue after restart.
    let admitted=false;
    await runtime.commit(async tx=>{admitted=false;const o=(await tx.doc(Alarms)).occurrences.find(o=>o.id===task.input.id)!;if(o.status!=='scheduled'||o.notification!=='none')return {status:'terminal',outcome:{status:'aborted'}};o.status='due';o.notification='intent-recorded';admitted=true;return {status:'running',checkpoint:{phase:'reconcile'}};},ctx);
    if(!admitted)return;
    let result:NotificationResult;
    try{result=await sink.enqueue(current.id,current.alarm,runtime.signal);}
    catch(error){if(runtime.signal.aborted)throw error;result='unknown';}
    await runtime.commit(async tx=>{(await tx.doc(Alarms)).occurrences.find(o=>o.id===task.input.id)!.notification=result;return {status:'terminal',outcome:{status:'completed',result:null}};},ctx);
   },
   reconcile:async(task,runtime,ctx)=>{
    const current=(await runtime.snapshot(Alarms,ctx))?.occurrences.find(o=>o.id===task.input.id);
    if(!current)throw new Error('Alarm occurrence is missing');
    let receipt:NotificationResult|'absent'='absent';try{receipt=await sink.lookup(task.input.id,current.alarm);}catch{/* absence or failed read is not permission to resend */}
    await runtime.commit(async tx=>{const o=(await tx.doc(Alarms)).occurrences.find(o=>o.id===task.input.id)!;o.status='due';o.notification=receipt==='absent'?'unknown':receipt;return {status:'terminal',outcome:{status:'completed',result:null}};},ctx);
   }
  },
  abort:async(task,runtime,ctx)=>{
   await runtime.commit(async tx=>{const o=(await tx.doc(Alarms)).occurrences.find(o=>o.id===task.input.id);if(o){if(o.notification==='none')o.status='cancelled';else{o.status='due';if(o.notification==='intent-recorded')o.notification='unknown';}}return {status:'terminal',outcome:{status:'aborted'}};},ctx);
  }
 });
 return {extension:defineExtension({name:'pip-local-alarms',tasks:[Task]}),attach(harness:Harness){
  const snapshot=async()=>structuredClone((await harness.snapshot(Alarms,context))??{occurrences:[]});
  return {
   snapshot,
   async propose(input:LocalAlarm){
    const alarm=normalized(input),id=occurrenceID(alarm),digest=alarmDigest(alarm);
    await harness.commit(async tx=>{const state=await tx.doc(Alarms);const existing=state.occurrences.find(o=>o.id===id);if(existing){if(existing.digest!==digest||existing.status==='cancelled')throw new Error('Review a fresh occurrence; the previous proposal changed or was cancelled.');return;}state.occurrences.push({id,alarm,digest,revision:1,status:'proposed',notification:'none',taskId:0});},context);
    return {id,digest,revision:1};
   },
   async approve(id:string,revision:number,reviewedDigest:string){
    const root=await harness.root(context);
    await root.commit(async tx=>{const o=(await tx.doc(Alarms)).occurrences.find(o=>o.id===id);if(!o||o.status!=='proposed'||o.revision!==revision||o.digest!==reviewedDigest||o.digest!==alarmDigest(o.alarm))throw new Error('Alarm approval is stale or already used.');o.status='scheduled';o.taskId=await tx.createTask(Task,{id},{ownership:{kind:'conversation'}});},context);
    harness.resume();
   },
   async wait(id:string){const o=(await snapshot()).occurrences.find(o=>o.id===id);if(!o?.taskId)throw new Error('No scheduled occurrence');await harness.waitForTask(o.taskId as never,context);return (await snapshot()).occurrences.find(o=>o.id===id)!;},
   async reconcile(id:string){
    const current=(await snapshot()).occurrences.find(o=>o.id===id);if(!current||!['unknown','intent-recorded'].includes(current.notification))throw new Error('Occurrence is not uncertain.');
    let receipt:NotificationResult|'absent'='absent';try{receipt=await sink.lookup(id,current.alarm);}catch{}
    await harness.commit(async tx=>{const o=(await tx.doc(Alarms)).occurrences.find(o=>o.id===id)!;o.notification=receipt==='absent'?'unknown':receipt;},context);return (await snapshot()).occurrences.find(o=>o.id===id)!;
   },
   async cancelScheduled(id:string,revision:number,reviewedDigest:string){
    const task=await harness.commit(async tx=>{const o=(await tx.doc(Alarms)).occurrences.find(o=>o.id===id);if(!o||!['proposed','scheduled'].includes(o.status)||o.notification!=='none'||o.revision!==revision||o.digest!==reviewedDigest)throw new Error('Cannot silently cancel an uncertain or already-queued notification.');o.status='cancelled';return o.taskId;},context);
    if(task){await harness.abortTask(task as never,context);await harness.waitForTask(task as never,context);}
   }
  };
 }};
}
