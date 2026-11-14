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

const base=process.env.PIP_TEST_ROOT??path.join(os.tmpdir(),'pip-unit-fixtures');
async function home(){await mkdir(base,{recursive:true});const h=await mkdtemp(path.join(base,'pip-prov-'));await writeFile(path.join(h,'.pip-test-home'),'pip-test-only');return h;}
// A stand-in key shaped like a real one; nothing here reaches a network.
const KEY='sk-pip-test-'+'a1b2c3d4e5f6a7b8c9d0e1f2';
const answer=(text='Done.')=>fauxAssistantMessage([fauxToolCall('answer',{kind:'answer',title:'Reply',text})]);

async function setup(opts:{claude?:()=>never}={}){
 const h=await home();
 const models=createModels();
 const or=fauxProvider({provider:'openrouter',api:'faux-or',models:[{id:'anthropic/claude-sonnet-5.5',input:['text','image']},{id:'deepseek/deepseek-v4-pro',input:['text']}]});
 const ds=fauxProvider({provider:'deepseek',api:'faux-ds',models:[{id:'deepseek-v4-pro',input:['text']}]});
 models.setProvider(or.provider);models.setProvider(ds.provider);
 const manager=new ProviderManager({home:h,models,claude:()=>(opts.claude??(async()=>{throw new Error('claude must not run');})) as never});
 await manager.credentials.modify('openrouter',async()=>({type:'oauth',access:'or-test-token-9f8e7d6c5b4a',refresh:'',expires:0}) as never);
 return {h,manager,or,ds};
}
const run=(m:ProviderManager)=>m.provider()('Plan my day',[],new AbortController().signal,{sessionId:'s1'});

test('ELF-24 Allow gates every send: nothing reaches a provider before Allow',async()=>{
 const {manager,or}=await setup(); await manager.settings.update(s=>{s.active='openrouter';});
 or.setResponses([answer()]);
 await assert.rejects(run(manager),/not allowed yet/);
 assert.equal(or.state.callCount,0);
 await manager.allow('openrouter');
 const r=await run(manager);assert.equal(r.text,'Done.');assert.match(r.model,/via OpenRouter/);assert.equal(or.state.callCount,1);
 await manager.withdraw('openrouter');await assert.rejects(run(manager),/not allowed yet/);
});

test('ELF-24 a key never reaches saved state, the window snapshot, model input or logs, and Remove deletes it',async()=>{
 const {h,manager,ds}=await setup();
 await manager.setKey('deepseek',KEY);
 const file=path.join(h,'provider-credentials.json');
 assert.equal((await stat(file)).mode&0o777,0o600);
 await manager.allow('deepseek');await manager.select('deepseek','deepseek-v4-pro');
 const seen:string[]=[];
 ds.setResponses([(ctx,opts)=>{seen.push(JSON.stringify(ctx));return answer('Hello');}]);
 const logs:string[]=[];const orig=[console.log,console.error,console.warn];
 console.log=console.error=console.warn=(...a:unknown[])=>logs.push(a.join(' '));
 let host;try{
  host=await openHost({home:h,fixture:true,provider:manager.provider()});
  await host.submit('w1','Say hello');
  const deadline=Date.now()+5000;let snap=await host.snapshot();while(Date.now()<deadline&&snap.works[0]?.status!=='Done'){await new Promise(r=>setTimeout(r,20));snap=await host.snapshot();}
  assert.equal(snap.works[0].status,'Done');
  assert.equal(JSON.stringify(snap).includes(KEY),false);
 }finally{console.log=orig[0];console.error=orig[1];console.warn=orig[2];await host?.close();}
 assert.equal(JSON.stringify(await manager.view()).includes(KEY),false);
 assert.equal((await readFile(path.join(h,'provider-settings.json'),'utf8')).includes(KEY),false);
 assert.equal(seen.length>0&&seen.every(s=>!s.includes(KEY)),true);
 assert.equal(logs.join('\n').includes(KEY),false);
 for(const f of await readdir(h))if(f!=='provider-credentials.json'&&!(await stat(path.join(h,f))).isDirectory())assert.equal((await readFile(path.join(h,f))).includes(KEY),false,f);
 await manager.remove('deepseek');
 assert.equal((await readFile(file,'utf8')).includes(KEY),false);
 assert.equal((await manager.view()).providers.find(p=>p.id==='deepseek')!.connected,false);
 await assert.rejects(run(manager),/not signed in/);
});

test('ELF-24 environment keys are ignored so a shell variable cannot send data without Allow',async()=>{
 const h=await home();const m=new ProviderManager({home:h});
 process.env.DEEPSEEK_API_KEY=KEY;
 try{assert.equal((await m.view()).providers.find(p=>p.id==='deepseek')!.connected,false);
  assert.equal(await m.models.getAuth('deepseek'),undefined);}finally{delete process.env.DEEPSEEK_API_KEY;}
});

test('ELF-24 backup answers only when the active provider cannot answer at all, and says so',async()=>{
 const {manager,or,ds}=await setup();
 await manager.setKey('deepseek',KEY);
 await manager.allow('openrouter');await manager.allow('deepseek');
 await manager.settings.update(s=>{s.active='openrouter';});
 await assert.rejects(manager.setBackup('openrouter'),/differ/);
 await manager.setBackup('deepseek');
 or.setResponses([fauxAssistantMessage('',{stopReason:'error',errorMessage:'402 Insufficient credits'})]);
 ds.setResponses([answer('From backup')]);
 const r=await run(manager);
 assert.equal(r.text,'From backup');
 assert.deepEqual(r.backup,{provider:'DeepSeek',replaced:'OpenRouter',reason:'OpenRouter: out of credit'});
 // Both fail: the request is kept, the real reasons are shown, no third provider is tried.
 or.setResponses([fauxAssistantMessage('',{stopReason:'error',errorMessage:'503 upstream'})]);
 ds.setResponses([fauxAssistantMessage('',{stopReason:'error',errorMessage:'401 invalid api key '+KEY})]);
 const err=await run(manager).catch(e=>e as Error);
 assert.match(err.message,/OpenRouter: the service is down.*Backup DeepSeek also could not answer: DeepSeek: the key was rejected/);
 assert.equal(err.message.includes(KEY),false);
 // A partial stop is never restarted on the backup.
 or.setResponses([fauxAssistantMessage('',{stopReason:'error',errorMessage:'something odd'})]);
 ds.setResponses([answer('should not run')]);
 const before=ds.state.callCount;
 await assert.rejects(run(manager),/could not finish/);assert.equal(ds.state.callCount,before);
});

test('ELF-24 the eight-turn stop is a cutoff for Continue, not a reason to use the backup',async()=>{
 const {h,manager,or,ds}=await setup();
 await manager.setKey('deepseek',KEY);await manager.allow('openrouter');await manager.allow('deepseek');
 await manager.settings.update(s=>{s.active='openrouter';s.backup='deepseek';});
 or.setResponses(Array.from({length:8},(_,i)=>fauxAssistantMessage([fauxToolCall('no_such_tool',{n:i})])));
 ds.setResponses([answer('no')]);
 const err=await run(manager).catch(e=>e as Error&{code:string});
 assert.equal((err as {code:string}).code,'provider-cutoff');assert.equal(ds.state.callCount,0);
 void h;
});

test('ELF-24 a text-only model refuses a window image instead of dropping it silently',async()=>{
 const {manager,or}=await setup();
 await manager.allow('openrouter');await manager.settings.update(s=>{s.active='openrouter';s.models.openrouter='deepseek/deepseek-v4-pro';});
 or.setResponses([answer()]);
 const call=(mode:'image'|'text')=>screenFixture(mode).then(screen=>manager.provider()('Review this window',[],new AbortController().signal,{sessionId:'s',screen}));
 await assert.rejects(call('image'),/cannot read window images/);assert.equal(or.state.callCount,0);
 assert.equal((await call('text')).text,'Done.');
 await manager.settings.update(s=>{s.models.openrouter='anthropic/claude-sonnet-5.5';});
 or.setResponses([(ctx)=>{assert.match(JSON.stringify(ctx),/"type":"image"/);return answer('saw it');}]);
 assert.equal((await call('image')).text,'saw it');
});

test('ELF-24 failure wording is fixed text, never provider output',()=>{
 for(const raw of ['HTTP 402 payment required','fetch failed ECONNRESET','401 Unauthorized','weird '+KEY])assert.equal(classifyFailure(raw).reason.includes(KEY),false);
 assert.equal(classifyFailure('weird').unavailable,false);
});
