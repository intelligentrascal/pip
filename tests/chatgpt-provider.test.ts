import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,stat,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fauxProvider,fauxAssistantMessage,type OAuthCredential} from '@earendil-works/pi-ai';
import {ProviderManager} from '../runtime/providers.js';
import {ask} from './helpers/ask.js';
import {CHATGPT_MODEL,chatGPTPayload} from '../runtime/chatgpt-transport.js';

// Intent: ELF-24/26, the ChatGPT connection uses Pip’s private store and Allow, through pi-ai's own sign-in.
// ELF-56 adds the one conversation and its one backup. These are explicit protocol stand-ins, not live proof.
const ROOT=process.env.PIP_TEST_ROOT??path.join(os.tmpdir(),'pip-unit-fixtures');
const credential:OAuthCredential={type:'oauth',access:'pip-test-oauth-access',refresh:'pip-test-oauth-refresh',expires:Date.now()+3600000,clientId:'oaiapp_pip_fixture',subject:'pip-fixture',idToken:'pip-test-id-token'};
const reply=(text='An editable reply.')=>fauxAssistantMessage(text);
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
const run=(env:Awaited<ReturnType<typeof setup>>,text='Write a warmer reply')=>ask(env.home,text,{engine:env.manager.engine()});

test('ELF-26 ChatGPT login is app-named, host-stable, private, removable and never sends before Allow',async()=>{
 const env=await setup();const {manager,transport,home}=env;const ids:string[]=[];
 useAuth(env,{name:'ChatGPT fixture',login:async(_interaction,options)=>{assert.equal(options?.agentName,'Pip');ids.push(options!.getDeviceId!());return credential;},refresh:async c=>c,toAuth:async c=>({apiKey:c.access})});
 const login=async()=>{const finished=new Promise<void>(yes=>env.onChange(()=>{void manager.view().then(v=>{if(!v.providers.find(p=>p.id==='openai')!.signingIn)yes();});}));await manager.signIn('openai');await finished;};
 await login();await login();assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);
 const settings=JSON.parse(await readFile(path.join(home,'provider-settings.json'),'utf8'));assert.equal(settings.chatGPTHostId,ids[0]);
 await manager.select('openai',CHATGPT_MODEL);transport.setResponses([reply()]);
 const refused=await run(env);assert.match(refused.error,/not allowed yet/);assert.equal(transport.state.callCount,0);
 await manager.allow('openai');
 const captured:string[]=[];transport.setResponses([(context)=>{captured.push(JSON.stringify(context));return reply();}]);
 const work=await run(env);const result=work.result!;assert.equal(result.kind,'answer');assert.match(result.model,/via ChatGPT plan/);
 assert.equal((await stat(path.join(home,'provider-credentials.json'))).mode&0o777,0o600);
 for(const secret of [credential.access,credential.refresh,credential.idToken as string]){
  assert.equal(JSON.stringify(await manager.view()).includes(secret),false);assert.equal(JSON.stringify(work).includes(secret),false);assert.equal(captured.join('').includes(secret),false);
  for(const file of await readdir(home))if(file!=='provider-credentials.json'&&!(await stat(path.join(home,file))).isDirectory())assert.equal((await readFile(path.join(home,file))).includes(secret),false,file);
 }
 await manager.remove('openai');assert.equal(await manager.connected('openai'),false);assert.match((await run(env)).error,/not signed in/);
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

test('ELF-26 ChatGPT unavailable can use the allowed backup, but a failure that is not an outage cannot',async()=>{
 const env=await setup();const {manager,transport}=env;
 useAuth(env,{name:'fixture',login:async()=>credential,refresh:async c=>c,toAuth:async c=>({apiKey:c.access})});
 await manager.credentials.modify('openai',async()=>credential);await manager.allow('openai');await manager.allow('deepseek');await manager.setKey('deepseek','pip-protocol-key');await manager.select('openai',CHATGPT_MODEL);await manager.setBackup('deepseek');
 const backup=fauxProvider({provider:'deepseek',api:'backup-fixture',models:[{id:'deepseek-v4-pro'}]});manager.models.setProvider(backup.provider);backup.setResponses([reply('Backup reply.')]);
 transport.setResponses([fauxAssistantMessage('',{stopReason:'error',errorMessage:'subscription_sharing_usage_limit_exceeded'})]);
 assert.equal((await run(env)).result?.backup?.provider,'DeepSeek');const before=backup.state.callCount;
 transport.setResponses([fauxAssistantMessage('Incomplete.',{stopReason:'length'})]);
 const partial=await run(env);assert.equal(partial.status,'Could not finish');assert.equal(backup.state.callCount,before);
});

// Intent: ELF-39, two requests refreshing one expiring token must keep the saved ChatGPT connection.
// Refresh is now pi-ai's own; Pip's file store must still serialize and keep the rotated credential.
test('ELF-39 two requests racing one token refresh keep the saved ChatGPT connection',{timeout:5000},async()=>{
 const env=await setup();const {manager}=env;let refreshes=0;
 const expiring:OAuthCredential={...credential,access:'pip-race-expiring-access',refresh:'pip-race-old-refresh',expires:Date.now()+60000};
 const rotated:OAuthCredential={...expiring,access:'pip-race-rotated-access',refresh:'pip-race-rotated-refresh',expires:Date.now()+3600000};
 useAuth(env,{name:'ChatGPT rotation fixture',login:async()=>{throw Error('ELF-39 must never start login');},
  refresh:async current=>{refreshes++;assert.equal(current.refresh,'pip-race-old-refresh');await new Promise(r=>setTimeout(r,20));return rotated;},toAuth:async c=>({apiKey:c.access})});
 await manager.credentials.modify('openai',async()=>expiring);
 const [a,b]=await Promise.all([manager.models.getAuth('openai'),manager.models.getAuth('openai')]);
 assert.equal(refreshes,1);assert.ok(a&&b);
 assert.deepEqual(await manager.credentials.read('openai'),rotated);assert.equal(await manager.connected('openai'),true);
});

test('ELF-26 preview payload keeps function tools namespaced and uses private streaming Responses without unsupported fields',()=>{
 const payload=chatGPTPayload({model:CHATGPT_MODEL,input:[{role:'system',content:'Pip instructions'},{role:'user',content:'Write a reply'}],tools:[{type:'function',name:'read_public_url',parameters:{type:'object'}}],max_output_tokens:400,previous_response_id:'old',temperature:0.5,metadata:{secret:'no'},prompt_cache_retention:'24h',store:true,stream:false});
 assert.deepEqual(payload,{model:CHATGPT_MODEL,input:[{role:'developer',content:'Pip instructions'},{role:'user',content:'Write a reply'}],tools:[{type:'namespace',name:'pip',description:'Pip’s app-owned tools.',tools:[{type:'function',name:'read_public_url',parameters:{type:'object'}}]}],store:false,stream:true});
});
