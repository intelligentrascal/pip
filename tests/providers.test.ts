import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, stat, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { ProviderManager, classifyFailure } from '../runtime/providers.js';
import { openHost } from '../runtime/pi-durable-adapter.js';
import { screenFixture } from './helpers/screen-context.js';
import { ask, testHome, until, finished } from './helpers/ask.js';

// A stand-in key shaped like a real one; nothing here reaches a network.
const KEY='sk-pip-test-'+'a1b2c3d4e5f6a7b8c9d0e1f2';
const say=(text='Done.')=>fauxAssistantMessage(text);
const fail=(message:string)=>fauxAssistantMessage('',{stopReason:'error',errorMessage:message});

async function setup(){
 const h=await testHome('pip-prov-');
 const models=createModels();
 const or=fauxProvider({provider:'openrouter',api:'faux-or',models:[{id:'anthropic/claude-sonnet-5.5',input:['text','image']},{id:'deepseek/deepseek-v4-pro',input:['text']}]});
 const ds=fauxProvider({provider:'deepseek',api:'faux-ds',models:[{id:'deepseek-v4-pro',input:['text']}]});
 models.setProvider(or.provider);models.setProvider(ds.provider);
 const manager=new ProviderManager({home:h,models});
 await manager.credentials.modify('openrouter',async()=>({type:'oauth',access:'or-test-token-9f8e7d6c5b4a',refresh:'',expires:0}) as never);
 return {h,manager,or,ds};
}
/** One ask through the real host and the manager's own engine; it ends Done or with the host's committed failure. */
const run=(f:{h:string;manager:ProviderManager},request='Plan my day',options={})=>ask(f.h,request,{engine:f.manager.engine(),...options});

// Intent: ELF-24 Allow gates every send, and ELF-56 spec item 7 asks it again because the whole thread is now sent.
test('ELF-24 Allow gates every send: nothing reaches a provider before Allow',async()=>{
 const f=await setup();const {manager,or}=f;await manager.settings.update(s=>{s.active='openrouter';});
 or.setResponses([say()]);
 const w=await run(f);assert.equal(w.status,'Could not finish');assert.match(w.error,/not allowed yet/);
 assert.equal(or.state.callCount,0);
 await manager.allow('openrouter');
 const r=await run(f);assert.equal(r.result?.text,'Done.');assert.match(r.result!.model,/via OpenRouter/);assert.equal(or.state.callCount,1);
 await manager.withdraw('openrouter');assert.match((await run(f)).error,/not allowed yet/);
 assert.equal(or.state.callCount,1);
});

test('ELF-56 consent given before the whole thread was sent is asked again',async()=>{
 const f=await setup();await f.manager.settings.update(s=>{s.active='openrouter';s.allowed.openrouter={terms:1,at:new Date().toISOString()};});
 const w=await run(f);assert.match(w.error,/not allowed yet/);assert.equal(f.or.state.callCount,0);
 assert.equal((await f.manager.view()).providers.find(p=>p.id==='openrouter')!.allowed,false);
});

test('ELF-24 a key never reaches saved state, the window snapshot, model input or logs, and Remove deletes it',async()=>{
 const f=await setup();const {h,manager,ds}=f;
 await manager.setKey('deepseek',KEY);
 const file=path.join(h,'provider-credentials.json');
 assert.equal((await stat(file)).mode&0o777,0o600);
 await manager.allow('deepseek');await manager.select('deepseek','deepseek-v4-pro');
 const seen:string[]=[];
 ds.setResponses([(ctx)=>{seen.push(JSON.stringify(ctx));return say('Hello');}]);
 const logs:string[]=[];const orig=[console.log,console.error,console.warn];
 console.log=console.error=console.warn=(...a:unknown[])=>logs.push(a.join(' '));
 let work;try{work=await run(f,'Say hello');}finally{console.log=orig[0];console.error=orig[1];console.warn=orig[2];}
 assert.equal(work.status,'Done');
 assert.equal(seen.join('').includes(KEY),false);
 assert.equal(JSON.stringify(work).includes(KEY),false);
 assert.equal(JSON.stringify(await manager.view()).includes(KEY),false);
 assert.equal((await readFile(path.join(h,'provider-settings.json'),'utf8')).includes(KEY),false);
 assert.equal(logs.join('\n').includes(KEY),false);
 for(const entry of await readdir(h))if(entry!=='provider-credentials.json'&&!(await stat(path.join(h,entry))).isDirectory())assert.equal((await readFile(path.join(h,entry))).includes(KEY),false,entry);
 await manager.remove('deepseek');
 assert.equal((await readFile(file,'utf8')).includes(KEY),false);
 assert.equal((await manager.view()).providers.find(p=>p.id==='deepseek')!.connected,false);
 assert.match((await run(f)).error,/not signed in/);
});

test('ELF-24 environment keys are ignored so a shell variable cannot send data without Allow',async()=>{
 const h=await testHome();const m=new ProviderManager({home:h});
 process.env.DEEPSEEK_API_KEY=KEY;
 try{assert.equal((await m.view()).providers.find(p=>p.id==='deepseek')!.connected,false);
  assert.equal(await m.models.getAuth('deepseek'),undefined);}finally{delete process.env.DEEPSEEK_API_KEY;}
});

test('ELF-24 backup answers only when the active provider cannot answer at all, and says so',async()=>{
 const f=await setup();const {manager,or,ds}=f;
 await manager.setKey('deepseek',KEY);
 await manager.allow('openrouter');await manager.allow('deepseek');
 await manager.settings.update(s=>{s.active='openrouter';});
 await assert.rejects(manager.setBackup('openrouter'),/differ/);
 await manager.setBackup('deepseek');
 or.setResponses([fail('402 Insufficient credits')]);
 ds.setResponses([say('From backup')]);
 const r=(await run(f)).result!;
 assert.equal(r.text,'From backup');
 assert.deepEqual(r.backup,{provider:'DeepSeek',replaced:'OpenRouter',reason:'OpenRouter: out of credit'});
 // Both fail: the request is kept, the real reasons are shown, no third provider is tried.
 or.setResponses([fail('503 upstream')]);
 ds.setResponses([fail('401 invalid api key '+KEY)]);
 const both=await run(f);
 assert.equal(both.status,'Could not finish');
 assert.match(both.error,/OpenRouter: the service is down.*Backup DeepSeek also could not answer: DeepSeek: the key was rejected/);
 assert.equal(both.error.includes(KEY),false);
 // A failure that is not "cannot answer at all" never reaches the backup.
 or.setResponses([fail('something odd')]);
 ds.setResponses([say('should not run')]);
 const before=ds.state.callCount;
 assert.equal((await run(f)).status,'Could not finish');assert.equal(ds.state.callCount,before);
});

test('ELF-56 a text-only model refuses a window image instead of dropping it silently',async()=>{
 const f=await setup();const {manager,or}=f;
 await manager.allow('openrouter');await manager.settings.update(s=>{s.active='openrouter';s.models.openrouter='deepseek/deepseek-v4-pro';});
 or.setResponses([say()]);
 const withScreen=async(mode:'image'|'text')=>{
  const host=await openHost({home:f.h,fixture:true,engine:manager.engine()});
  try{const ref=await host.attachScreenContext(await screenFixture(mode));const id='w-'+mode+or.state.callCount+Math.random();await host.submit(id,'Review this window',undefined,ref);return (await until(host,finished(id))).works.find(w=>w.id===id)!;}finally{await host.close();}
 };
 const refused=await withScreen('image');assert.equal(refused.status,'Could not finish');assert.match(refused.error,/cannot read window images/);assert.equal(or.state.callCount,0);
 assert.equal((await withScreen('text')).result?.text,'Done.');
 await manager.settings.update(s=>{s.models.openrouter='anthropic/claude-sonnet-5.5';});
 or.setResponses([(ctx)=>{assert.match(JSON.stringify(ctx),/"type":"image"/);return say('saw it');}]);
 assert.equal((await withScreen('image')).result?.text,'saw it');
});

test('ELF-24 failure wording is fixed text, never provider output',()=>{
 for(const raw of ['HTTP 402 payment required','fetch failed ECONNRESET','401 Unauthorized','weird '+KEY])assert.equal(classifyFailure(raw).reason.includes(KEY),false);
 assert.equal(classifyFailure('weird').unavailable,false);
});

// Intent: ELF-56 one engine retries a busy service itself; only a service that stays down reaches the backup.
test('ELF-56 a busy service is retried on the same model before the backup is considered',async()=>{
 const f=await setup();const {manager,or,ds}=f;
 await manager.setKey('deepseek',KEY);await manager.allow('openrouter');await manager.allow('deepseek');
 await manager.settings.update(s=>{s.active='openrouter';s.backup='deepseek';});
 or.setResponses([fail('503 upstream busy'),say('Second try worked')]);ds.setResponses([say('should not run')]);
 const w=await run(f,'Plan my day',{retry:{maxRetries:1,baseDelayMs:1}});
 assert.equal(w.result?.text,'Second try worked');assert.equal(w.result?.backup,undefined);
 assert.equal(or.state.callCount,2);assert.equal(ds.state.callCount,0);
});
