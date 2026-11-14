import { readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { alarmDigest, type LocalAlarm, type NotificationPort, type NotificationResult } from '../../runtime/alarms.js';

type State={permission:'granted'|'denied';enqueueCalls:number;requests:{id:string;alarm:LocalAlarm}[]};
/** Actual persisted fixture reads, not canned notification-center responses. */
export class IsolatedNotifications implements NotificationPort {
 private line:Promise<unknown>=Promise.resolve();
 private constructor(private file:string){}
 static async open(home:string,permission:'granted'|'denied'='granted'){
  const root=await realpath(home),production=path.join(os.homedir(),'Library/Application Support/Pip');
  if(root===production||root.startsWith(production+'/')||(await readFile(path.join(root,'.pip-test-home'),'utf8')).trim()!=='pip-test-only')throw new Error('Isolated notification marker required');
  const file=path.join(root,'notifications-fixture.json');
  try{await writeFile(file,JSON.stringify({permission,enqueueCalls:0,requests:[]}),{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  return new IsolatedNotifications(file);
 }
 private serial<T>(run:()=>Promise<T>):Promise<T>{const next=this.line.then(run);this.line=next.then(()=>{},()=>{});return next;}
 private async read():Promise<State>{return JSON.parse(await readFile(this.file,'utf8'));}
 snapshot(){return this.serial(()=>this.read());}
 enqueue(id:string,alarm:LocalAlarm,signal:AbortSignal):Promise<NotificationResult>{return this.serial(async()=>{
  signal.throwIfAborted();const state=await this.read();state.enqueueCalls++;
  if(state.permission==='denied'){await writeFile(this.file,JSON.stringify(state));return 'denied';}
  if(!state.requests.some(r=>r.id===id))state.requests.push({id,alarm});
  await writeFile(this.file,JSON.stringify(state));return 'queued';
 });}
 lookup(id:string,alarm:LocalAlarm):Promise<NotificationResult|'absent'>{return this.serial(async()=>{const state=await this.read();const matching=state.requests.filter(r=>r.id===id);return matching.length===0?'absent':matching.length===1&&alarmDigest(matching[0].alarm)===alarmDigest(alarm)?'queued':'unknown';});}
}
