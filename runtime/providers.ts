import path from 'node:path';
import { createModels, type MutableModels, type AuthInteraction, type AuthEvent } from '@earendil-works/pi-ai';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { chatGPTProvider, CHATGPT_MODEL } from './chatgpt-transport.js';
import { randomUUID } from 'node:crypto';
import { FileCredentialStore, SettingsStore, type ProviderSettings } from './provider-store.js';

export class ProviderError extends Error {
 /** Safe text: it never contains a key, a request body or a provider payload. */
 constructor(message:string,readonly code:string,readonly unavailable=false,readonly provider?:string){super(message);}
 get safe(){return true;}
}

export type ProviderId='openrouter'|'deepseek'|'openai';
type Descriptor={id:ProviderId;name:string;connect:'sign-in-page'|'secure-field';models:{id:string;label:string}[];defaultModel:string;goes:string;bills:string;extra?:string};
/** Bump `terms` whenever what Pip sends, where it goes or who bills changes: Allow is asked again. */
const TERMS=2;
const sends=['Your request and the whole conversation so far: your earlier messages, Pip’s answers and what its tools returned.','Approved remembered facts.','A project summary or window snapshot only when you chose to share it for that request.','Text of public pages Pip read for the task.'];
export const catalog:Descriptor[]=[
 {id:'openrouter',name:'OpenRouter',connect:'sign-in-page',models:[
  {id:'anthropic/claude-sonnet-5.5',label:'Claude Sonnet 5.5 (balanced)'},{id:'deepseek/deepseek-v4-pro',label:'DeepSeek V4 Pro (lower price, text only)'},{id:'google/gemini-3-flash-preview',label:'Gemini 3 Flash (fast)'}],defaultModel:'anthropic/claude-sonnet-5.5',
  goes:'OpenRouter, which routes to the model’s host under your OpenRouter account settings. Pip sends no data-collection or zero-retention preference, so your account settings decide.',bills:'Your OpenRouter credit.'},
 {id:'deepseek',name:'DeepSeek',connect:'secure-field',models:[{id:'deepseek-v4-pro',label:'DeepSeek V4 Pro (text only)'},{id:'deepseek-flash',label:'DeepSeek Flash (reads images)'}],defaultModel:'deepseek-v4-pro',
  goes:'DeepSeek’s own servers. DeepSeek’s policy says these are in China.',bills:'Your DeepSeek balance, with your own key.'},
 {id:'openai',name:'ChatGPT plan',connect:'sign-in-page',models:[{id:CHATGPT_MODEL,label:'GPT-6.1 Sol (balanced)'}],defaultModel:CHATGPT_MODEL,
  goes:'OpenAI’s Responses API, through Sign in with ChatGPT for this locally hosted Pip app. Your account and workspace must permit the preview. Pip does not read your ChatGPT conversations.',bills:'Your ChatGPT plan’s allowance and the limits you approve on OpenAI’s sign-in page. This is not API-key billing.'}
];
const desc=(id:string)=>catalog.find(d=>d.id===id);

export type ProviderStatus={id:ProviderId;name:string;connect:Descriptor['connect'];connected:boolean;allowed:boolean;active:boolean;backup:boolean;model:string;models:Descriptor['models'];disclosure:{sends:string[];goes:string;bills:string};signingIn:boolean;message:string};
export type ModelChoice={provider:string;modelId:string;providerName:string;label:string;images:boolean};
export type Engine={models:MutableModels;choose:(which?:'active'|'backup')=>Promise<ModelChoice|undefined>};
export type ProvidersView={providers:ProviderStatus[];active:string;backup:string|null};

/** Why an answer could not be given at all. Fixed wording only; provider text is never passed through. */
export function classifyFailure(raw:string):{reason:string;unavailable:boolean}{
 if(/\b40[13]\b|unauthori[sz]ed|forbidden|invalid.{0,20}(api )?key|invalid_grant|token.{0,12}(expired|revoked)|authentication|rejected/i.test(raw))return {reason:'the key was rejected',unavailable:true};
 if(/\b402\b|credit|insufficient|quota|billing|balance|payment|subscription_sharing_usage_(limit_exceeded|unavailable)/i.test(raw))return {reason:'out of credit',unavailable:true};
 if(/\b5\d\d\b|fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN|timed? ?out|overloaded|unavailable/i.test(raw))return {reason:'the service is down or unreachable',unavailable:true};
 return {reason:'it could not finish',unavailable:false};
}

export function providerFailure(id:string,raw:string){
 const failure=classifyFailure(raw);
 if(id==='openai')failure.reason=failure.reason.replace('the key was rejected','the sign-in was rejected').replace('out of credit','the ChatGPT plan allowance is unavailable');
 return failure;
}

type Deps={home:string;models?:MutableModels;notify?:(event:{type:'openAuth';url:string}|{type:'changed'})=>void};

export class ProviderManager {
 readonly credentials:FileCredentialStore; readonly settings:SettingsStore; readonly models:MutableModels;
 private signingIn=new Map<string,AbortController>(); private loginJobs=new Map<string,Promise<void>>(); private messages=new Map<string,string>();
 constructor(private deps:Deps){
  this.credentials=new FileCredentialStore(path.join(deps.home,'provider-credentials.json'));
  this.settings=new SettingsStore(path.join(deps.home,'provider-settings.json'));
  // No environment fallback: a key in the shell must never send data without Pip's Allow.
  this.models=deps.models??createModels({credentials:this.credentials,authContext:{env:async()=>undefined,fileExists:async()=>false}});
  if(!deps.models){
   this.models.setProvider(openrouterProvider());this.models.setProvider(deepseekProvider());
   this.models.setProvider(chatGPTProvider());
  }
 }
 private changed(){this.deps.notify?.({type:'changed'});}
 private allowedIn(s:ProviderSettings,id:string){return s.allowed[id]?.terms===TERMS;}
 async connected(id:string){return !!(await this.credentials.read(id));}
 async view():Promise<ProvidersView>{
  const s=await this.settings.read();
  const providers:ProviderStatus[]=[];
  for(const d of catalog)providers.push({id:d.id,name:d.name,connect:d.connect,connected:await this.connected(d.id),allowed:this.allowedIn(s,d.id),active:s.active===d.id,backup:s.backup===d.id,model:s.models[d.id]??d.defaultModel,models:d.models,disclosure:{sends,goes:d.goes,bills:d.bills},signingIn:this.signingIn.has(d.id),message:this.messages.get(d.id)??''});
  return {providers,active:s.active,backup:s.backup};
 }
 async allow(id:string){if(!desc(id))throw new Error('Unknown provider.');await this.settings.update(s=>{s.allowed[id]={terms:TERMS,at:new Date().toISOString()};});this.changed();}
 async withdraw(id:string){await this.settings.update(s=>{delete s.allowed[id];if(s.backup===id)s.backup=null;});this.changed();}
 async select(id:string,model?:string){
  const d=desc(id);if(!d)throw new Error('Unknown provider.');
  if(model!==undefined&&!d.models.some(m=>m.id===model))throw new Error('That model is not on the checked list.');
  await this.settings.update(s=>{s.active=id;if(model)s.models[id]=model;if(s.backup===id)s.backup=null;});this.changed();
 }
 async setBackup(id:string|null){
  await this.settings.update(s=>{
   if(id===null){s.backup=null;return;}
   if(!desc(id))throw new Error('Unknown provider.');
   if(id===s.active)throw new Error('The backup must differ from the active provider.');
   if(!this.allowedIn(s,id))throw new Error('Allow this provider before naming it as the backup.');
   s.backup=id;
  });this.changed();
 }
 async setKey(id:string,key:string){
  if(desc(id)?.connect!=='secure-field')throw new Error('This provider does not take a typed key.');
  const k=key.trim();if(!k||k.length>512||/[\s\u0000-\u001f]/.test(k))throw new Error('That key does not look valid. Nothing was saved.');
  await this.credentials.modify(id,async()=>({type:'api_key',key:k}));this.messages.delete(id);this.changed();
 }
 async cancelSignIn(id:string){this.signingIn.get(id)?.abort();await this.loginJobs.get(id);}
 async remove(id:string){await this.cancelSignIn(id);await this.credentials.delete(id);this.messages.delete(id);this.changed();}
 /** Provider-owned PKCE: the system browser returns to a private loopback callback. */
 async signIn(id:string){
  if(desc(id)?.connect!=='sign-in-page')throw new Error('This provider has no sign-in page.');
  if(this.signingIn.has(id))return;
  const abort=new AbortController();this.signingIn.set(id,abort);this.messages.set(id,'Waiting for you to finish signing in on the provider’s page.');this.changed();
  const interaction:AuthInteraction={signal:abort.signal,
   // The sign-in page returns to a private loopback callback; a pasted address is never offered, so this never answers.
   prompt:()=>new Promise<string>(()=>{}),
   notify:(e:AuthEvent)=>{if(e.type==='auth_url'&&new URL(e.url).protocol==='https:')this.deps.notify?.({type:'openAuth',url:e.url});}};
  const job=(async()=>{
   const s=id==='openai'?await this.settings.update(s=>{s.chatGPTHostId??=randomUUID();}):undefined;
   await this.models.login(id,'oauth',interaction,{agentName:'Pip',...(s?{getDeviceId:()=>s.chatGPTHostId!}:{})});
  })().then(()=>{this.messages.delete(id);},error=>{this.messages.set(id,abort.signal.aborted?'Sign-in was cancelled.':'Sign-in did not finish. Nothing was saved.');}).finally(()=>{this.signingIn.delete(id);this.loginJobs.delete(id);this.changed();});
  this.loginJobs.set(id,job);
 }
 /** What the conversation runs on for one request: a checked provider, model and display label. */
 async choose(which:'active'|'backup'='active'):Promise<ModelChoice|undefined>{
  const s=await this.settings.read();
  const id=which==='active'?s.active:s.backup;
  if(!id)return undefined;
  if(which==='backup'&&!this.allowedIn(s,id))return undefined;
  const d=desc(id);if(!d)throw new ProviderError('That provider is not available.','unknown');
  if(!this.allowedIn(s,id))throw new ProviderError(`${d.name} is not allowed yet. Open Settings and read its Allow screen first. Nothing was sent.`,'allow-required');
  const modelId=s.models[id]??d.defaultModel;
  const model=this.models.getModel(id,modelId);
  if(!model)throw new ProviderError(`${d.name} does not offer the chosen model. Choose another in Settings.`,'model-missing');
  if(!(await this.credentials.read(id)))throw new ProviderError(`${d.name} is not signed in`,'sign-in-required',true,d.name);
  return {provider:id,modelId,providerName:d.name,label:`${model.name} via ${d.name}`,images:model.input.includes('image')};
 }
 /** The models and the per-request choice the conversation host runs on. */
 engine():Engine{return {models:this.models,choose:which=>this.choose(which)};}
}
