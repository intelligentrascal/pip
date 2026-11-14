import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,stat,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fauxProvider,fauxAssistantMessage,fauxToolCall,type OAuthCredential} from '@earendil-works/pi-ai';
import {ProviderManager} from '../runtime/providers.js';
import {CHATGPT_MODEL,chatGPTPayload} from '../runtime/chatgpt-auth.js';

// Intent: ELF-24/26, the ChatGPT connection uses Pip’s private store, Allow,
// existing tools and one backup. These are explicit protocol stand-ins, not live proof.
const ROOT=process.env.PIP_TEST_ROOT??path.join(os.tmpdir(),'pip-unit-fixtures');
const credential:OAuthCredential={type:'oauth',access:'pip-test-oauth-access',refresh:'pip-test-oauth-refresh',expires:Date.now()+3600000,clientId:'oaiapp_pip_fixture',subject:'pip-fixture',idToken:'pip-test-id-token'};
const reply=(text='An editable reply.')=>fauxAssistantMessage([fauxToolCall('answer',{kind:'draft',title:'Reply',text})]);
async function setup(){
 await mkdir(ROOT,{recursive:true});const home=await mkdtemp(path.join(ROOT,'pip-chatgpt-'));await writeFile(path.join(home,'.pip-test-home'),'pip-test-only');
 let changed:()=>void=()=>{};
 const manager=new ProviderManager({home,notify:e=>{if(e.type==='changed')changed();}});
 const transport=fauxProvider({provider:'openai',api:'pip-chatgpt-fixture',models:[{id:CHATGPT_MODEL,input:['text','image']}]});
 return {home,manager,transport,onChange:(fn:()=>void)=>{changed=fn;}};
}
function useAuth(env:Awaited<ReturnType<typeof setup>>,login:NonNullable<ReturnType<typeof env.manager.models.getProvider>>['auth']['oauth']){
 env.manager.models.setProvider({...env.transport.provider,auth:{oauth:login}});
}
const run=(m:ProviderManager)=>m.provider()('Write a warmer reply',[],new AbortController().signal,{sessionId:'chatgpt-test'});

test('ELF-26 ChatGPT login is app-named, host-stable, private, removable and never sends before Allow',async()=>{
 const env=await setup();const {manager,transport,home}=env;const ids:string[]=[];
 useAuth(env,{name:'ChatGPT fixture',login:async(_interaction,options)=>{assert.equal(options?.agentName,'Pip');ids.push(options!.getDeviceId!());return credential;},refresh:async c=>c,toAuth:async c=>({apiKey:c.access})});
 const login=async()=>{const finished=new Promise<void>(yes=>env.onChange(()=>{void manager.view().then(v=>{if(!v.providers.find(p=>p.id==='openai')!.signingIn)yes();});}));await manager.signIn('openai');await finished;};
 await login();await login();assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);
 const settings=JSON.parse(await readFile(path.join(home,'provider-settings.json'),'utf8'));assert.equal(settings.chatGPTHostId,ids[0]);
 await manager.select('openai',CHATGPT_MODEL);transport.setResponses([reply()]);
 await assert.rejects(run(manager),/not allowed yet/);assert.equal(transport.state.callCount,0);
 await manager.allow('openai');
 const captured:string[]=[];transport.setResponses([(context)=>{captured.push(JSON.stringify(context));return reply();}]);
 const result=await run(manager);assert.equal(result.kind,'draft');assert.match(result.model,/via ChatGPT plan/);
 assert.match(captured[0],/read_public_url/);assert.match(captured[0],/answer/);
 assert.equal((await stat(path.join(home,'provider-credentials.json'))).mode&0o777,0o600);
 for(const secret of [credential.access,credential.refresh,credential.idToken as string]){
  assert.equal(JSON.stringify(await manager.view()).includes(secret),false);assert.equal(JSON.stringify(result).includes(secret),false);assert.equal(captured.join('').includes(secret),false);
  for(const file of await readdir(home))if(file!=='provider-credentials.json')assert.equal((await readFile(path.join(home,file),'utf8')).includes(secret),false);
 }
 await manager.remove('openai');assert.equal(await manager.connected('openai'),false);await assert.rejects(run(manager),/not signed in/);
 const next=new ProviderManager({home});assert.equal((await next.settings.read()).chatGPTHostId,ids[0]);
});

test('ELF-26 cancelling a reconnect preserves the saved account; Remove waits for login cancellation then deletes it',async()=>{
 const env=await setup();const {manager}=env;await manager.credentials.modify('openai',async()=>credential);
 let entered!:()=>void;let ready=new Promise<void>(yes=>{entered=yes;});
 useAuth(env,{name:'ChatGPT pending fixture',login:async interaction=>{entered();return new Promise((_yes,no)=>interaction.signal.addEventListener('abort',()=>no(Error('Cancelled')),{once:true}));},refresh:async c=>c,toAuth:async c=>({apiKey:c.access})});
 await manager.signIn('openai');await ready;assert.equal((await manager.view()).providers.find(p=>p.id==='openai')!.signingIn,true);
 await manager.cancelSignIn('openai');assert.equal(await manager.connected('openai'),true);
 ready=new Promise<void>(yes=>{entered=yes;});await manager.signIn('openai');await ready;
 await manager.remove('openai');assert.equal(await manager.connected('openai'),false);
 assert.equal((await manager.view()).providers.find(p=>p.id==='openai')!.signingIn,false);
});

test('ELF-26 ChatGPT unavailable can use the allowed backup, but a partial answer or later tool turn cannot',async()=>{
 const env=await setup();const {manager,transport}=env;
 useAuth(env,{name:'fixture',login:async()=>credential,refresh:async c=>c,toAuth:async c=>({apiKey:c.access})});
 await manager.credentials.modify('openai',async()=>credential);await manager.allow('openai');await manager.allow('deepseek');await manager.setKey('deepseek','pip-protocol-key');await manager.select('openai',CHATGPT_MODEL);await manager.setBackup('deepseek');
 const backup=fauxProvider({provider:'deepseek',api:'backup-fixture',models:[{id:'deepseek-v4-pro'}]});manager.models.setProvider(backup.provider);backup.setResponses([reply('Backup reply.')]);
 transport.setResponses([fauxAssistantMessage('',{stopReason:'error',errorMessage:'subscription_sharing_usage_limit_exceeded'})]);
 assert.equal((await run(manager)).backup?.provider,'DeepSeek');const before=backup.state.callCount;
 transport.setResponses([fauxAssistantMessage([fauxToolCall('answer',{kind:'draft',title:'Partial',text:'Incomplete.'})],{stopReason:'length'})]);await assert.rejects(run(manager),/stopped before completing/);assert.equal(backup.state.callCount,before);
 transport.setResponses([fauxAssistantMessage('Partial text',{stopReason:'error',errorMessage:'503 unavailable'})]);await assert.rejects(run(manager),/down or unreachable/);assert.equal(backup.state.callCount,before);
 transport.setResponses([fauxAssistantMessage([fauxToolCall('unknown_tool',{})]),fauxAssistantMessage('',{stopReason:'error',errorMessage:'503 unavailable'})]);await assert.rejects(run(manager),/down or unreachable/);assert.equal(backup.state.callCount,before);
});

// Intent: ELF-39, the pinned engine's queued refresh returns undefined when another
// request already refreshed; Pip's file store must keep and return that credential.
test('ELF-39 two requests racing one token refresh keep the saved ChatGPT connection without the backup',{timeout:5000},async t=>{
 const env=await setup();const {manager,transport}=env;let refreshes=0;
 const expiring:OAuthCredential={...credential,access:'pip-race-expiring-access',refresh:'pip-race-old-refresh',expires:Date.now()+60000};
 const rotated:OAuthCredential={...expiring,access:'pip-race-rotated-access',refresh:'pip-race-rotated-refresh',expires:Date.now()+3600000};
 useAuth(env,{name:'ChatGPT rotation fixture',login:async()=>{throw Error('ELF-39 must never start login');},
  refresh:async current=>{refreshes++;assert.deepEqual(current,expiring);return rotated;},toAuth:async c=>({apiKey:c.access})});
 await manager.credentials.modify('openai',async()=>expiring);await manager.allow('openai');await manager.allow('deepseek');await manager.setKey('deepseek','pip-protocol-key');await manager.select('openai',CHATGPT_MODEL);await manager.setBackup('deepseek');
 const backup=fauxProvider({provider:'deepseek',api:'backup-fixture',models:[{id:'deepseek-v4-pro'}]});manager.models.setProvider(backup.provider);backup.setResponses([reply('Backup reply.'),reply('Backup reply.')]);
 // Latches own the order: the first refresh enters the store only after the second
 // request has read the expiring credential and queued its own refresh behind it.
 const modify=manager.credentials.modify.bind(manager.credentials);let calls=0;
 let secondQueued!:()=>void,firstEntered!:()=>void;
 const second=new Promise<void>(yes=>{secondQueued=yes;}),first=new Promise<void>(yes=>{firstEntered=yes;});
 t.mock.method(manager.credentials,'modify',async(id:string,fn:Parameters<typeof modify>[1],o?:Parameters<typeof modify>[2])=>{
  const call=++calls;
  if(call===1){await second;const pending=modify(id,fn,o);firstEntered();return pending;}
  if(call===2){secondQueued();await first;}
  return modify(id,fn,o);
 });
 transport.setResponses([reply('First reply.'),reply('Second reply.')]);
 const results=await Promise.allSettled([run(manager),run(manager)]);
 t.diagnostic(JSON.stringify({intent:'ELF-39',results:results.map(r=>r.status==='fulfilled'?{model:r.value.model,backup:r.value.backup?.provider??null,text:r.value.text}:{rejected:String(r.reason)}),
  refreshes,storeWrites:calls,chatGPTSends:transport.state.callCount,backupSends:backup.state.callCount,connected:await manager.connected('openai'),saved:(await manager.credentials.list()).map(c=>c.providerId)}));
 assert.deepEqual(results.map(r=>r.status==='fulfilled'?r.value.text:String(r.reason)).sort(),['First reply.','Second reply.']);
 for(const r of results)if(r.status==='fulfilled'){assert.match(r.value.model,/via ChatGPT plan/);assert.equal(r.value.backup,undefined);}
 assert.equal(calls,2);assert.equal(refreshes,1);assert.equal(backup.state.callCount,0);
 assert.deepEqual(await manager.credentials.read('openai'),rotated);assert.equal(await manager.connected('openai'),true);
 assert.deepEqual((await manager.credentials.list()).map(c=>c.providerId).sort(),['deepseek','openai']);
});

test('ELF-26 preview payload keeps function tools namespaced and uses private streaming Responses without unsupported fields',()=>{
 const payload=chatGPTPayload({model:CHATGPT_MODEL,input:[{role:'system',content:'Pip instructions'},{role:'user',content:'Write a reply'}],tools:[{type:'function',name:'answer',parameters:{type:'object'}}],max_output_tokens:400,previous_response_id:'old',temperature:0.5,metadata:{secret:'no'},prompt_cache_retention:'24h',store:true,stream:false});
 assert.deepEqual(payload,{model:CHATGPT_MODEL,input:[{role:'developer',content:'Pip instructions'},{role:'user',content:'Write a reply'}],tools:[{type:'namespace',name:'pip',description:'Pip’s app-owned research and answer tools.',tools:[{type:'function',name:'answer',parameters:{type:'object'}}]}],store:false,stream:true});
});
