import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall, type CredentialStore, type OAuthCredential } from '@earendil-works/pi-ai';
import { ProviderManager, catalog, type ProviderId } from '../runtime/providers.js';
import { openHost, type Host } from '../runtime/pi-durable-adapter.js';
import type { BrowserTools } from '../runtime/task-browser.js';
import { testHome, until, finished } from './helpers/ask.js';

// Intent: ELF-35 — Stop before dispatch or during preparation must prevent inference, continuation and backup.
// ELF-56 moves the same intent onto the one conversation: Stop, the time limit and the turn limit end the ask at every
// step, and none of them starts the backup. Only explicit fake providers and fake credentials exist here.
// Event latches own ordering; no sleep, retry or live account.
const BOUND={timeout:8000};
const REQUEST='Give me a warmer version of: Can you send the notes today?';
const DRAFT='Could you send the notes today when you have a moment? Thank you.';
const engines=catalog.map(d=>d.id) as ProviderId[];
const answer=()=>fauxAssistantMessage(DRAFT);
const unavailable=()=>fauxAssistantMessage('',{stopReason:'error',errorMessage:'503 upstream unavailable'});
function latch<T=void>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return {promise,resolve};}
function releaseOnExit(t:TestContext){const gate=latch();t.after(()=>gate.resolve());return gate;}

async function fixture(t:TestContext,active:ProviderId='openrouter',limits?:{turns?:number;milliseconds?:number}){
 const home=await testHome('pip-cancel-');
 let manager!:ProviderManager;
 // Share the real app-owned credential store with the engine, only in this newly marked home. Ambient environment and files are unavailable.
 const credentials:CredentialStore={read:(id,o)=>manager.credentials.read(id,o),list:o=>manager.credentials.list(o),modify:(id,fn,o)=>manager.credentials.modify(id,fn,o),delete:(id,o)=>manager.credentials.delete(id,o)};
 const models=createModels({credentials,authContext:{env:async()=>undefined,fileExists:async()=>false}});
 const transports=new Map<ProviderId,ReturnType<typeof fauxProvider>>();
 const counts={blockedFetches:0};
 t.mock.method(globalThis,'fetch',async()=>{counts.blockedFetches++;throw Error('ELF-35 disables network access');});
 t.after(()=>assert.equal(counts.blockedFetches,0,'no fixture may attempt a network fetch'));
 for(const d of catalog){
  const fake=fauxProvider({provider:d.id,api:'pip-cancel-'+d.id,models:[{id:d.defaultModel,name:d.models.find(m=>m.id===d.defaultModel)!.label,input:['text']}]});
  models.setProvider({...fake.provider,auth:{apiKey:{name:'ELF-35 fake stored key',resolve:async({credential,signal})=>{signal.throwIfAborted();assert.ok(credential?.key,'only the isolated fake credential may configure this provider');return {auth:{apiKey:credential.key}};}}}});fake.setResponses([answer()]);transports.set(d.id,fake);
 }
 manager=new ProviderManager({home,models});
 for(const d of catalog)await manager.allow(d.id);
 for(const d of engines)await manager.credentials.modify(d,async()=>({type:'api_key',key:'pip-cancel-fake-'+d}));
 await manager.select(active);
 const backup:ProviderId=active==='deepseek'?'openrouter':'deepseek';await manager.setBackup(backup);
 const hosts:Host[]=[];
 const open=async(options:Partial<Parameters<typeof openHost>[0]>={})=>{const host=await openHost({home,fixture:true,retry:{maxRetries:0},engine:manager.engine(),...(limits?{limits}:{}),...options});hosts.push(host);return host;};
 t.after(async()=>{for(const h of hosts)await h.close().catch(()=>undefined);});
 const sends=()=>Object.fromEntries([...transports].map(([id,p])=>[id,p.state.callCount]));
 return {home,manager,models,transports,active,backup,open,sends};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
const statusOf=async(host:Host,id='a')=>(await host.snapshot()).works.find(w=>w.id===id)!;
function noSends(f:Fixture,expected:Partial<Record<ProviderId,number>>={}){
 for(const d of engines)assert.equal(f.transports.get(d)!.state.callCount,expected[d]??0,d+' inference sends');
}
/** Submit one ask, wait until `entered` says the ask reached the held step, Stop (or not), release, and read the result. */
async function interrupt(f:Fixture,entered:Promise<unknown>,release:{resolve:()=>void},stop:boolean){
 const host=await f.open();await host.submit('a',REQUEST);await entered;
 const stopped=stop?host.stop():Promise.resolve();
 release.resolve();await stopped;
 await until(host,finished('a'));return {host,work:await statusOf(host)};
}

for(const d of engines){
 for(const stop of [true,false]){
  test(`ELF-35 ${d}: settings preparation ${stop?'stopped before dispatch':'live control'}`,BOUND,async t=>{
   const f=await fixture(t,d),entered=latch(),release=releaseOnExit(t);
   const read=f.manager.settings.read.bind(f.manager.settings);let held=false;
   t.mock.method(f.manager.settings,'read',async()=>{const settings=await read();if(held)return settings;held=true;entered.resolve();await release.promise;return settings;});
   const {work}=await interrupt(f,entered.promise,release,stop);
   if(stop){assert.equal(work.status,'Stopped');assert.equal(work.request,REQUEST);assert.equal(work.result,null);noSends(f);}
   else{assert.equal(work.status,'Done');assert.equal(work.result?.text,DRAFT);noSends(f,{[d]:1});}
  });
  test(`ELF-35 ${d}: credential preparation ${stop?'stopped before dispatch':'live control'}`,BOUND,async t=>{
   const f=await fixture(t,d),entered=latch(),release=releaseOnExit(t);
   const read=f.manager.credentials.read.bind(f.manager.credentials);let held=false;
   t.mock.method(f.manager.credentials,'read',async(id,o)=>{if(id!==d||held)return read(id,o);held=true;entered.resolve();await release.promise;return read(id,o);});
   const {work}=await interrupt(f,entered.promise,release,stop);
   if(stop){assert.equal(work.status,'Stopped');assert.equal(work.result,null);noSends(f);}
   else{assert.equal(work.status,'Done');noSends(f,{[d]:1});}
  });
 }
}

for(const stop of [true,false]){
 test(`ELF-35 the model's own request ${stop?'is aborted by Stop and never starts the backup':'completes with a live signal'}`,BOUND,async t=>{
  const f=await fixture(t),entered=latch<AbortSignal>(),release=releaseOnExit(t);
  f.transports.get('openrouter')!.setResponses([async(_context,o)=>{
   assert.ok(o?.signal);entered.resolve(o.signal);
   if(stop)await new Promise<void>(yes=>o.signal!.addEventListener('abort',()=>yes(),{once:true}));else await release.promise;
   return stop?fauxAssistantMessage('',{stopReason:'aborted',errorMessage:'Request was aborted'}):answer();
  }]);
  const host=await f.open();await host.submit('a',REQUEST);const signal=await entered.promise;
  assert.equal(signal.aborted,false);
  if(stop){await host.stop();assert.equal(signal.aborted,true);}else release.resolve();
  await until(host,finished('a'));const work=await statusOf(host);
  if(stop){assert.equal(work.status,'Stopped');assert.equal(work.result,null);noSends(f,{openrouter:1});}
  else{assert.equal(work.status,'Done');noSends(f,{openrouter:1});}
 });
}

for(const stop of [true,false]){
 test(`ELF-35 a tool the model called ${stop?'stays stopped: no reply is sent after it':'lets the continuation complete with a live signal'}`,BOUND,async t=>{
  const f=await fixture(t),entered=latch(),release=releaseOnExit(t),inspected:number[]=[];
  const browser:BrowserTools={inspect:async()=>{inspected.push(inspected.length);if(inspected.length===1){entered.resolve();await release.promise;}return {revision:1,url:'https://example.com/',title:'Page',text:'Text',truncated:false,links:[]};},navigate:async()=>{throw Error('unused');},scroll:async()=>{throw Error('unused');}};
  f.transports.get('openrouter')!.setResponses([fauxAssistantMessage([fauxToolCall('inspect',{},{id:'first-look'}),fauxToolCall('inspect',{},{id:'second-look'})],{stopReason:'toolUse'}),(context)=>{
   assert.deepEqual(context.messages.filter(m=>m.role==='toolResult').map(r=>r.toolCallId),['first-look','second-look']);return answer();
  }]);
  const host=await f.open({browser:()=>browser});await host.submit('a',REQUEST,undefined,undefined,undefined,true);await entered.promise;
  const stopped=stop?host.stop():Promise.resolve();release.resolve();await stopped;
  await until(host,finished('a'));const work=await statusOf(host);
  if(stop){assert.equal(work.status,'Stopped');assert.equal(work.result,null);noSends(f,{openrouter:1});}
  else{assert.equal(work.status,'Done');assert.equal(inspected.length,2);noSends(f,{openrouter:2});}
 });
}

for(const stop of [true,false]){
 test(`ELF-35 backup preparation ${stop?'stopped: no backup send and not both-failed':'live control: the allowed backup answers'}`,BOUND,async t=>{
  const f=await fixture(t),entered=latch(),release=releaseOnExit(t),read=f.manager.credentials.read.bind(f.manager.credentials);let held=false;
  f.transports.get('openrouter')!.setResponses([unavailable()]);
  t.mock.method(f.manager.credentials,'read',async(id,o)=>{if(id!==f.backup||held)return read(id,o);held=true;entered.resolve();await release.promise;return read(id,o);});
  const {work}=await interrupt(f,entered.promise,release,stop);
  if(stop){assert.equal(work.status,'Stopped');assert.equal(work.result,null);noSends(f,{openrouter:1});}
  else{assert.equal(work.status,'Done');assert.ok(work.result?.backup);noSends(f,{openrouter:1,deepseek:1});}
 });
}

test('ELF-35 a backup that fails with a live signal reports both-failed',BOUND,async t=>{
 const f=await fixture(t);
 f.transports.get('openrouter')!.setResponses([unavailable()]);f.transports.get('deepseek')!.setResponses([unavailable()]);
 const host=await f.open();await host.submit('a',REQUEST);await until(host,finished('a'));
 const work=await statusOf(host);assert.equal(work.status,'Could not finish');assert.match(work.error,/Backup DeepSeek also could not answer/);
 noSends(f,{openrouter:1,deepseek:1});
});

test('ELF-35 the time limit aborts the in-flight request and never enables the backup',BOUND,async t=>{
 const f=await fixture(t,'openrouter',{milliseconds:50}),entered=latch<AbortSignal>(),release=releaseOnExit(t);
 f.transports.get('openrouter')!.setResponses([async(_context,o)=>{
  assert.ok(o?.signal);entered.resolve(o.signal);await new Promise<void>(yes=>o.signal!.addEventListener('abort',()=>yes(),{once:true}));
  return fauxAssistantMessage('',{stopReason:'aborted',errorMessage:'Request was aborted'});
 }]);
 void release;
 const host=await f.open();await host.submit('a',REQUEST);const signal=await entered.promise;
 await until(host,finished('a'));const work=await statusOf(host);
 assert.equal(signal.aborted,true);assert.equal(work.status,'Interrupted');assert.equal(work.pauseReason,'provider-cutoff');assert.match(work.error,/time boundary|This request could not finish/);
 noSends(f,{openrouter:1});
});

test('ELF-35 the turn limit still waits for Continue, with no backup',BOUND,async t=>{
 const f=await fixture(t,'openrouter',{turns:2});
 f.transports.get('openrouter')!.setResponses(Array.from({length:4},(_,turn)=>fauxAssistantMessage(fauxToolCall('no_such_tool',{n:turn},{id:'look-'+turn}),{stopReason:'toolUse'})));
 const host=await f.open();await host.submit('a',REQUEST);await until(host,finished('a'));
 const work=await statusOf(host);assert.equal(work.status,'Interrupted');assert.equal(work.pauseReason,'provider-cutoff');assert.match(work.error,/turn boundary|could not finish/);
 noSends(f,{openrouter:2});
});

test('ELF-35 Stop prevents inference but preserves an already-started fake token rotation',BOUND,async t=>{
 const f=await fixture(t,'openai'),entered=latch<AbortSignal>(),release=releaseOnExit(t),persisted=latch();
 const expired:OAuthCredential={type:'oauth',access:'pip-cancel-expired-access',refresh:'pip-cancel-old-refresh',expires:Date.now()-1};
 const rotated:OAuthCredential={...expired,access:'pip-cancel-rotated-access',refresh:'pip-cancel-rotated-refresh',expires:Date.now()+3600000};
 await f.manager.credentials.modify('openai',async()=>expired);
 const modify=f.manager.credentials.modify.bind(f.manager.credentials);let rotations=0;
 t.mock.method(f.manager.credentials,'modify',async(id,fn,o)=>{const value=await modify(id,fn,o);if(id==='openai'&&value?.type==='oauth'&&value.refresh===rotated.refresh)persisted.resolve();return value;});
 const provider=f.models.getProvider('openai')!;
 f.models.setProvider({...provider,auth:{oauth:{name:'ELF-35 offline token rotation',
  login:async()=>{throw Error('ELF-35 must never start login');},
  refresh:async(current,signal)=>{assert.equal(current.refresh,expired.refresh);rotations++;entered.resolve(signal);await release.promise;return rotated;},
  toAuth:async credential=>({apiKey:credential.access})}}});
 const host=await f.open();await host.submit('a',REQUEST);await entered.promise;
 await host.stop();release.resolve();await until(host,finished('a'));
 const work=await statusOf(host);assert.equal(work.status,'Stopped');
 await persisted.promise;assert.deepEqual(await f.manager.credentials.read('openai'),rotated);assert.equal(rotations,1);
 noSends(f);
});

test('ELF-35 host Stop persists Stopped with the request and zero sends, also after reopen',BOUND,async t=>{
 const f=await fixture(t),entered=latch(),release=releaseOnExit(t);
 const read=f.manager.credentials.read.bind(f.manager.credentials);let held=false;
 t.mock.method(f.manager.credentials,'read',async(id,o)=>{if(id!==f.active||held)return read(id,o);held=true;entered.resolve();await release.promise;return read(id,o);});
 let host=await f.open();await host.submit('a',REQUEST);await entered.promise;
 const stopped=host.stop();release.resolve();await stopped;
 let work=await statusOf(host);
 assert.equal(work.status,'Stopped');assert.equal(work.request,REQUEST);assert.equal(work.result,null);noSends(f);
 await host.close();host=await f.open();
 work=await statusOf(host);
 assert.equal(work.status,'Stopped');assert.equal(work.request,REQUEST);assert.equal(work.result,null);noSends(f);
});
