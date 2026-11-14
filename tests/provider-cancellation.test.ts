import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall, type CredentialStore, type OAuthCredential } from '@earendil-works/pi-ai';
import { ProviderManager, ProviderError, catalog, type ProviderId } from '../runtime/providers.js';
import type { ProviderRequestContext, Result } from '../runtime/domain.js';
import { openHost } from '../runtime/pi-durable-adapter.js';

// Intent: ELF-35 — Stop before dispatch or during preparation must prevent inference,
// continuation and backup. Only explicit fake providers and fake credentials exist here.
// Event latches own ordering; mock timers own the timeout. No sleep, retry or live account.
const ROOT=process.env.PIP_TEST_ROOT??path.join(os.tmpdir(),'pip-unit-fixtures');
const REQUEST='Give me a warmer version of: Can you send the notes today?';
const DRAFT='Could you send the notes today when you have a moment? Thank you.';
const BOUND={timeout:5000};
type EngineId=Exclude<ProviderId,'claude'>;
const engines=catalog.filter((d):d is typeof d&{id:EngineId}=>d.id!=='claude');
const answer=()=>fauxAssistantMessage([fauxToolCall('answer',{kind:'draft',title:'A warmer version',text:DRAFT},{id:'finish-rewrite'})]);
const unavailable=()=>fauxAssistantMessage('',{stopReason:'error',errorMessage:'503 upstream unavailable'});
function latch<T=void>(){
 let resolve!:(value:T)=>void;
 const promise=new Promise<T>(yes=>{resolve=yes;});
 return {promise,resolve};
}
function releaseOnExit(t:TestContext){const gate=latch();t.after(()=>gate.resolve());return gate;}
function settled(promise:Promise<Result>){
 return promise.then(value=>({status:'resolved' as const,value}),error=>({status:'rejected' as const,error: error as unknown}));
}
type Outcome=Awaited<ReturnType<typeof settled>>;
function failure(outcome:Outcome,code:string){
 assert.ok(outcome.status==='rejected','the request must reject');
 assert.ok(outcome.error instanceof ProviderError,'the failure must stay safe and provider-owned');
 assert.equal(outcome.error.code,code);assert.equal(outcome.error.unavailable,false);
 return outcome.error;
}
function completed(outcome:Outcome){
 assert.ok(outcome.status==='resolved','the live-signal control must complete');
 assert.equal(outcome.value.text,DRAFT);return outcome.value;
}

async function fixture(t:TestContext,active:ProviderId='openrouter',options:{timeoutMs?:number;maxTurns?:number}={}){
 await mkdir(ROOT,{recursive:true});const home=await mkdtemp(path.join(ROOT,'pip-cancel-'));
 await writeFile(path.join(home,'.pip-test-home'),'pip-test-only');
 let manager!:ProviderManager;
 // Share the real app-owned store/serialization with the real engine, but only in
 // this newly marked home. Ambient environment/files are explicitly unavailable.
 const credentials:CredentialStore={
  read:(id,o)=>manager.credentials.read(id,o),list:o=>manager.credentials.list(o),
  modify:(id,fn,o)=>manager.credentials.modify(id,fn,o),delete:(id,o)=>manager.credentials.delete(id,o)
 };
 const models=createModels({credentials,authContext:{env:async()=>undefined,fileExists:async()=>false}});
 const counts={blockedFetches:0,claudeFactories:0,claudeCalls:0,dispatches:{} as Record<EngineId,number>};
 t.mock.method(globalThis,'fetch',async()=>{counts.blockedFetches++;throw Error('ELF-35 disables network access');});
 const transports=new Map<EngineId,ReturnType<typeof fauxProvider>>();
 t.after(()=>{
  t.diagnostic(JSON.stringify({intent:'ELF-35',active,finalCounters:{...counts,sends:Object.fromEntries([...transports].map(([id,p])=>[id,p.state.callCount]))}}));
  assert.equal(counts.blockedFetches,0,'no fixture may attempt a network fetch');
 });
 for(const d of engines){
  counts.dispatches[d.id]=0;
  const fake=fauxProvider({provider:d.id,api:'pip-cancel-'+d.id,models:[{id:d.defaultModel,name:d.models.find(m=>m.id===d.defaultModel)!.label,input:['text']}]});
  models.setProvider({...fake.provider,auth:{apiKey:{name:'ELF-35 fake stored key',resolve:async({credential,signal})=>{
   signal.throwIfAborted();assert.ok(credential?.key,'only the isolated fake credential may configure this provider');
   return {auth:{apiKey:credential.key}};
  }}}});
  fake.setResponses([answer()]);transports.set(d.id,fake);
 }
 const complete=models.completeSimple.bind(models);
 models.completeSimple=async(model,context,o)=>{counts.dispatches[model.provider as EngineId]++;return complete(model,context,o);};
 manager=new ProviderManager({home,models,...options,claude:()=>{
  counts.claudeFactories++;return async()=>{counts.claudeCalls++;return {kind:'draft',title:'A warmer version',text:DRAFT,sources:[],model:'Offline Claude stand-in',sessionId:'cancel-fixture'};};
 }});
 for(const d of catalog)await manager.allow(d.id);
 for(const d of engines)await manager.credentials.modify(d.id,async()=>({type:'api_key',key:'pip-cancel-fake-'+d.id}));
 await manager.select(active);
 const backup:EngineId=active==='deepseek'?'openrouter':'deepseek';await manager.setBackup(backup);
 const controller=new AbortController();t.after(()=>controller.abort());
 return {home,manager,models,counts,transports,controller,active,backup};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
const run=(f:Fixture,context?:ProviderRequestContext)=>f.manager.provider()(REQUEST,[],f.controller.signal,context??{sessionId:'cancel-fixture'});
function expectedCalls(f:Fixture,expected:Partial<Record<EngineId,{dispatches:number;sends:number}>>={},claude=0){
 for(const d of engines){
  assert.equal(f.counts.dispatches[d.id],expected[d.id]?.dispatches??0,d.id+' dispatches');
  assert.equal(f.transports.get(d.id)!.state.callCount,expected[d.id]?.sends??0,d.id+' inference sends');
 }
 assert.equal(f.counts.claudeFactories,claude,'Claude factories');assert.equal(f.counts.claudeCalls,claude,'Claude calls');
}
function trace(t:TestContext,f:Fixture,outcome:Outcome,extra:Record<string,unknown>={}){
 t.diagnostic(JSON.stringify({intent:'ELF-35',active:f.active,aborted:f.controller.signal.aborted,
  result:outcome.status==='rejected'&&outcome.error instanceof ProviderError?outcome.error.code:outcome.status,
  dispatches:f.counts.dispatches,sends:Object.fromEntries([...f.transports].map(([id,p])=>[id,p.state.callCount])),
  claudeFactories:f.counts.claudeFactories,claudeCalls:f.counts.claudeCalls,...extra}));
}

for(const d of catalog){
 test(`ELF-35 ${d.name}: pre-cancel sends nothing, including to the allowed backup`,BOUND,async t=>{
  const f=await fixture(t,d.id);let preparations=0;
  t.mock.method(f.manager.settings,'read',async()=>{preparations++;throw Error('pre-cancel must not prepare settings');});
  t.mock.method(f.manager.credentials,'read',async()=>{preparations++;throw Error('pre-cancel must not prepare credentials');});
  f.controller.abort();const outcome=await settled(run(f));failure(outcome,'aborted');
  assert.equal(preparations,0);expectedCalls(f);trace(t,f,outcome,{preparations});
 });
 for(const cancel of [true,false]){
  test(`ELF-35 ${d.name}: settings preparation ${cancel?'cancelled before dispatch':'live control'}`,BOUND,async t=>{
   const f=await fixture(t,d.id),entered=latch(),release=releaseOnExit(t);
   const read=f.manager.settings.read.bind(f.manager.settings);
   t.mock.method(f.manager.settings,'read',async()=>{const settings=await read();entered.resolve();await release.promise;return settings;});
   const pending=settled(run(f));await entered.promise;if(cancel)f.controller.abort();release.resolve();
   const outcome=await pending;
   if(cancel){failure(outcome,'aborted');expectedCalls(f);}
   else {completed(outcome);expectedCalls(f,d.id==='claude'?{}:{[d.id]:{dispatches:1,sends:1}},d.id==='claude'?1:0);}
   trace(t,f,outcome);
  });
 }
}

for(const d of engines){
 for(const preparation of ['saved','missing','error','live-control'] as const){
  test(`ELF-35 ${d.name}: credential preparation ${preparation}`,BOUND,async t=>{
   const f=await fixture(t,d.id),entered=latch(),release=releaseOnExit(t);
   const read=f.manager.credentials.read.bind(f.manager.credentials);let held=false;
   t.mock.method(f.manager.credentials,'read',async(id,o)=>{
    if(id!==d.id||held)return read(id,o);held=true;entered.resolve();await release.promise;
    if(preparation==='error')throw Error('503 credential preparation failed');
    return preparation==='missing'?undefined:read(id,o);
   });
   const pending=settled(run(f));await entered.promise;
   if(preparation!=='live-control')f.controller.abort();release.resolve();
   const outcome=await pending;
   if(preparation==='live-control'){completed(outcome);expectedCalls(f,{[d.id]:{dispatches:1,sends:1}});}
   else {failure(outcome,'aborted');expectedCalls(f);}
   trace(t,f,outcome,{preparation});
  });
 }
 for(const cancel of [true,false]){
  test(`ELF-35 ${d.name}: engine auth preparation ${cancel?'cancelled':'live control'}`,BOUND,async t=>{
   const f=await fixture(t,d.id),entered=latch<AbortSignal>(),release=releaseOnExit(t);
   const provider=f.models.getProvider(d.id)!;
   f.models.setProvider({...provider,auth:{apiKey:{name:'ELF-35 latched fake auth',resolve:async({credential,signal})=>{
    assert.ok(credential?.key);entered.resolve(signal);await release.promise;return {auth:{apiKey:credential.key}};
   }}}});
   const pending=settled(run(f)),requestSignal=await entered.promise;
   assert.equal(requestSignal.aborted,false);if(cancel)f.controller.abort();
   assert.equal(requestSignal.aborted,cancel);release.resolve();const outcome=await pending;
   if(cancel)failure(outcome,'aborted');else completed(outcome);
   expectedCalls(f,{[d.id]:{dispatches:1,sends:cancel?0:1}});trace(t,f,outcome,{authSignalAborted:requestSignal.aborted});
  });
 }
}

for(const reply of ['answer','unavailable'] as const){
 test(`ELF-35 cancellation before a model ${reply} reply is consumed stops continuation`,BOUND,async t=>{
  const f=await fixture(t);f.transports.get('openrouter')!.setResponses([reply==='answer'?answer():unavailable()]);
  const complete=f.models.completeSimple.bind(f.models);
  t.mock.method(f.models,'completeSimple',async(model,context,o)=>{const result=await complete(model,context,o);f.controller.abort();return result;});
  const outcome=await settled(run(f));failure(outcome,'aborted');
  expectedCalls(f,{openrouter:{dispatches:1,sends:1}});trace(t,f,outcome);
 });
}

test('ELF-35 a rejecting cancelled model is not an unavailable-provider reason to start backup',BOUND,async t=>{
 const f=await fixture(t),complete=f.models.completeSimple.bind(f.models);
 t.mock.method(f.models,'completeSimple',async(model,context,o)=>{
  const result=await complete(model,context,o);
  if(model.provider===f.active){f.controller.abort();throw Error('fetch failed ECONNRESET');}return result;
 });
 const outcome=await settled(run(f));failure(outcome,'aborted');expectedCalls(f,{openrouter:{dispatches:1,sends:1}});trace(t,f,outcome);
});

for(const continuation of ['resolved','rejected','live-control'] as const){
 test(`ELF-35 tool/model continuation ${continuation==='live-control'?'live control completes':continuation+' read stays stopped'}`,BOUND,async t=>{
  const f=await fixture(t),entered=latch(),release=releaseOnExit(t),reads:string[]=[];
  const calls=[fauxToolCall('targets',{kind:'event'},{id:'event-targets'}),fauxToolCall('targets',{kind:'reminder'},{id:'reminder-targets'})];
  f.transports.get('openrouter')!.setResponses([fauxAssistantMessage(calls,{stopReason:'toolUse'}),(context)=>{
   const results=context.messages.filter(m=>m.role==='toolResult');
   assert.deepEqual(results.map(r=>r.toolCallId),calls.map(c=>c.id));return answer();
  }]);
  const pending=settled(run(f,{sessionId:'cancel-tools',backend:{read:async(op,args)=>{
   assert.equal(op,'targets');reads.push(String(args.kind));
   if(reads.length===1){entered.resolve();await release.promise;if(continuation==='rejected')throw Error('isolated target read failed');}
   return [];
  }}}));
  await entered.promise;if(continuation!=='live-control')f.controller.abort();release.resolve();const outcome=await pending;
  if(continuation==='live-control'){
   completed(outcome);assert.deepEqual(reads,['event','reminder']);expectedCalls(f,{openrouter:{dispatches:2,sends:2}});
  }else {failure(outcome,'aborted');assert.deepEqual(reads,['event']);expectedCalls(f,{openrouter:{dispatches:1,sends:1}});}
  trace(t,f,outcome,{toolReads:reads});
 });
}

for(const preparation of ['saved','missing','error','live-control'] as const){
 test(`ELF-35 backup preparation ${preparation}: ${preparation==='live-control'?'allowed backup completes':'cancellation is not both-failed'}`,BOUND,async t=>{
  const f=await fixture(t),entered=latch(),release=releaseOnExit(t),read=f.manager.credentials.read.bind(f.manager.credentials);let held=false;
  f.transports.get('openrouter')!.setResponses([unavailable()]);
  t.mock.method(f.manager.credentials,'read',async(id,o)=>{
   if(id!==f.backup||held)return read(id,o);held=true;entered.resolve();await release.promise;
   if(preparation==='error')throw Error('503 backup credential read failed');
   return preparation==='missing'?undefined:read(id,o);
  });
  const pending=settled(run(f));await entered.promise;if(preparation!=='live-control')f.controller.abort();release.resolve();
  const outcome=await pending;
  if(preparation==='live-control'){
   assert.ok(completed(outcome).backup);expectedCalls(f,{openrouter:{dispatches:1,sends:1},deepseek:{dispatches:1,sends:1}});
  }else {failure(outcome,'aborted');expectedCalls(f,{openrouter:{dispatches:1,sends:1}});}
  trace(t,f,outcome,{preparation});
 });
}

for(const cancel of [true,false]){
 test(`ELF-35 backup failure ${cancel?'after cancellation remains aborted':'with a live signal remains both-failed'}`,BOUND,async t=>{
  const f=await fixture(t),complete=f.models.completeSimple.bind(f.models);
  f.transports.get('openrouter')!.setResponses([unavailable()]);
  t.mock.method(f.models,'completeSimple',async(model,context,o)=>{
   const result=await complete(model,context,o);
   if(model.provider===f.backup){if(cancel)f.controller.abort();throw Error('503 backup unavailable');}return result;
  });
  const outcome=await settled(run(f));failure(outcome,cancel?'aborted':'both-failed');
  expectedCalls(f,{openrouter:{dispatches:1,sends:1},deepseek:{dispatches:1,sends:1}});trace(t,f,outcome);
 });
}

test('ELF-35 timeout aborts the in-flight signal at its boundary and never enables backup',BOUND,async t=>{
 const timeoutMs=25,f=await fixture(t,'openrouter',{timeoutMs}),entered=latch<AbortSignal>(),release=releaseOnExit(t);
 f.transports.get('openrouter')!.setResponses([async(_context,o)=>{
  assert.ok(o?.signal);entered.resolve(o.signal);await release.promise;return answer();
 }]);
 t.mock.timers.enable({apis:['setTimeout']});
 const pending=settled(run(f)),requestSignal=await entered.promise;
 t.mock.timers.tick(timeoutMs-1);assert.equal(requestSignal.aborted,false);
 t.mock.timers.tick(1);assert.equal(requestSignal.aborted,true);assert.equal(f.controller.signal.aborted,false);
 release.resolve();const outcome=await pending;failure(outcome,'provider-cutoff');
 expectedCalls(f,{openrouter:{dispatches:1,sends:1}});trace(t,f,outcome,{timeoutMs,requestSignalAborted:requestSignal.aborted});
});

test('ELF-35 a live-signal turn cutoff still waits for Continue, with no backup',BOUND,async t=>{
 const maxTurns=2,f=await fixture(t,'openrouter',{maxTurns});
 f.transports.get('openrouter')!.setResponses(Array.from({length:maxTurns},(_,turn)=>fauxAssistantMessage(fauxToolCall('targets',{kind:'event'},{id:'list-isolated-calendars-'+turn}),{stopReason:'toolUse'})));
 let reads=0;const outcome=await settled(run(f,{sessionId:'bounded-tools',backend:{read:async()=>{reads++;return [];}}}));
 failure(outcome,'provider-cutoff');assert.equal(reads,maxTurns);assert.equal(f.controller.signal.aborted,false);
 expectedCalls(f,{openrouter:{dispatches:maxTurns,sends:maxTurns}});trace(t,f,outcome,{toolReads:reads,maxTurns});
});

test('ELF-35 cancellation prevents inference but preserves an already-started fake token rotation',BOUND,async t=>{
 const f=await fixture(t,'openai'),entered=latch<AbortSignal>(),release=releaseOnExit(t),persisted=latch(),derived=latch();
 const expired:OAuthCredential={type:'oauth',access:'pip-cancel-expired-access',refresh:'pip-cancel-old-refresh',expires:Date.now()-1};
 const rotated:OAuthCredential={...expired,access:'pip-cancel-rotated-access',refresh:'pip-cancel-rotated-refresh',expires:Date.now()+3600000};
 await f.manager.credentials.modify('openai',async()=>expired);
 const modify=f.manager.credentials.modify.bind(f.manager.credentials);let rotations=0;
 t.mock.method(f.manager.credentials,'modify',async(id,fn,o)=>{
  const value=await modify(id,fn,o);if(id==='openai'&&value?.type==='oauth'&&value.refresh===rotated.refresh)persisted.resolve();return value;
 });
 const provider=f.models.getProvider('openai')!;
 f.models.setProvider({...provider,auth:{oauth:{name:'ELF-35 offline token rotation',
  login:async()=>{throw Error('ELF-35 must never start login');},
  refresh:async(current,signal)=>{
   assert.deepEqual(current,expired);rotations++;entered.resolve(signal);await release.promise;
   assert.equal(signal.aborted,false,'a started rotation must survive request cancellation');return rotated;
  },toAuth:async credential=>{derived.resolve();return {apiKey:credential.access};}
 }}});
 const pending=settled(run(f)),rotationSignal=await entered.promise;
 assert.notEqual(rotationSignal,f.controller.signal);f.controller.abort();const outcome=await pending;failure(outcome,'aborted');
 assert.equal(rotationSignal.aborted,false);expectedCalls(f,{openai:{dispatches:1,sends:0}});
 release.resolve();await persisted.promise;await derived.promise;
 assert.deepEqual(await f.manager.credentials.read('openai'),rotated);assert.equal(rotations,1);
 expectedCalls(f,{openai:{dispatches:1,sends:0}});trace(t,f,outcome,{rotations,rotatedFakeCredentialPersisted:true,rotationSignalAborted:rotationSignal.aborted});
});

test('ELF-35 host Stop during credential preparation persists Stopped with the request and zero sends',BOUND,async t=>{
 const f=await fixture(t),entered=latch(),release=releaseOnExit(t),aborted=latch();
 const read=f.manager.credentials.read.bind(f.manager.credentials);let held=false;
 t.mock.method(f.manager.credentials,'read',async(id,o)=>{
  if(id!==f.active||held)return read(id,o);held=true;entered.resolve();await release.promise;return read(id,o);
 });
 const provider=f.manager.provider(),taskSignals:AbortSignal[]=[];
 let host=await openHost({home:f.home,fixture:true,provider:(request,memory,signal,context)=>{
  taskSignals.push(signal);signal.addEventListener('abort',()=>aborted.resolve(),{once:true});if(signal.aborted)aborted.resolve();
  return provider(request,memory,signal,context);
 }});
 t.after(async()=>{release.resolve();await host.close();});
 await host.submit('cancel-rewrite',REQUEST);await entered.promise;
 const stopped=host.stop();await aborted.promise;release.resolve();await stopped;
 let work=(await host.snapshot()).works.find(w=>w.id==='cancel-rewrite')!;
 assert.equal(work.status,'Stopped');assert.equal(work.request,REQUEST);assert.equal(work.result,null);expectedCalls(f);
 await host.close();host=await openHost({home:f.home,fixture:true,provider});
 work=(await host.snapshot()).works.find(w=>w.id==='cancel-rewrite')!;
 assert.equal(work.status,'Stopped');assert.equal(work.request,REQUEST);assert.equal(work.result,null);expectedCalls(f);
 assert.equal(taskSignals.length,1);assert.equal(taskSignals[0].aborted,true);
 t.diagnostic(JSON.stringify({intent:'ELF-35',status:work.status,taskSignalAborted:taskSignals[0].aborted,requestPreserved:work.request===REQUEST,result:work.result,reopened:true,dispatches:f.counts.dispatches,sends:Object.fromEntries([...f.transports].map(([id,p])=>[id,p.state.callCount]))}));
});
