import { projectContext } from './projects.js';
import { mkdir, open, readFile, rename, chmod, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { Harness, defineDoc, defineTask, defineExtension, createRegistry } from '@earendil-works/pi-durable';
import { openNodeSqliteDatabase } from '@earendil-works/pi-durable/storage/sqlite/node';
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite';
import { initialState, propose, approve, recover, text, validateAction, currentSchema, type State, type Proposal, type Action } from './domain.js';
import { resolvePublic } from './public-web.js';
import { disabledProvider, type Provider } from './claude.js';
import { backendAction, isBackendAction, object, value as backendValue, type BackendPort, type BackendReply } from './backend-contracts.js';
import { localAlarmBackend, occurrenceID, alarmDigest } from './alarms.js';
import { migrateTracker, saveFeedback, correctFeedback, trackerRecords, saveBacklogWork, recordWorkStatus, type FeedbackInput, type BacklogWorkInput } from './tracker.js';

import { EphemeralScreenContexts, screenRef } from './screen-context.js';

const PipState = defineDoc<State>({kind:'pip.state',version:1,scope:'session',initial:initialState,checkpointWhen:()=>true});
export type HostOptions = {browser?:(workId:string)=>import('./task-browser.js').BrowserTools|undefined;home:string; fixture?:boolean; provider?:Provider; changed?:()=>void; native?: (proposal:Proposal)=>void; claudeAllowed?:boolean; backend?:BackendPort};
export async function openHost(options: HostOptions) {
 if(options.backend&&!options.fixture)throw new Error('Backend wiring is isolated-only; system stores are disabled.');
 const home = path.resolve(options.home);
 const production = path.join(os.homedir(),'Library/Application Support/Pip');
 if (options.fixture) {
  if (home===production || home.startsWith(production+'/')) throw new Error('Tests cannot use production state');
  if ((await readFile(path.join(home,'.pip-test-home'),'utf8')).trim()!=='pip-test-only') throw new Error('Test state marker is required');
 }
 await mkdir(home,{recursive:true,mode:0o700});
 const canonical = await realpath(home);
 if (options.fixture && (canonical===production || canonical.startsWith(production+'/'))) throw new Error('Test home resolves to production');
 await chmod(home,0o700);
 const lockPath=path.join(home,'service.lock');
 let lock;
 try {lock=await open(lockPath,'wx',0o600);} catch {
  let owner = Number(await readFile(lockPath,'utf8'));
  if (!Number.isSafeInteger(owner) || owner<=0) throw new Error('Pip state is held by another instance');
  try {process.kill(owner,0); throw new Error('Pip state is held by another instance');} catch(error) { if ((error as NodeJS.ErrnoException).code!=='ESRCH') throw error; }
  await rename(lockPath,lockPath+'.interrupted-'+randomUUID());
  lock=await open(lockPath,'wx',0o600);
 }
 await lock.writeFile(String(process.pid)); await lock.close();
 const db=await openNodeSqliteDatabase(path.join(home,'pip.sqlite'));
 const storage=await SqliteStorage.open(db);
 await db.exec('PRAGMA synchronous=FULL');
 const journal=await db.get<{journal_mode:string}>('PRAGMA journal_mode');
 const sync=await db.get<{synchronous:number}>('PRAGMA synchronous');
 if(journal?.journal_mode!=='wal'||sync?.synchronous!==2) throw new Error('Required SQLite durability mode unavailable');
 await chmod(path.join(home,'pip.sqlite'),0o600);
 const provider=options.provider ?? disabledProvider;
 const screenContexts=new EphemeralScreenContexts();
 const checkAction=async(action:Action)=>{if(isBackendAction(action.type)){if(!options.backend)throw new Error('Isolated backend is not connected. No system store is enabled.');await options.backend.check(backendAction(action));}};
 const WorkTask=defineTask<{workId:string},{phase:'run'},null>({
  name:'pip.work',version:1,initial:()=>({phase:'run'}),
  phases:{run:async (task,runtime,ctx)=>{
   let admitted=false;
   await runtime.commit(async tx=>{const s=await tx.doc(PipState),w=s.works.find(w=>w.id===task.input.workId);
    if(!w||w.status!=='Queued'||w.taskId!==task.id)return {status:'terminal',outcome:{status:'completed',result:null}};
    recordWorkStatus(w,'Working','The model worker started this requested episode.');w.sessionId??=randomUUID();w.threadId??=w.id;
    w.usage??={attempts:0,activeMilliseconds:0};w.usage.attempts++;admitted=true;
    return {status:'running',checkpoint:{phase:'run'}};
   },ctx);
   if(!admitted)return;
   const started=Date.now();
   options.changed?.();
   const snapshot=await runtime.snapshot(PipState,ctx);
   const work=snapshot?.works.find(w=>w.id===task.input.workId);
   if(!work) throw new Error('Work is missing');
   const browser=options.browser?.(work.id);
   if(work.browserRequired&&!browser){
    await runtime.commit(async tx=>{const w=(await tx.doc(PipState)).works.find(w=>w.id===work.id)!;recordWorkStatus(w,'Interrupted','The isolated browser grant expired.');w.error='The task browser expired. Start a new browser task and review its pages again.';return {status:'terminal',outcome:{status:'completed',result:null}};},ctx);options.changed?.();return;
   }
   const screen=work.screenContext?screenContexts.take(work.id):undefined;
   if(work.screenContext&&!screen){
    await runtime.commit(async tx=>{const w=(await tx.doc(PipState)).works.find(w=>w.id===work.id)!;recordWorkStatus(w,'Interrupted','Ephemeral window context is no longer available.');w.needsScreenContext=true;w.error='The window preview expired. Review and share a fresh window, then Continue this task.';return {status:'terminal',outcome:{status:'completed',result:null}};},ctx);options.changed?.();return;
   }
   try {
    const result=await provider(work.request,(snapshot?.memory??[]).filter(m=>m.active),runtime.signal,{sessionId:work.sessionId!,...(browser?{browser}:{}),...(screen?{screen}:{}),...(work.context?{context:work.context}:{}),...(work.projectContext?{project:projectContext(snapshot!,work.projectContext.id,work.projectContext.revision)}:{}),...(options.backend?{backend:{read:(op:string,args:Record<string,unknown>)=>options.backend!.read(op,args)}}:{})});
    if(result.proposal)await checkAction(result.proposal);
    if(result.proposal?.type==='url.open')await resolvePublic(result.proposal.url);
    if(result.proposal?.type==='memory.save')result.proposal.source=work.request;
    await runtime.commit(async tx=>{
     const s=await tx.doc(PipState); const w=s.works.find(w=>w.id===task.input.workId)!;
     w.usage!.activeMilliseconds+=Date.now()-started;
     recordWorkStatus(w,'Done','Provider output returned; goal verification is separate.'); w.result=result; w.completion='review';
     if(result.proposal) propose(s,result.proposal).workId=w.id;
     return {status:'terminal',outcome:{status:'completed',result:null}};
    },ctx);
   } catch(error) {
    if(runtime.signal.aborted) throw error;
    await runtime.commit(async tx=>{ const w=(await tx.doc(PipState)).works.find(w=>w.id===task.input.workId)!; w.usage!.activeMilliseconds+=Date.now()-started;const code=(error as {code?:string})?.code;if(code==='provider-cutoff'||code==='no-progress'||code==='context-changed')w.pauseReason=code;recordWorkStatus(w,w.pauseReason==='provider-cutoff'||w.pauseReason==='no-progress'||w.pauseReason==='context-changed'?'Interrupted':'Could not finish','The worker could not finish this request; no automatic retry.'); w.error=code==='context-changed'?'Project context changed. Review its current summary before continuing.':error instanceof Error && (error.message.startsWith('Claude')||(error as {safe?:boolean}).safe===true) ? error.message : 'This request could not finish. Your input is saved; no action was taken.'; return {status:'terminal',outcome:{status:'completed',result:null}}; },ctx);
   }
   options.changed?.();
  }},
  abort:async(task,runtime,ctx)=>{
   await runtime.commit(async tx=>{const w=(await tx.doc(PipState)).works.find(w=>w.id===task.input.workId); if(w)recordWorkStatus(w,'Stopped','Stop prevented further worker steps; issued actions were not undone.'); return {status:'terminal',outcome:{status:'aborted'}};},ctx);
   options.changed?.();
  }
 });
 const registry=createRegistry(); registry.install(defineExtension({name:'pip',tasks:[WorkTask]}));
 const alarmBackend=options.backend?localAlarmBackend({enqueue:(id,alarm)=>options.backend!.notify(id,alarm),lookup:(id,alarm)=>options.backend!.lookupNotification(id,alarm)}):undefined;
 if(alarmBackend)registry.install(alarmBackend.extension);
 const harness=await Harness.open(storage,{models:createModels(),registry},context);
 const root=await harness.root(context);
 const previousState=await harness.snapshot(PipState,context);
 let migrationBackup:string|undefined;
 if(previousState&&previousState.schema>=1&&previousState.schema<currentSchema){
  migrationBackup=path.join(home,`pip-before-schema-${currentSchema}-${randomUUID()}.sqlite`);
  await db.exec("VACUUM INTO '"+migrationBackup.replace(/'/g,"''")+"'");await chmod(migrationBackup,0o600);
 }
 const alarms=alarmBackend?.attach(harness);
 // Unknown effects remain held; inference can resume without effect replay.
 await harness.commit(async tx=>{const state=await tx.doc(PipState);migrateTracker(state);recover(state);for(const w of state.works)if(['Working','Queued'].includes(w.status)){recordWorkStatus(w,'Interrupted','Pip restarted. Review context and explicitly Continue; previous actions will not replay.');w.pauseReason='restart';w.error='Pip restarted. Continue only after reviewing current sources and scope.';if(w.screenContext)w.needsScreenContext=true;}},context);
 const snapshot=async()=> structuredClone((await harness.snapshot(PipState,context))??initialState());
 let closing=false;
 const emit=()=>{if(!closing)options.changed?.();};
 const recordBackend=async(id:string,reply:BackendReply,reconciling=false)=>{
  const expected=(await snapshot()).proposals.find(p=>p.id===id);
  if(reply.status==='succeeded'&&expected?.action.type==='schedule.mutate'){
   try{const record=object(reply.result);if(typeof record.id!=='string'||record.correlation!==id||record.targetID!==expected.action.change.target.id||JSON.stringify(backendValue(record.value))!==JSON.stringify(expected.action.change.after)||expected.action.change.objectID!==null&&record.id!==expected.action.change.objectID)throw Error('Mismatched native receipt');}
   catch{reply={status:'unknown',receipt:'The native receipt does not match the approved isolated object and payload. It will not be repeated.'};}
  }
  text(reply.receipt,'receipt',1000);const result=reply.result===undefined?undefined:JSON.stringify(reply.result);if(result&&result.length>1000000)throw Error('Backend result too large');
  await harness.commit(async tx=>{const p=(await tx.doc(PipState)).proposals.find(p=>p.id===id);if(!p||p.status!==(reconciling?'unknown':'intent-recorded'))throw Error('Unexpected backend receipt');p.status=reply.status;p.receipt=reply.receipt;if(result!==undefined)p.backendResult=result;},context);emit();
 };
 const dispatchBackend=async(p:Proposal,reconciling=false)=>{
  const action=backendAction(p.action);let reply:BackendReply;
  try{
   if(action.type==='alarm.schedule'){
    if(!alarms)throw Error('Local alarm backend unavailable');
    if(reconciling){const o=(await alarms.snapshot()).occurrences.find(o=>o.id===occurrenceID(action.alarm)&&o.digest===alarmDigest(action.alarm));reply=o&&o.status!=='proposed'?{status:'succeeded',receipt:'Confirmed the isolated local alarm schedule without re-enqueueing.',result:o}:{status:'unknown',receipt:'The local alarm schedule cannot be proved. It was not repeated.'};}
    else {const plan=await alarms.propose(action.alarm);await alarms.approve(plan.id,plan.revision,plan.digest);reply={status:'succeeded',receipt:'Scheduled the approved local alarm in isolated state only; this does not claim notification delivery.',result:plan};}
   }else{reply=await options.backend![reconciling?'reconcile':'execute']({id:p.id,status:p.status,action});}
  }catch{reply={status:'unknown',receipt:'The isolated backend outcome is uncertain. It will not repeat automatically.'};}
  await recordBackend(p.id,reply,reconciling);
 };
 // One model worker at a time; coordinator admits requests immediately.
 let pumping=false;
 async function pump() {
  if(pumping||closing)return; pumping=true;
  try {
   while(!closing) {
    const s=await snapshot();
    const existing=s.works.find(w=>['Working','Queued'].includes(w.status)&&w.taskId);
    if(existing) {await harness.waitForTask(existing.taskId as never,context); continue;}
    const queued=s.works.find(w=>w.status==='Queued'); if(!queued)break;
    const id=await root.commit(async tx=>{
     const d=await tx.doc(PipState); const w=d.works.find(w=>w.id===queued.id)!;
     const id=await tx.createTask(WorkTask,{workId:w.id},{ownership:{kind:'conversation'}}); w.taskId=id; return id;
    },context);
    harness.resume(); await harness.waitForTask(id,context);
   }
  } catch(error) { if(!closing) { console.error('Pip work scheduler could not finish.'); } } finally {pumping=false; emit();}
 }
 harness.resume(); void pump();
 return {
  durability:{journal:journal.journal_mode,synchronous:sync.synchronous}, migrationBackup, snapshot,
  async saveWorkToBacklog(input:BacklogWorkInput) {const saved=await harness.commit(async tx=>JSON.parse(JSON.stringify(saveBacklogWork(await tx.doc(PipState),input))),context);emit();return saved;},
  async saveFeedback(input:FeedbackInput) {const saved=await harness.commit(async tx=>JSON.parse(JSON.stringify(saveFeedback(await tx.doc(PipState),input))),context);emit();return saved;},
  async correctFeedback(id:string,revision:number,change:Parameters<typeof correctFeedback>[3]) {const saved=await harness.commit(async tx=>JSON.parse(JSON.stringify(correctFeedback(await tx.doc(PipState),id,revision,change))),context);emit();return saved;},
  async tracker(view:'work'|'about',query='',status='') {if(view!=='work'&&view!=='about')throw Error('Invalid tracker view');if(query.length>1000||status.length>100)throw Error('Invalid tracker filter');return trackerRecords(await snapshot(),view,query,status);},
  async attachScreenContext(input:unknown){return screenContexts.attach(input);},
  async discardScreenContext(reference?:unknown){
   const ref=reference===undefined?undefined:screenRef(reference);screenContexts.discard(ref);
   await harness.commit(async tx=>{for(const w of (await tx.doc(PipState)).works)if(w.screenContext&&(!ref||w.screenContext.id===ref.id&&w.screenContext.revision===ref.revision)&&w.status==='Queued'&&!w.taskId){recordWorkStatus(w,'Interrupted','The unstarted window context was discarded.');w.needsScreenContext=true;w.error='The window preview expired. Review and share a fresh window, then Continue this task.';}},context);emit();
  },
  async resumeScreenWork(id:string,reference:unknown){
   let bound=false;
   try{await harness.commit(async tx=>{const s=await tx.doc(PipState),w=s.works.find(w=>w.id===id);
    if(!w||w.status!=='Interrupted'||!w.needsScreenContext||s.proposals.some(p=>p.workId===id&&['unknown','intent-recorded'].includes(p.status)))throw Error('This work is not waiting for window reattachment.');
    w.screenContext=screenContexts.bind(id,reference);bound=true;w.needsScreenContext=false;w.error='';w.taskId=0;w.sessionId=randomUUID();recordWorkStatus(w,'Queued','The user reviewed a fresh window and requested continuation.');
   },context);}catch(error){if(bound)screenContexts.release(id);throw error;}
   emit();void pump();
  },
  async submit(id:string,request:string,contextWorkId?:string,screenReference?:unknown,projectReference?:{id:string;revision:number},browserRequired=false) {
   text(id,'request ID',100); text(request,'request',12000);
   if(contextWorkId!==undefined)text(contextWorkId,'selected result',100);
   let bound=false;
   try{await harness.commit(async tx=>{
    const s=await tx.doc(PipState); const existing=s.works.find(w=>w.id===id);
    if(existing){if(existing.status==='Backlog')throw Error('Saved work needs a separate start request; backlog execution is not connected.');return;}
    if(s.feedback?.some(f=>f.id===id))throw Error('Record ID already used by feedback');
    const parent=contextWorkId?s.works.find(w=>w.id===contextWorkId):undefined;
    if(contextWorkId&&(!parent?.result||parent.status!=='Done'))throw new Error('The selected result is unavailable. Select a completed result or start a new request.');
    const approvedProject=projectReference?projectContext(s,projectReference.id,projectReference.revision):undefined;
    const selected=parent?.result?{workId:parent.id,request:parent.request,result:{kind:parent.result.kind,title:parent.result.title,text:parent.result.text}}:undefined;
    const at=new Date().toISOString();
    const screenContext=screenReference===undefined?undefined:screenContexts.bind(id,screenReference);bound=!!screenContext;
    s.works.push({id,request,...(approvedProject?{projectContext:approvedProject}:{}),...(browserRequired?{browserRequired:true}:{}),...(screenContext?{screenContext}:{}),title:request,priority:'normal',updatedAt:at,history:[{at,status:'Queued',note:'The user submitted this request.'}],status:'Queued',result:null,error:'',taskId:0,createdAt:at,sessionId:randomUUID(),threadId:parent?.threadId??parent?.id??id,...(selected?{context:selected}:{})});
    s.composer='';
   },context);}catch(error){if(bound)screenContexts.release(id);throw error;}
   emit(); void pump(); return id;
  },
  async stop() {
   screenContexts.discard();
   const s=await snapshot();
   await harness.commit(async tx=>{for(const w of (await tx.doc(PipState)).works) if(w.status==='Queued'&&!w.taskId||w.status==='Interrupted'){w.needsScreenContext=false;w.error='';recordWorkStatus(w,'Stopped','Stopped before further worker steps; issued actions were not undone.');}},context);
   for(const w of s.works.filter(w=>['Working','Queued'].includes(w.status)&&w.taskId)) { await harness.abortTask(w.taskId as never,context); await harness.waitForTask(w.taskId as never,context); }
   emit();
  },
  async saveComposer(value:unknown) {if(typeof value!=='string'||value.length>12000)throw new Error('Invalid input'); await harness.commit(async tx=>{(await tx.doc(PipState)).composer=value;},context);},
  async saveDraft(id:string,value:unknown) {text(value); await harness.commit(async tx=>{const w=(await tx.doc(PipState)).works.find(w=>w.id===id); if(!w?.result||w.result.kind!=='draft')throw new Error('Draft missing'); for(const p of (await tx.doc(PipState)).proposals) if(p.status==='proposed'&&(p.action.type==='clipboard.copy'||p.action.type==='note.save')&&p.action.text===w.result.text)p.status='cancelled'; w.result.text=value as string;},context);},
  backendQuery:async(op:string,args:Record<string,unknown>)=>{if(!options.backend)throw Error('Isolated backend is disabled');return options.backend.read(op,args);},
  alarmSnapshot:async()=>alarms?alarms.snapshot():{occurrences:[]},
  waitAlarm:async(id:string)=>{if(!alarms)throw Error('Isolated alarm backend disabled');return alarms.wait(id);},
  async reconcile(id:string){const p=(await snapshot()).proposals.find(p=>p.id===id);if(!p||p.status!=='unknown'||!isBackendAction(p.action.type)||!options.backend)throw Error('No uncertain isolated effect to reconcile');await dispatchBackend(p,true);return (await snapshot()).proposals.find(p=>p.id===id)!;},
  async propose(action:unknown) {await checkAction(validateAction(action));if((action as Action)?.type==='url.open')await resolvePublic((action as {url:string}).url);const p=await harness.commit(async tx=>JSON.parse(JSON.stringify(propose(await tx.doc(PipState),action))) as Proposal,context); emit(); return p;},
  async cancel(id:string) {await harness.commit(async tx=>{const p=(await tx.doc(PipState)).proposals.find(p=>p.id===id); if(p?.status==='proposed')p.status='cancelled';},context);emit();},
  async approve(id:string,revision:number,digest:string) {
   const candidate=(await snapshot()).proposals.find(p=>p.id===id);if(candidate)await checkAction(candidate.action);
   const p=await harness.commit(async tx=>{const s=await tx.doc(PipState),p=approve(s,id,revision,digest);
    if(p.action.type==='work.continue'){
     const action=p.action;const w=s.works.find(w=>w.id===action.workId)!;
     if(w.projectContext)w.projectContext=projectContext(s,w.projectContext.id,p.action.projectRevision);
     w.error='';delete w.pauseReason;w.taskId=0;w.sessionId=randomUUID();recordWorkStatus(w,'Queued','The user approved fresh context and requested continuation. Prior effects are not replayed.');
    }
    return JSON.parse(JSON.stringify(p)) as Proposal;
   },context);
   if(p.action.type==='work.continue')void pump();
   emit();
   if(p.status==='intent-recorded') {if(isBackendAction(p.action.type))await dispatchBackend(p);else options.native?.(structuredClone(p));}
   return (await snapshot()).proposals.find(item=>item.id===p.id)!;
  },
  async receipt(id:string,status:'succeeded'|'failed-known'|'unknown',receipt:string) {
   text(receipt,'receipt',1000);
   await harness.commit(async tx=>{const p=(await tx.doc(PipState)).proposals.find(p=>p.id===id); if(!p||p.status!=='intent-recorded')throw new Error('Unexpected receipt'); p.status=status;p.receipt=receipt;},context);emit();
  },
  async close() {closing=true;screenContexts.discard();await harness.close(context);await rename(lockPath,lockPath+'.closed-'+randomUUID());},
 };
}
export type Host=Awaited<ReturnType<typeof openHost>>;
