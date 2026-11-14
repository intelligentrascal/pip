import { randomUUID } from 'node:crypto';
import { backendAction, isBackendAction, object, type BackendAction, type BackendPort, type BackendReply } from './backend-contracts.js';
import type { LocalAlarm } from './alarms.js';
const reads=new Set(['targets','resolveDue','read','listEvents','queryReminders','checkChange']);
export class IsolatedBackendClient implements BackendPort {
 private pending=new Map<string,{resolve:(v:unknown)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 constructor(private send:(message:unknown)=>void){}
 private request(op:string,args:Record<string,unknown>):Promise<unknown>{
  const id=randomUUID();return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Isolated backend reply timed out; an uncertain effect must not be retried.'));},10000);
   this.pending.set(id,{resolve,reject,timer});try{this.send({version:1,id,kind:'backend.request',payload:{op,args}});}catch{clearTimeout(timer);this.pending.delete(id);reject(Error('Isolated backend transport unavailable'));}
  });
 }
 receive(message:Record<string,unknown>):boolean {
  if(message.version!==1||message.kind!=='backend.response'||typeof message.id!=='string')return false;
  const pending=this.pending.get(message.id);if(!pending)return false;
  this.pending.delete(message.id);clearTimeout(pending.timer);
  try{const payload=object(message.payload);if(payload.ok!==true)throw Error(typeof payload.message==='string'?payload.message:'Isolated backend refused');pending.resolve(payload.result);}catch(error){pending.reject(error as Error);}return true;
 }
 read(op:string,args:Record<string,unknown>){if(!reads.has(op))return Promise.reject(Error('Only bounded read/prepare operations are model-accessible'));return this.request(op,args);}
 async check(input:BackendAction){const action=backendAction(input);if(action.type==='schedule.mutate')await this.read('checkChange',{change:action.change});}
 private async effect(op:string,proposal:{id:string;status:string;action:BackendAction}):Promise<BackendReply>{
  if(!isBackendAction(proposal.action.type))throw Error('Unsupported backend effect');
  const reply=object(await this.request(op,{proposal}));
  if(!['succeeded','failed-known','unknown'].includes(String(reply.status))||typeof reply.receipt!=='string'||reply.receipt.length>1000)throw Error('Invalid native receipt');
  return {status:reply.status as BackendReply['status'],receipt:reply.receipt,...(reply.result===undefined?{}:{result:reply.result})};
 }
 execute(proposal:{id:string;status:string;action:BackendAction}){if(proposal.status!=='intent-recorded')return Promise.reject(Error('An exact approval must be durably recorded before dispatch'));return this.effect('execute',proposal);}
 reconcile(proposal:{id:string;status:string;action:BackendAction}){if(proposal.status!=='unknown')return Promise.reject(Error('Only Unknown outcomes can reconcile'));return this.effect('reconcile',proposal);}
 async notify(id:string,alarm:LocalAlarm){const value=object(await this.request('notification.enqueue',{id,alarm}));if(!['queued','denied','unknown'].includes(String(value.status)))throw Error('Invalid notification receipt');return value.status as 'queued'|'denied'|'unknown';}
 async lookupNotification(id:string,alarm:LocalAlarm){const value=object(await this.request('notification.lookup',{id,alarm}));if(!['queued','denied','unknown','absent'].includes(String(value.status)))throw Error('Invalid notification lookup');return value.status as 'queued'|'denied'|'unknown'|'absent';}
 close(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Isolated backend closed; uncertain outcomes stay held'));}this.pending.clear();}
}
