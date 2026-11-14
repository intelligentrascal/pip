import type { LocalAlarm } from './alarms.js';
import { alarmDigest } from './alarms.js';
export type Target={id:string;title:string;kind:'event'|'reminder';writable:boolean;revision:string};
export type Wall={year:number;month:number;day:number;hour:number|null;minute:number|null;zone:string};
export type Due={wall:Wall;instant:number|null;occurrence:'earlier'|'later'|null};
export type Value={kind:'event'|'reminder';title:string;start:Due|null;end:Due|null;due:Due|null;completed:boolean};
export type Change={target:Target;kind:'create'|'reminderDue'|'reminderCompletion';objectID:string|null;beforeRevision:string|null;beforeCorrelation:string|null;after:Value};
export type BackendAction={type:'schedule.mutate';change:Change}|{type:'alarm.schedule';alarm:LocalAlarm}|{type:'note.review';path:string;replacement:string}|{type:'note.review.confirm';reviewId:string;reviewDigest:string};
export type BackendReply={status:'succeeded'|'failed-known'|'unknown';receipt:string;result?:unknown};
export interface BackendReader {read(op:string,args:Record<string,unknown>):Promise<unknown>}
export interface BackendPort extends BackendReader {
 check(action:BackendAction):Promise<void>;
 execute(proposal:{id:string;status:string;action:BackendAction}):Promise<BackendReply>;
 reconcile(proposal:{id:string;status:string;action:BackendAction}):Promise<BackendReply>;
 notify(id:string,alarm:LocalAlarm):Promise<'queued'|'denied'|'unknown'>;
 lookupNotification(id:string,alarm:LocalAlarm):Promise<'queued'|'denied'|'unknown'|'absent'>;
}
export function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Expected a structured backend value');return v as Record<string,unknown>;}
function keys(v:Record<string,unknown>,allowed:string[]){if(Object.keys(v).some(k=>!allowed.includes(k)))throw Error('Unexpected backend field');}
function str(v:unknown,max=1000):string{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error('Invalid backend text');return v;}
function bool(v:unknown):boolean{if(typeof v!=='boolean')throw Error('Explicit backend flag required');return v;}
function integer(v:unknown,min:number,max:number):number{if(!Number.isSafeInteger(v)||(v as number)<min||(v as number)>max)throw Error('Invalid backend number');return v as number;}
const optionalText=(v:unknown)=>v===undefined||v===null?null:str(v);
export function target(input:unknown):Target{const v=object(input);keys(v,['id','title','kind','writable','revision']);if(!['event','reminder'].includes(String(v.kind)))throw Error('Invalid target kind');return {id:str(v.id),title:str(v.title),kind:v.kind as Target['kind'],writable:bool(v.writable),revision:str(v.revision,128)};}
export function due(input:unknown):Due|null {
 if(input===undefined||input===null)return null;
 const v=object(input);keys(v,['wall','instant','occurrence']);const w=object(v.wall);keys(w,['year','month','day','hour','minute','zone']);
 const zone=str(w.zone,100);new Intl.DateTimeFormat('en',{timeZone:zone});
 const wall={year:integer(w.year,1,9999),month:integer(w.month,1,12),day:integer(w.day,1,31),hour:w.hour==null?null:integer(w.hour,0,23),minute:w.minute==null?null:integer(w.minute,0,59),zone};
 if((wall.hour===null)!==(wall.minute===null))throw Error('Resolve both hour and minute');
 const instant=v.instant==null?null:integer(v.instant,-8640000000000000,8640000000000000);
 if((wall.hour===null)!==(instant===null))throw Error('Date-only values must not acquire an instant');
 if(v.occurrence!=null&&!['earlier','later'].includes(String(v.occurrence)))throw Error('Choose a valid occurrence');
 return {wall,instant,occurrence:(v.occurrence??null) as Due['occurrence']};
}
export function value(input:unknown):Value{
 const v=object(input);
 if(v.allDay===true)throw Error('All-day events are unsupported; no event was created.');
 if(v.floating===true)throw Error('Floating events are unsupported; choose an explicit zone.');
 if((Array.isArray(v.recurrence)&&v.recurrence.length)||(typeof v.recurrence==='string'&&v.recurrence))throw Error('Recurring events are unsupported; no series was changed.');
 keys(v,['kind','title','start','end','due','completed','allDay','floating','recurrence']);
 if(v.allDay!=null&&v.allDay!==false||v.floating!=null&&v.floating!==false||v.recurrence!=null&&(!Array.isArray(v.recurrence)||v.recurrence.length))throw Error('Invalid event shape');
 if(!['event','reminder'].includes(String(v.kind)))throw Error('Invalid schedule kind');
 if(v.kind==='event')for(const key of ['start','end']){const candidate=object(v[key]);if(!candidate.wall||typeof object(candidate.wall).zone!=='string'||candidate.instant==null)throw Error('Floating events are unsupported; choose resolved instants and a zone.');}
 const result:Value={kind:v.kind as Value['kind'],title:str(v.title),start:due(v.start),end:due(v.end),due:due(v.due),completed:bool(v.completed)};
 if(result.kind==='event'&&(result.start?.instant==null||result.end?.instant==null||result.end.instant<=result.start.instant||result.due||result.completed||result.start.wall.zone!==result.end.wall.zone))throw Error('Invalid event range');
 if(result.kind==='reminder'&&(result.start||result.end))throw Error('Reminder cannot contain event times');return result;
}
export function change(input:unknown):Change{const v=object(input);keys(v,['target','kind','objectID','beforeRevision','beforeCorrelation','after']);if(!['create','reminderDue','reminderCompletion'].includes(String(v.kind)))throw Error('Invalid mutation');const result:Change={target:target(v.target),kind:v.kind as Change['kind'],objectID:optionalText(v.objectID),beforeRevision:optionalText(v.beforeRevision),beforeCorrelation:v.beforeCorrelation==null?null:typeof v.beforeCorrelation==='string'?v.beforeCorrelation:str(v.beforeCorrelation),after:value(v.after)};if(!result.target.writable||result.target.kind!==result.after.kind)throw Error('Selected target is not writable for this change');if(result.kind==='create'&&(result.objectID||result.beforeRevision||result.beforeCorrelation||result.after.completed))throw Error('Invalid create');if(result.kind!=='create'&&(!result.objectID||!result.beforeRevision||result.beforeCorrelation===null||result.after.kind!=='reminder'))throw Error('Mutation needs the selected object snapshot');return result;}
export function isBackendAction(type:unknown):boolean{return ['schedule.mutate','alarm.schedule','note.review','note.review.confirm'].includes(String(type));}
export function backendAction(input:unknown):BackendAction{const v=object(input);switch(v.type){
 case 'schedule.mutate':keys(v,['type','change']);return {type:v.type,change:change(v.change)};
 case 'alarm.schedule':{keys(v,['type','alarm']);const a=v.alarm as LocalAlarm;alarmDigest(a);return {type:v.type,alarm:{reminderId:a.reminderId,title:a.title,at:a.at,zone:a.zone,owner:'local'}};}
 case 'note.review':keys(v,['type','path','replacement']);return {type:v.type,path:str(v.path,4096),replacement:str(v.replacement,30000)};
 case 'note.review.confirm':keys(v,['type','reviewId','reviewDigest']);return {type:v.type,reviewId:str(v.reviewId,100),reviewDigest:str(v.reviewDigest,64)};
 default:throw Error('Unsupported backend action');
}}
