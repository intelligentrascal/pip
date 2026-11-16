import { createModels, fauxProvider, fauxAssistantMessage, fauxText, fauxToolCall, type AssistantMessage, type FauxResponseFactory, type FauxResponseStep, type Message } from '@earendil-works/pi-ai';
import type { Engine } from '../../runtime/providers.js';

/** One scripted stand-in model on pi-ai's own faux provider: no account, no network. */
export function fauxEngine(options:{images?:boolean;provider?:string}={}) {
 const faux=fauxProvider({provider:options.provider??'fixture',api:'pip-fixture',models:[{id:'fixture-model',input:options.images===false?['text']:['text','image']}]});
 const models=createModels();models.setProvider(faux.provider);
 const model=faux.getModel();
 const engine:Engine={models,choose:async which=>which==='backup'?undefined:{provider:model.provider,modelId:model.id,providerName:'Fixture',label:'Fixture model',images:options.images!==false}};
 return {faux,engine};
}
export const said=(text:string)=>fauxAssistantMessage(fauxText(text));
export const calls=(...c:[string,Record<string,unknown>][])=>fauxAssistantMessage(c.map(([name,args])=>fauxToolCall(name,args)),{stopReason:'toolUse'});
/** A scripted model step that waits until the test releases it, and ends as aborted when the request is aborted. */
export function held() {
 let release!:(message:AssistantMessage)=>void;let enter!:()=>void;
 const entered=new Promise<void>(yes=>{enter=yes;});
 const step:FauxResponseFactory=(_context,options)=>new Promise(resolve=>{
  release=resolve;enter();
  options?.signal?.addEventListener('abort',()=>resolve(fauxAssistantMessage('',{stopReason:'aborted',errorMessage:'Request was aborted'})),{once:true});
 });
 return {step,entered,release:(text:string)=>release(fauxAssistantMessage(text))};
}
/** Answer every ask by what its request says, for tests that drive a page: a tool call is followed by a plain reply. */
export function routed(faux:{setResponses:(r:FauxResponseStep[])=>void},route:(request:string)=>AssistantMessage) {
 const requests:string[]=[];
 faux.setResponses(Array.from({length:400},()=>((context:{messages:Message[]})=>{
  requests.push(JSON.stringify(context.messages));
  const last=context.messages.at(-1);
  if(last?.role==='toolResult')return said('Done.');
  const request=last?.role==='user'?(typeof last.content==='string'?last.content:last.content.find(b=>b.type==='text')?.text??''):'';
  return route(request);
 }) as FauxResponseStep));
 return {requests};
}
