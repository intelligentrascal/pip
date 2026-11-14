import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { Harness, createRegistry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { openNodeSqliteDatabase } from '@earendil-works/pi-durable/storage/sqlite/node';
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite';
import { localAlarmBackend, type LocalAlarm, type NotificationPort } from '../runtime/alarms.js';
import { IsolatedNotifications } from './helpers/notification-store.js';

const at=Date.parse('2026-11-06T08:00:00Z'); // V1-SPEC: Pick up tea, 9 AM Europe/Madrid.
const spec=():LocalAlarm=>({reminderId:'pick-up-tea',title:'Pick up tea',at,zone:'Europe/Madrid',owner:'local'});
async function fixture(){const base=process.env.PIP_TEST_ROOT??path.join(os.tmpdir(),'pip-alarm-fixtures');await mkdir(base,{recursive:true});const home=await mkdtemp(path.join(base,'pip-alarm-'));await writeFile(path.join(home,'.pip-test-home'),'pip-test-only');return home;}
async function open(home:string,sink:NotificationPort,clock:{now:number},sleeping:()=>void=()=>{}){
 const registry=createRegistry(),backend=localAlarmBackend(sink);registry.install(backend.extension);
 const db=await openNodeSqliteDatabase(path.join(home,'alarms.sqlite'));const storage=await SqliteStorage.open(db);await db.exec('PRAGMA synchronous=FULL');
 const harness=await Harness.open(storage,{models:createModels(),registry,now:()=>clock.now,onWake:wake=>{if(wake.at===at)sleeping();}},context);
 await harness.root(context);return {harness,service:backend.attach(harness),close:()=>harness.close(context)};
}
// Intent: V1-SPEC A15 durable sleeps survive reopen; wake shows one overdue occurrence, never a burst.
test('A15 approved local alarm sleeps durably and queues one stable occurrence after reopen',async()=>{
 const home=await fixture(),sink=await IsolatedNotifications.open(home),clock={now:at-3600000};
 let sleeping!:()=>void;const asleep=new Promise<void>(resolve=>{sleeping=resolve;});
 let host=await open(home,sink,clock,sleeping);
 const p=await host.service.propose(spec());
 try{
  await assert.rejects(host.service.approve(p.id,p.revision,'stale-review'),/stale/);
  assert.equal((await sink.snapshot()).enqueueCalls,0);
  await host.service.approve(p.id,p.revision,p.digest);await asleep;
  assert.equal((await host.service.snapshot()).occurrences[0].status,'scheduled');
  await host.close();clock.now=at+3*86400000;
  host=await open(home,sink,clock);host.harness.resume();const due=await host.service.wait(p.id);
  assert.equal(due.status,'due');assert.equal(due.notification,'queued');assert.equal(due.alarm.at,at);
  assert.equal(due.alarm.zone,spec().zone);
  await assert.rejects(host.service.approve(p.id,p.revision,p.digest),/already/);
  const state=await sink.snapshot();assert.equal(state.enqueueCalls,1);assert.equal(state.requests.length,1);assert.equal(state.requests[0].id,p.id);
  console.log(JSON.stringify({scenario:'overdue-after-reopen',occurrence:p.id,notification:due.notification,approvedInstant:new Date(due.alarm.at).toISOString(),nativeRequests:state.requests.length}));
 }finally{await host.close();}
});
// Intent: A15 denied notifications stay due; native-owned alarms must not get local duplicates.
test('A15 denial retains the due item and native ownership refuses local scheduling',async()=>{
 const home=await fixture(),sink=await IsolatedNotifications.open(home,'denied'),clock={now:at};
 const host=await open(home,sink,clock);
 try{
  await assert.rejects(host.service.propose({...spec(),owner:'native'} as unknown as LocalAlarm),/native Reminders/i);
  await assert.rejects(host.service.propose({...spec(),at:undefined} as unknown as LocalAlarm),/absolute/);
  const p=await host.service.propose(spec());await host.service.approve(p.id,p.revision,p.digest);
  const due=await host.service.wait(p.id);assert.equal(due.status,'due');assert.equal(due.notification,'denied');assert.equal((await sink.snapshot()).requests.length,0);
  console.log(JSON.stringify({scenario:'notification-denied',due:due.status,notification:due.notification,requests:0}));
 }finally{await host.close();}
});
// Intent: A14/A15 a lost notification receipt reconciles stable native identity without resending.
test('A14/A15 a lost queue receipt is held and reconciled without another enqueue',async()=>{
 const home=await fixture(),sink=await IsolatedNotifications.open(home),clock={now:at};
 const lost:NotificationPort={lookup:(id,alarm)=>sink.lookup(id,alarm),enqueue:async(...args)=>{await sink.enqueue(...args);throw new Error('Fault injection: receipt lost after actual fixture persistence');}};
 let host=await open(home,lost,clock);
 try{
  const p=await host.service.propose(spec());await host.service.approve(p.id,p.revision,p.digest);
  assert.equal((await host.service.wait(p.id)).notification,'unknown');await host.close();
  host=await open(home,sink,clock);const recovered=await host.service.reconcile(p.id);
  assert.equal(recovered.notification,'queued');assert.equal((await sink.snapshot()).enqueueCalls,1);
  console.log(JSON.stringify({scenario:'lost-notification-receipt',reconciled:recovered.notification,enqueueCalls:(await sink.snapshot()).enqueueCalls}));
 }finally{await host.close();}
});
// Intent: A15 cancellation is a separate reviewed mutation, never silent removal of queued effects.
test('A15 a reviewed pre-due cancellation prevents notification delivery',async()=>{
 const home=await fixture(),sink=await IsolatedNotifications.open(home),clock={now:at-3600000};
 let sleeping!:()=>void;const asleep=new Promise<void>(resolve=>{sleeping=resolve;});const host=await open(home,sink,clock,sleeping);
 try{
  const p=await host.service.propose(spec());await host.service.approve(p.id,p.revision,p.digest);await asleep;
  await host.service.cancelScheduled(p.id,p.revision,p.digest);clock.now=at+1;host.harness.resume();
  const item=await host.service.wait(p.id);assert.equal(item.status,'cancelled');assert.equal((await sink.snapshot()).enqueueCalls,0);
 }finally{await host.close();}
});
// Intent: A14 interruption after durable intent must resume read-only, even when nothing queued.
test('A14 interrupted pre-enqueue intent reopens as unknown without another dispatch',{timeout:10000},async()=>{
 const home=await fixture(),sink=await IsolatedNotifications.open(home),clock={now:at};
 let entered!:()=>void;const observedIntent=new Promise<void>(resolve=>{entered=resolve;});
 const interrupted:NotificationPort={lookup:(id,alarm)=>sink.lookup(id,alarm),enqueue:async(_id,_alarm,signal)=>{
  entered();await new Promise<never>((_resolve,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});return 'unknown';
 }};
 let host=await open(home,interrupted,clock);
 try{
  const p=await host.service.propose(spec());await host.service.approve(p.id,p.revision,p.digest);await observedIntent;
  assert.equal((await host.service.snapshot()).occurrences[0].notification,'intent-recorded');
  await host.close();host=await open(home,sink,clock);host.harness.resume();
  const due=await host.service.wait(p.id);assert.equal(due.notification,'unknown');assert.equal(due.status,'due');
  assert.equal((await sink.snapshot()).enqueueCalls,0);
  console.log(JSON.stringify({scenario:'interrupted-before-enqueue',notification:due.notification,enqueueCalls:0}));
 }finally{await host.close();}
});
// Intent: A14 a native marker is not sufficient evidence when the stored payload differs.
test('A14 notification reconciliation refuses changed payload under the same occurrence ID',async()=>{
 const home=await fixture(),sink=await IsolatedNotifications.open(home),clock={now:at};
 const lost:NotificationPort={lookup:(id,alarm)=>sink.lookup(id,alarm),enqueue:async(...args)=>{await sink.enqueue(...args);throw new Error('Fault injection: lost receipt');}};
 const host=await open(home,lost,clock);
 try{
  const p=await host.service.propose(spec());await host.service.approve(p.id,p.revision,p.digest);await host.service.wait(p.id);
  const file=path.join(home,'notifications-fixture.json'),actual=JSON.parse(await readFile(file,'utf8'));
  actual.requests[0].alarm.title='Explicit external-edit fault variant';await writeFile(file,JSON.stringify(actual));
  assert.equal((await host.service.reconcile(p.id)).notification,'unknown');assert.equal((await sink.snapshot()).enqueueCalls,1);
 }finally{await host.close();}
});
