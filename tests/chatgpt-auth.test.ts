import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import type { OAuthCredential } from '@earendil-works/pi-ai';
import { chatGPTAuth, CHATGPT_MODEL } from '../runtime/chatgpt-auth.js';

// Intent: ELF-24/26, verify ChatGPT identity before saving, private callback, stable
// host, reconnect, refresh, and Remove. Protocol fixtures follow OpenAI's published
// registration/token/catalogue shapes; signatures and loopback HTTP are real,
// but these checks never contact OpenAI or use a person's credentials.
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...keys.publicKey.export({format:'jwk'}),kid:'pip-protocol-fixture',use:'sig',alg:'RS256'};
const issuer='https://auth.openai.com',client='oaiapp_pip_protocol_fixture',subject='pip-protocol-account';
const host=randomUUID();
const signed=(claims:Record<string,unknown>,bad=false)=>{
 const head=Buffer.from(JSON.stringify({alg:'RS256',kid:jwk.kid})).toString('base64url');
 const body=Buffer.from(JSON.stringify(claims)).toString('base64url');
 const sig=sign('RSA-SHA256',Buffer.from(head+'.'+body),keys.privateKey).toString('base64url');
 return head+'.'+body+'.'+(bad?'invalid':sig);
};
async function journey(change:Record<string,unknown>={},opts:{badSignature?:boolean;denied?:boolean;noModel?:boolean;noPermission?:boolean;previous?:OAuthCredential;refresh?:boolean}={}){
 let authURL:URL|undefined,exchanges=0,catalogues=0,wrongStateRejected=false;
 const abort=new AbortController();
 const auth=chatGPTAuth({callbackPort:0,previous:async()=>opts.previous,fetch:async(input,init)=>{
  const url=String(input);
  if(url.endsWith('/jwks.json'))return Response.json({keys:[jwk]});
  if(url.endsWith('/models')){catalogues++;assert.equal(init?.redirect,'error');assert.ok(init?.headers);return Response.json({models:opts.noModel?[]:[{slug:CHATGPT_MODEL,display_name:'GPT-6.1 Sol',visibility:'list'}]});}
  assert.equal(url,issuer+'/api/accounts/oauth/token');exchanges++;
  const form=init!.body as URLSearchParams;
  assert.equal(form.get('client_id'),client);assert.equal(form.get('resource'),'https://api.openai.com/v1');
  assert.equal(init?.redirect,'error');
  if(opts.refresh)assert.equal(form.get('grant_type'),'refresh_token');
  else {
   assert.equal(form.get('grant_type'),'authorization_code');assert.equal(form.get('redirect_uri'),authURL!.searchParams.get('redirect_uri'));
   assert.equal(createHash('sha256').update(form.get('code_verifier')!).digest('base64url'),authURL!.searchParams.get('code_challenge'));
  }
  return Response.json({token_type:'Bearer',access_token:'pip-protocol-access',refresh_token:'pip-protocol-rotated-refresh',expires_in:3600,
   scope:opts.noPermission?'openid profile email':'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
   id_token:signed({iss:issuer,aud:client,sub:subject,exp:Math.floor(Date.now()/1000)+3600,...(!opts.refresh?{nonce:authURL!.searchParams.get('nonce')} : {}),...change},opts.badSignature)});
 }});
 if(opts.refresh)return {credential:await auth.refresh(opts.previous!,abort.signal),exchanges,catalogues};
 let notifyReady!:()=>void;const ready=new Promise<void>(yes=>{notifyReady=yes;});
 const login=auth.login({signal:abort.signal,prompt:async()=>{throw Error('No paste prompts.');},notify:e=>{
  assert.equal(e.type,'auth_url');if(e.type!=='auth_url')return;
  authURL=new URL(e.url);assert.equal(authURL.origin,issuer);assert.equal(authURL.pathname,'/api/accounts/authorize');
  assert.equal(authURL.searchParams.get('ext_agent_host_id'),'urn:uuid:'+host);
  assert.equal(authURL.searchParams.get('client_id'),opts.previous?client:'dynamic_agent_client');
  assert.equal(authURL.searchParams.get('agent_name_hint'),opts.previous?null:'Pip');
  if(opts.previous)assert.equal(authURL.searchParams.get('id_token_hint'),opts.previous.idToken);
  notifyReady();
 }},{getDeviceId:()=>host,agentName:'Pip'});
 // notify runs only after the real listener is ready; no timer, polling or retry.
 void login.catch(()=>{});await ready;
 const callback=new URL(authURL!.searchParams.get('redirect_uri')!);
 callback.search=new URLSearchParams({state:'wrong-state',code:'protocol-code',client_id:client}).toString();
 wrongStateRejected=(await fetch(callback)).status===400;
 callback.search=new URLSearchParams({state:authURL!.searchParams.get('state')!,...(opts.denied?{error:'access_denied'}:{code:'protocol-code',client_id:client})}).toString();
 await fetch(callback);
 return {credential:await login,exchanges,catalogues,wrongStateRejected};
}

test('ELF-26 ChatGPT registration checks PKCE, state, signed identity and account models; reconnect reuses host and client',async()=>{
 const first=await journey();assert.equal(first.wrongStateRejected,true);assert.equal(first.exchanges,1);assert.equal(first.catalogues,1);
 assert.equal(first.credential.clientId,client);assert.equal(first.credential.subject,subject);
 const again=await journey({}, {previous:first.credential});assert.equal(again.credential.clientId,client);
 const refreshed=await journey({}, {previous:first.credential,refresh:true});assert.equal(refreshed.exchanges,1);assert.equal(refreshed.catalogues,0);
 assert.equal(refreshed.credential.refresh,'pip-protocol-rotated-refresh');assert.equal(refreshed.credential.subject,subject);
});

test('ELF-26 invalid ChatGPT identity, missing permission and denied registration never return a credential',async()=>{
 for(const change of [{iss:'https://not-openai.example'}, {aud:'other-client'}, {exp:0}, {nonce:'wrong'}, {sub:''}])await assert.rejects(journey(change),/could not be verified/);
 await assert.rejects(journey({}, {badSignature:true}),/could not be verified/);
 await assert.rejects(journey({}, {denied:true}),/not allowed/);
 await assert.rejects(journey({}, {noPermission:true}),/could not be verified/);
 await assert.rejects(journey({}, {noModel:true}),/does not offer/);
 const first=await journey();
 await assert.rejects(journey({sub:'other-account'},{previous:first.credential}),/could not be verified/);
 await assert.rejects(journey({sub:'other-account'},{previous:first.credential,refresh:true}),/could not be verified/);
});

test('ELF-26 cancelling a callback wait closes its loopback listener without a credential',async()=>{
 const abort=new AbortController();let callback='';
 const auth=chatGPTAuth({callbackPort:0,previous:async()=>undefined,fetch:async()=>{throw Error('No network expected.');}});
 await assert.rejects(auth.login({signal:abort.signal,prompt:async()=>{throw Error('no paste');},notify:e=>{if(e.type==='auth_url'){callback=new URL(e.url).searchParams.get('redirect_uri')!;abort.abort();}}},{getDeviceId:()=>host}),/cancelled/);
 await assert.rejects(fetch(callback));
});
