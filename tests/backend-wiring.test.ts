import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { modelBackendTools, backendToolNames } from '../runtime/model-backends.js';
import { openHost, type Host } from '../runtime/pi-durable-adapter.js';
import { type BackendPort } from '../runtime/backend-contracts.js';
import { buildBackend, fixtureHome, nativePeer, wireDue, wall, scheduleChange, reminderValue } from './helpers/backend-process.js';

before(async()=>{await buildBackend();});
// Intent: captain's production-wiring request; exact approval must precede any isolated native write.
test('production host approvals dispatch through the real Swift private router and reconcile lost receipts',{timeout:30000},async()=>{
 const f=await fixtureHome(),peer=nativePeer(f.env);let host=await openHost({home:f.home,fixture:true,backend:peer.client});
 try{
  const due=await wireDue(peer.client,wall(null));const action={type:'schedule.mutate',change:scheduleChange(f.targets[1],reminderValue('Pick up tea',due))};
  const p=await host.propose(action);
  assert.equal(peer.requests.filter(m=>m.payload.op==='execute').length,0);
  await assert.rejects(host.approve(p.id,p.revision,'unreviewed'),/stale/);
  assert.equal(peer.requests.filter(m=>m.payload.op==='execute').length,0);
  const saved=await host.approve(p.id,p.revision,p.digest);assert.equal(saved.status,'succeeded');const native=JSON.parse(saved.backendResult!);
  assert.equal(native.correlation,p.id);assert.equal(native.targetID,f.targets[1].id);assert.equal(native.value.due.instant,undefined);
  await assert.rejects(host.approve(p.id,p.revision,p.digest),/already/);
  await assert.rejects(host.backendQuery('notification.enqueue',{}),/Only bounded/);
  const timed=await wireDue(peer.client,wall(9));const after={...native.value,due:timed};
  const update=await host.propose({type:'schedule.mutate',change:scheduleChange(f.targets[1],after,native,'reminderDue')});
  assert.equal((await host.approve(update.id,update.revision,update.digest)).status,'succeeded');
  await host.close();
  const lost=new Proxy(peer.client,{get(target,key){if(key==='execute')return async(p:any)=>{await target.execute(p);throw Error('Fault injection: reply lost after real isolated write');};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}}) as BackendPort;
  host=await openHost({home:f.home,fixture:true,backend:lost});
  const second=await host.propose({type:'schedule.mutate',change:scheduleChange(f.targets[1],reminderValue('Review the notes'))});
  assert.equal((await host.approve(second.id,second.revision,second.digest)).status,'unknown');
  await assert.rejects(host.propose(second.action),/Unknown/);await host.close();
  host=await openHost({home:f.home,fixture:true,backend:peer.client});
  const count=peer.requests.filter(m=>m.payload.op==='execute').length;
  const recovered=await host.reconcile(second.id);assert.equal(recovered.status,'succeeded');assert.equal(peer.requests.filter(m=>m.payload.op==='execute').length,count);
  const queried:any=await host.backendQuery('queryReminders',{target:f.targets[1],query:{start:timed.instant,end:timed.instant+3600000,zone:'Europe/Madrid',includeCompleted:false,includeDateOnly:true,limit:10}});
  assert.equal(queried.items.length,1);assert.equal(queried.items[0].id,native.id);
  console.log(JSON.stringify({scenario:'production-host-swift-router',created:native.id,reconciled:JSON.parse(recovered.backendResult!).id,executeCalls:count,queried:queried.items.length,realSystemStores:false}));
 }finally{await host.close();await peer.close();}
});
// Intent: A15/A16 production proposal paths schedule local fallback and review notes, never overwrite.
test('production approval flow wires isolated alarms and distinct note review',{timeout:30000},async()=>{
 const f=await fixtureHome(),peer=nativePeer(f.env),host=await openHost({home:f.home,fixture:true,backend:peer.client});
 try{
  const alarm={reminderId:randomUUID(),title:'Pick up tea',at:Date.now()-1000,zone:'Europe/Madrid',owner:'local'};
  const p=await host.propose({type:'alarm.schedule',alarm});assert.equal(peer.requests.some(m=>m.payload.op==='notification.enqueue'),false);
  const scheduled=await host.approve(p.id,p.revision,p.digest);assert.equal(scheduled.status,'succeeded');const plan=JSON.parse(scheduled.backendResult!);
  const due=await host.waitAlarm(plan.id);assert.equal(due.notification,'queued');
  assert.equal(peer.requests.filter(m=>m.payload.op==='notification.enqueue').length,1);
  const file=path.join(f.home,'review-note.txt'),original='Can you send the notes today?';await writeFile(file,original);
  const review=await host.propose({type:'note.review',path:file,replacement:'Could you send the notes today? Thank you.'});
  const reviewed=await host.approve(review.id,review.revision,review.digest);assert.equal(reviewed.status,'succeeded');
  const detail=JSON.parse(reviewed.backendResult!);
  const confirm=await host.propose({type:'note.review.confirm',reviewId:detail.review.id,reviewDigest:detail.digest});
  assert.equal((await host.approve(confirm.id,confirm.revision,confirm.digest)).status,'succeeded');assert.equal(await readFile(file,'utf8'),original);
  console.log(JSON.stringify({scenario:'approved-alarm-and-note-review',occurrence:plan.id,notification:due.notification,noteUnchanged:true,isolatedOnly:true}));
 }finally{await host.close();await peer.close();}
});
// Intent: model wiring uses the real SDK tool protocol but grants no model execution/approval capability.
test('SDK model tools prepare a real isolated proposal and the normal worker waits for separate approval',{timeout:30000},async()=>{
 const f=await fixtureHome(),peer=nativePeer(f.env);let host:Host;let completed!:()=>void;const done=new Promise<void>(r=>{completed=r;});
 host=await openHost({home:f.home,fixture:true,backend:peer.client,changed:()=>{if(host)void host.snapshot().then(s=>{if(s.works[0]?.status==='Done')completed();});},provider:async(_request,_memory,_signal,context)=>{
  assert.ok(context?.backend);assert.equal('execute' in context.backend,false);
  const server=createSdkMcpServer({name:'pip-isolated',version:'1.0.0',tools:modelBackendTools(context.backend)});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.instance.connect(a);const client=new Client({name:'Pip isolated protocol check',version:'1.0.0'});await client.connect(b);
  try{
   const names=(await client.listTools()).tools.map(t=>t.name).sort();assert.deepEqual(names,[...backendToolNames].sort());
   const refused:any=await client.callTool({name:'prepare_backend_action',arguments:{action:{type:'alarm.schedule',alarm:{reminderId:'tea',title:'Pick up tea',at:Date.now(),zone:'Europe/Madrid',owner:'local',nativeID:'must-not-be-silently-dropped'}}}});assert.equal(refused.isError,true);
   const call=async(name:string,args:any)=>{const result:any=await client.callTool({name,arguments:args});assert.notEqual(result.isError,true,JSON.stringify(result));return JSON.parse(result.content[0].text).result;};
   const targets=await call('targets',{kind:'reminder'});const resolved=await call('resolve_due',{wall:wall(null)});
   const prepared=await call('prepare_backend_action',{action:{type:'schedule.mutate',change:scheduleChange(targets[0],reminderValue('Pick up tea',resolved.due))}});
   assert.equal(prepared.executed,false);assert.equal(prepared.requiresApproval,true);
   return {kind:'answer',title:'Isolated protocol fixture',text:'Prepared a fixture reminder; nothing has been saved.',sources:[],model:'Fixture provider — not live Claude',sessionId:context.sessionId,proposal:prepared.action};
  }finally{await client.close();await server.instance.close();}
 }});
 try{
  await host.submit(randomUUID(),'Prepare Pick up tea in the explicitly selected fixture reminders list.');await done;
  const p=(await host.snapshot()).proposals[0];assert.equal(p.status,'proposed');assert.equal(peer.requests.some(m=>m.payload.op==='execute'),false);
  assert.equal((await host.approve(p.id,p.revision,p.digest)).status,'succeeded');
  console.log(JSON.stringify({scenario:'sdk-model-tool-protocol',proposal:p.id,approvalRequired:true,liveModelInference:false}));
 }finally{await host.close();await peer.close();}
});
// Intent: production service reader must route native replies outside its serial command queue.
test('production service private pipes complete bounded queries and approved effects without a reply deadlock',{timeout:30000},async()=>{
 const f=await fixtureHome(),peer=nativePeer(f.env),service=spawn(process.execPath,['--import','tsx','runtime/service.ts'],{env:f.env,stdio:['pipe','pipe','pipe']});
 let stderr='';service.stderr.on('data',d=>{stderr+=d;});
 const listeners=new Set<(m:any)=>void>();const transcript:any[]=[];
 const lines=createInterface({input:service.stdout});lines.on('line',line=>{const m=JSON.parse(line);if(m.kind==='backend.request'){peer.send(m);return;}transcript.push(m);for(const listener of listeners)listener(m);});
 peer.route(message=>service.stdin.write(JSON.stringify(message)+'\n'));
 const exit=new Promise<number|null>((resolve,reject)=>{service.once('error',reject);service.once('exit',resolve);});
 const command=(kind:string,payload:any,predicate:(m:any)=>boolean)=>{const id=randomUUID();return new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>{listeners.delete(check);reject(Error('Service protocol deadline'));},10000);const check=(m:any)=>{if(m.kind==='error'&&m.id===id){clearTimeout(timer);listeners.delete(check);reject(Error(m.payload.message));}else if(predicate(m)){clearTimeout(timer);listeners.delete(check);resolve(m);}};listeners.add(check);service.stdin.write(JSON.stringify({version:1,id,kind,payload})+'\n');});};
 try{
  const result=await command('backendQuery',{op:'targets',args:{kind:'reminder'}},m=>m.kind==='backendResult');assert.equal(result.payload.length,2);
  const due=await command('backendQuery',{op:'resolveDue',args:{wall:wall(null)}},m=>m.kind==='backendResult');
  const action={type:'schedule.mutate',change:scheduleChange(result.payload[0],reminderValue('Pick up tea',due.payload.due))};
  const proposed=await command('propose',{action},m=>m.kind==='state'&&m.payload.state.proposals.some((p:any)=>p.status==='proposed'));
  const p=proposed.payload.state.proposals.at(-1);assert.equal(peer.requests.some(m=>m.payload.op==='execute'),false);
  const saved=await command('approve',{id:p.id,revision:p.revision,digest:p.digest},m=>m.kind==='state'&&m.payload.state.proposals.some((x:any)=>x.id===p.id&&x.status==='succeeded'));
  const value=JSON.parse(saved.payload.state.proposals.find((x:any)=>x.id===p.id).backendResult);assert.equal(value.correlation,p.id);
  console.log(JSON.stringify({scenario:'production-service-private-pipes',proposal:p.id,nativeObject:value.id,isolatedOnly:true,replyDeadlock:false}));
 }finally{service.stdin.end();assert.equal(await exit,0,stderr);await peer.close();}
});
// Intent: isolated capability flags are not a grant to real system stores or to unsupported event shapes.
test('backend actions default closed and all-day floating recurring events are explicit refusals',{timeout:30000},async()=>{
 const f=await fixtureHome(),peer=nativePeer(f.env),host=await openHost({home:f.home,fixture:true});
 try{
  const start=await wireDue(peer.client,wall(9)),end=await wireDue(peer.client,wall(10));
  const base={kind:'event',title:'Review the notes',start,end,due:null,completed:false};
  const action={type:'schedule.mutate',change:scheduleChange(f.targets[0],base)};
  await assert.rejects(host.propose(action),/not connected/);
  await assert.rejects(openHost({home:f.home,backend:peer.client}),/isolated-only/);
  for(const [field,val,code] of [['allDay',true,'unsupportedAllDay'],['floating',true,'unsupportedFloating'],['recurrence',['weekly'],'unsupportedRecurring']] as const){
   const altered={...base,[field]:val};await assert.rejects(peer.client.read('checkChange',{change:scheduleChange(f.targets[0],altered)}),new RegExp(code));
   await assert.rejects(host.propose({type:'schedule.mutate',change:scheduleChange(f.targets[0],altered)}),/unsupported/i);
  }
  assert.equal(peer.requests.some(m=>m.payload.op==='execute'),false);
 }finally{await host.close();await peer.close();}
});
// Intent: captain's bounded reminder due-query request; date-only labels never acquire an alarm.
test('bounded due queries honor selected list half-open range completion date-only and cap',{timeout:30000},async()=>{
 const f=await fixtureHome(),peer=nativePeer(f.env),host=await openHost({home:f.home,fixture:true,backend:peer.client});
 try{
  const start=await wireDue(peer.client,wall(9)),end=await wireDue(peer.client,wall(10)),date=await wireDue(peer.client,wall(null));
  const saved:any[]=[];
  for(const [title,due] of [['At the start',start],['At the end',end],['Date only',date],['No due date',null],['Completed at start',start]] as const){
   const p=await host.propose({type:'schedule.mutate',change:scheduleChange(f.targets[1],reminderValue(title,due))});const result=await host.approve(p.id,p.revision,p.digest);assert.equal(result.status,'succeeded');saved.push(JSON.parse(result.backendResult!));
  }
  const completed={...saved[4].value,completed:true};const complete=await host.propose({type:'schedule.mutate',change:scheduleChange(f.targets[1],completed,saved[4],'reminderCompletion')});await host.approve(complete.id,complete.revision,complete.digest);
  const other=await host.propose({type:'schedule.mutate',change:scheduleChange(f.targets[2],reminderValue('Other list',start))});await host.approve(other.id,other.revision,other.digest);
  const query={start:start.instant,end:end.instant,zone:'Europe/Madrid',includeCompleted:false,includeDateOnly:true,limit:100};
  const page:any=await host.backendQuery('queryReminders',{target:f.targets[1],query});assert.deepEqual(new Set(page.items.map((x:any)=>x.id)),new Set([saved[0].id,saved[2].id]));assert.equal(page.truncated,false);
  const timed:any=await host.backendQuery('queryReminders',{target:f.targets[1],query:{...query,includeDateOnly:false}});assert.deepEqual(timed.items.map((x:any)=>x.id),[saved[0].id]);
  const all:any=await host.backendQuery('queryReminders',{target:f.targets[1],query:{...query,includeCompleted:true}});assert.equal(all.items.length,3);
  const capped:any=await host.backendQuery('queryReminders',{target:f.targets[1],query:{...query,limit:1}});assert.equal(capped.items.length,1);assert.equal(capped.truncated,true);
  assert.equal(page.items.find((x:any)=>x.id===saved[2].id).value.due.instant,undefined);
  await assert.rejects(host.backendQuery('queryReminders',{target:f.targets[1],query:{...query,end:query.start+33*86400000}}),/invalidQuery/);
  await assert.rejects(host.backendQuery('queryReminders',{target:f.targets[1],query:{...query,limit:101}}),/invalidQuery/);
  console.log(JSON.stringify({scenario:'bounded-reminder-query',matches:page.items.length,withCompleted:all.items.length,capped:capped.items.length,truncated:capped.truncated,dateOnlyStillHasNoInstant:true}));
 }finally{await host.close();await peer.close();}
});
