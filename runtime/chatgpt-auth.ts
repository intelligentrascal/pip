import { createHash, createPublicKey, randomBytes, verify, type JsonWebKey } from 'node:crypto';
import { createServer } from 'node:http';
import type { OAuthAuth, OAuthCredential } from '@earendil-works/pi-ai';

// ELF-24: ChatGPT plan access for this locally hosted app, not the legacy Codex endpoint.
// Current OpenAI registration/preview rules: https://developers.openai.com/siwc/token-sharing-open-source
const ISSUER='https://auth.openai.com';
const RESOURCE='https://api.openai.com/v1';
const DIRECT='chatgpt.tokens.use.direct';
export const CHATGPT_MODEL='gpt-6.1-sol';
const opaque=()=>randomBytes(32).toString('base64url');
export class ChatGPTSignInError extends Error {}
const fail=(message='ChatGPT sign-in could not be verified. Nothing was saved.'):never=>{throw new ChatGPTSignInError(message);};
type Options={previous:()=>Promise<OAuthCredential|undefined>;fetch?:typeof fetch;callbackPort?:number};

/** Pip owns sign-in because the pinned engine checks only ID-token presence.
 * Keep its Responses transport and locked refresh, but validate identity before saving.
 * No pasted codes, ambient credentials, profile import or Keychain access. */
export function chatGPTAuth(options:Options):OAuthAuth {
 const request=options.fetch??fetch;
 async function json(url:string,init:RequestInit){
  const response=await request(url,{...init,redirect:'error'});
  if(!response.ok)fail(response.status===401||response.status===403?'ChatGPT access was rejected. Sign in again in Pip.':'ChatGPT could not connect. Try signing in again in Pip.');
  return response.json() as Promise<Record<string,unknown>>;
 }
 async function identity(token:unknown,clientId:string,signal:AbortSignal,expected:{nonce?:string;subject?:string}){
  if(typeof token!=='string'||token.length>32768)fail();
  const parts=(token as string).split('.');if(parts.length!==3)fail();
  let header:Record<string,unknown>,claims:Record<string,unknown>;
  try{header=JSON.parse(Buffer.from(parts[0],'base64url').toString());claims=JSON.parse(Buffer.from(parts[1],'base64url').toString());}catch{fail();}
  if(header!.alg!=='RS256'||typeof header!.kid!=='string'||header!.crit!==undefined)fail();
  const jwks=await json(ISSUER+'/.well-known/jwks.json',{signal});
  if(!Array.isArray(jwks.keys))fail();
  const key=(jwks.keys as Record<string,unknown>[]).find(k=>k.kid===header!.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig')&&(!k.alg||k.alg==='RS256'));
  if(!key)fail();
  let valid=false;
  try{valid=verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:key as JsonWebKey,format:'jwk'}),Buffer.from(parts[2],'base64url'));}catch{fail();}
  const aud=claims!.aud,now=Date.now()/1000;
  if(!valid||claims!.iss!==ISSUER||!(aud===clientId||(Array.isArray(aud)&&aud.includes(clientId)))||
   (Array.isArray(aud)&&aud.length>1&&claims!.azp!==clientId)||
   typeof claims!.exp!=='number'||claims!.exp<=now||(typeof claims!.nbf==='number'&&claims!.nbf>now)||
   typeof claims!.sub!=='string'||!claims!.sub||
   (expected.nonce!==undefined&&claims!.nonce!==expected.nonce)||
   (expected.subject!==undefined&&claims!.sub!==expected.subject))fail();
  return {subject:claims!.sub as string};
 }
 async function token(body:URLSearchParams,signal:AbortSignal){
  const data=await json(ISSUER+'/api/accounts/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body,signal});
  if(typeof data.access_token!=='string'||!data.access_token||typeof data.refresh_token!=='string'||!data.refresh_token||
   typeof data.expires_in!=='number'||!Number.isFinite(data.expires_in)||data.expires_in<=0||
   typeof data.scope!=='string'||!data.scope.split(/\s+/).includes(DIRECT)||String(data.token_type).toLowerCase()!=='bearer')fail();
  return data;
 }
 function credential(data:Record<string,unknown>,clientId:string,subject:string,idToken:string):OAuthCredential{
  return {type:'oauth',access:data.access_token as string,refresh:data.refresh_token as string,
   expires:Date.now()+Math.max(0,(data.expires_in as number)-180)*1000,clientId,subject,idToken,scopes:(data.scope as string).split(/\s+/)};
 }
 return {
  name:'ChatGPT plan',isSubscription:true,loginLabel:'Continue with ChatGPT',
  async login(interaction,loginOptions){
   const id=loginOptions?.getDeviceId?.();
   if(!id||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))fail();
   const previous=await options.previous();
   const returning=typeof previous?.clientId==='string'&&typeof previous.subject==='string'&&typeof previous.idToken==='string';
   const clientId=returning?previous.clientId as string:'dynamic_agent_client';
   const state=opaque(),nonce=opaque(),verifier=opaque();
   const signal=AbortSignal.any([interaction.signal,AbortSignal.timeout(300000)]);
   signal.throwIfAborted();
   let resolve!:(v:{code:string;clientId:string})=>void,reject!:(e:Error)=>void;
   const result=new Promise<{code:string;clientId:string}>((yes,no)=>{resolve=yes;reject=no;});
   // Attach before any network callback can reject, including a declined registration.
   void result.catch(()=>{});
   const server=createServer((req,res)=>{
    const send=(status:number,body:string)=>{res.writeHead(status,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; frame-ancestors 'none'"});res.end(body);};
    let url:URL;
    try{url=new URL(req.url??'/', 'http://127.0.0.1');}catch{send(400,'Invalid callback.');return;}
    if(req.method!=='GET'||url.pathname!=='/auth/callback'){send(404,'Not found.');return;}
    if(url.searchParams.get('state')!==state){send(400,'This sign-in does not match Pip’s pending request.');return;}
    if(url.searchParams.has('error')){send(400,'ChatGPT was not connected. Return to Pip.');reject(new ChatGPTSignInError('ChatGPT access was not allowed. Nothing was saved.'));return;}
    const issued=url.searchParams.get('client_id')??(returning?clientId:'');
    const code=url.searchParams.get('code');
    if(!code||!issued||issued==='dynamic_agent_client'||(returning&&issued!==clientId)){send(400,'Pip could not verify this sign-in.');return;}
    send(200,'Sign-in received. Return to Pip to check whether ChatGPT connected.');resolve({code,clientId:issued});
   });
   const onAbort=()=>reject(new ChatGPTSignInError('ChatGPT sign-in was cancelled or expired. Nothing was saved.'));
   try{
    await new Promise<void>((yes,no)=>{server.once('error',no);server.listen(options.callbackPort??1455,'127.0.0.1',()=>{server.removeListener('error',no);yes();});});
    server.on('error',reject);signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();
    const address=server.address();if(!address||typeof address==='string')fail();
    const redirect=`http://127.0.0.1:${(address as {port:number}).port}/auth/callback`;
    const url=new URL(ISSUER+'/api/accounts/authorize');
    url.search=new URLSearchParams({client_id:clientId,ext_agent_host_id:'urn:uuid:'+id,response_type:'code',redirect_uri:redirect,resource:RESOURCE,
     scope:'openid profile email offline_access resource.invoke '+DIRECT,state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',
     ...(returning?{id_token_hint:previous.idToken as string}:{agent_name_hint:'Pip'})}).toString();
    interaction.notify({type:'auth_url',url:url.toString()});
    const callback=await result;
    const data=await token(new URLSearchParams({grant_type:'authorization_code',client_id:callback.clientId,code:callback.code,code_verifier:verifier,redirect_uri:redirect,resource:RESOURCE}),signal);
    const account=await identity(data.id_token,callback.clientId,signal,{nonce,...(returning?{subject:previous.subject as string}:{})});
    // The public account catalogue, not the bundled catalogue, decides preview access.
    const models=await json(RESOURCE+'/models',{headers:{authorization:'Bearer '+data.access_token},signal});
    if(!Array.isArray(models.models)||!models.models.some(m=>m?.slug===CHATGPT_MODEL&&m.visibility==='list'))fail('Your ChatGPT account does not offer Pip’s checked model. Nothing was saved.');
    signal.throwIfAborted();
    return credential(data,callback.clientId,account.subject,data.id_token as string);
   }catch(error){
    if((error as NodeJS.ErrnoException)?.code==='EADDRINUSE')fail('Another sign-in is using ChatGPT’s local callback. Finish or cancel it before trying again.');
    if(error instanceof ChatGPTSignInError)throw error;
    return fail();
   }finally{signal.removeEventListener('abort',onAbort);server.close();server.closeAllConnections();}
  },
  async refresh(current,signal){
   if(typeof current.clientId!=='string'||typeof current.subject!=='string'||typeof current.idToken!=='string')fail('Reconnect ChatGPT in Pip.');
   const data=await token(new URLSearchParams({grant_type:'refresh_token',client_id:current.clientId as string,refresh_token:current.refresh,resource:RESOURCE}),signal);
   if(data.id_token!==undefined)await identity(data.id_token,current.clientId as string,signal,{subject:current.subject as string});
   return credential(data,current.clientId as string,current.subject as string,(data.id_token??current.idToken) as string);
  },
  async toAuth(current){return {apiKey:current.access};}
 };
}

/** Apply the preview’s HTTP rules to the engine’s assembled request, including tools. */
export function chatGPTPayload(raw:unknown){
 const p={...(raw as Record<string,unknown>)};
 for(const field of ['background','conversation','max_output_tokens','max_tool_calls','metadata','moderation','multi_agent','prompt','prompt_cache_retention','prompt_cache_options','safety_identifier','temperature','top_logprobs','top_p','truncation','user','previous_response_id'])delete p[field];
 p.store=false;p.stream=true;
 if(Array.isArray(p.input))p.input=p.input.map(item=>item.role==='system'?{...item,role:'developer'}:item);
 if(Array.isArray(p.tools)&&p.tools.length)p.tools=[{type:'namespace',name:'pip',description:'Pip’s app-owned research and answer tools.',tools:p.tools}];
 return p;
}
