import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {openHost,type Host} from '../runtime/pi-durable-adapter.js';
import {EphemeralScreenContexts,sharedScreenContext} from '../runtime/screen-context.js';
import {modelPrompt} from '../runtime/context-prompt.js';
import {safeClaudeFailure} from '../runtime/claude.js';
import {screenFixture} from './helpers/screen-context.js';
import type {Result,ProviderRequestContext} from '../runtime/domain.js';
const result:Result={kind:'answer',title:'Window review',text:'The disposable note is available for review.',sources:[],model:'Fixture transport — not Claude',sessionId:'fixture'};
async function home(){const base=process.env.PIP_TEST_ROOT??path.join(os.tmpdir(),'pip-unit-fixtures');await mkdir(base,{recursive:true});const home=await mkdtemp(path.join(base,'screen-'));await writeFile(path.join(home,'.pip-test-home'),'pip-test-only');return home;}
async function until(host:Host,predicate:(state:Awaited<ReturnType<Host['snapshot']>>)=>boolean){const end=Date.now()+5000;while(Date.now()<end){const state=await host.snapshot();if(predicate(state))return state;await new Promise(resolve=>setImmediate(resolve));}throw Error('Expected context state did not commit');}

test('ELF-8 window context accepts real bounded images and rejects mismatched revisions, modes and dimensions',async()=>{
 const image=await screenFixture();assert.deepEqual(sharedScreenContext(image),image);
 assert.throws(()=>sharedScreenContext({...image,descriptor:{...image.descriptor,revision:0}}),/reference/);
 assert.throws(()=>sharedScreenContext({...image,descriptor:{...image.descriptor,width:image.descriptor.width+1}}),/dimensions/);
 assert.throws(()=>sharedScreenContext({...image,descriptor:{...image.descriptor,mode:'text'}}),/mode/);
 assert.throws(()=>sharedScreenContext({...image,path:'/unapproved-file'}),/Unexpected/);
 const cache=new EphemeralScreenContexts();const ref=cache.attach(image);cache.bind('review-this-window',ref);
 assert.throws(()=>cache.bind('another-task',ref),/expired/);
 assert.deepEqual(cache.take('review-this-window'),image);assert.equal(cache.take('review-this-window'),undefined);
 cache.attach(image);cache.discard();assert.throws(()=>cache.bind('after-hide',ref),/expired/);
 const revised={...image,descriptor:{...image.descriptor,revision:2}};cache.attach(revised);assert.throws(()=>cache.attach(image),/changed/);
});

test('ELF-8 shared source becomes structured SDK data, with implicit attachment expansion disabled',async()=>{
 const image=await screenFixture();const request='Summarise the reviewed window. Treat @source-not-a-file as literal text.';
 const messages=[];for await(const message of modelPrompt(request,{sessionId:'window-review',screen:image}))messages.push(message);
 assert.equal(messages.length,1);assert.equal(messages[0].client_composed,true);assert.deepEqual(messages[0].origin,{kind:'human'});
 const blocks=messages[0].message.content;assert.ok(Array.isArray(blocks));assert.equal(blocks[0].type,'text');assert.equal((blocks[0] as {text:string}).text,request);
 const picture=blocks.find(block=>block.type==='image');assert.ok(picture);assert.deepEqual(picture.source,{type:'base64',media_type:'image/png',data:image.content.type==='image'?image.content.data:''});
 const text=await screenFixture('text'),plain=[];for await(const message of modelPrompt(request,{sessionId:'text-review',screen:text}))plain.push(message);
 assert.ok(Array.isArray(plain[0].message.content));assert.equal(plain[0].message.content.some(block=>block.type==='image'),false);
 assert.ok(plain[0].message.content.some(block=>block.type==='text'&&text.content.type==='text'&&block.text===text.content.text));
 const unshared=[];for await(const message of modelPrompt(request))unshared.push(message);
 assert.ok(Array.isArray(unshared[0].message.content));assert.equal(unshared[0].message.content.length,1);assert.equal(unshared[0].client_composed,true);
});

test('ELF-8 transport errors cannot copy shared window contents into persisted diagnostics',async()=>{
 const fixture=await screenFixture('text');assert.equal(fixture.content.type,'text');
 if(fixture.content.type!=='text')throw Error('Text fixture required');
 const external=new Error('Claude transport rejected a frame containing '+fixture.content.text);
 assert.equal(safeClaudeFailure(external).message.includes(fixture.content.text),false);
 const auth=Object.assign(new Error('Connection rejected'),{status:401});assert.equal(safeClaudeFailure(auth).code,'sign-in-required');
});

test('ELF-8 raw screen context never enters durable work and cannot be reused after completion or reopen',async()=>{
 const location=await home(),image=await screenFixture();let seen:ProviderRequestContext|undefined;
 let host=await openHost({home:location,fixture:true,provider:async(_r,_m,_s,context)=>{seen=context;return result;}});
 try{
  const reference=await host.attachScreenContext(image);await host.submit('review-window','Summarise the reviewed window.',undefined,reference);
  const state=await until(host,s=>s.works[0]?.status==='Done');assert.deepEqual(seen?.screen,image);assert.deepEqual(state.works[0].screenContext,image.descriptor);
  if(image.content.type==='image')assert.equal(JSON.stringify(state).includes(image.content.data),false);
  await host.saveComposer('Keep this draft while I review another window.');
  await assert.rejects(host.submit('reused-window','Use the old window again.',undefined,reference),/expired/);
  assert.equal((await host.snapshot()).composer,'Keep this draft while I review another window.');
  await host.close();host=await openHost({home:location,fixture:true});
  assert.deepEqual((await host.snapshot()).works[0].screenContext,image.descriptor);
  await assert.rejects(host.submit('after-reopen','Use the old window again.',undefined,reference),/expired/);
 }finally{await host.close();}
});

test('ELF-8 dismissal discards unstarted pixels and explicit fresh sharing resumes only that interrupted work',async()=>{
 const location=await home(),screen=await screenFixture('text');let release!:(result:Result)=>void,calls=0;
 let host=await openHost({home:location,fixture:true,provider:async(_request,_memory,signal)=>{calls++;return new Promise((resolve,reject)=>{release=resolve;signal.addEventListener('abort',()=>reject(Error('Stopped')),{once:true});});}});
 try{
  await host.submit('first-request','Write a clearer version of this note.');await until(host,s=>s.works[0]?.status==='Working');
  const reference=await host.attachScreenContext(screen);await host.submit('queued-window','Summarise the reviewed window.',undefined,reference);
  await host.discardScreenContext();assert.equal((await host.snapshot()).works[1].status,'Interrupted');
  assert.equal((await host.tracker('work')).find(w=>w.id==='queued-window')!.status,'Waiting on you');
  release(result);await until(host,s=>s.works[0]?.status==='Done');assert.equal(calls,1);
  await host.close();host=await openHost({home:location,fixture:true,provider:async(_r,_m,_s,context)=>{calls++;assert.ok(context?.screen);return result;}});
  await assert.rejects(host.resumeScreenWork('queued-window',reference),/expired/);
  const fresh=await host.attachScreenContext(await screenFixture('text'));await host.resumeScreenWork('queued-window',fresh);
  await until(host,s=>s.works[1].status==='Done');assert.equal(calls,2);assert.equal((await host.snapshot()).works[1].request,'Summarise the reviewed window.');
  await assert.rejects(host.resumeScreenWork('queued-window',fresh),/not waiting/);
 }finally{await host.stop();await host.close();}
});

test('ELF-8 Stop also stops work paused for fresh context instead of leaving a hidden continuation',async()=>{
 const host=await openHost({home:await home(),fixture:true,provider:async(_request,_memory,signal)=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('Stopped')),{once:true});})});
 try{
  await host.submit('busy-stop','Write a clearer note.');await until(host,s=>s.works[0]?.status==='Working');
  const reference=await host.attachScreenContext(await screenFixture('text'));await host.submit('paused-stop','Summarise the reviewed window.',undefined,reference);
  await host.discardScreenContext();await host.stop();
  const paused=(await host.snapshot()).works.find(w=>w.id==='paused-stop')!;assert.equal(paused.status,'Stopped');assert.equal(paused.needsScreenContext,false);assert.equal(paused.error,'');
  const fresh=await host.attachScreenContext(await screenFixture('text'));await assert.rejects(host.resumeScreenWork('paused-stop',fresh),/not waiting/);
 }finally{await host.stop();await host.close();}
});

test('ELF-8 abrupt restart pauses contextual work instead of sending a persisted screen archive',async()=>{
 const location=await home();
 const adapter=new URL('../runtime/pi-durable-adapter.ts',import.meta.url).href,fixture=new URL('./helpers/screen-context.ts',import.meta.url).href;
 const script=`import {openHost} from ${JSON.stringify(adapter)};import {screenFixture} from ${JSON.stringify(fixture)};const h=await openHost({home:process.env.SCREEN_TEST_HOME,fixture:true,provider:async()=>new Promise(()=>{})});await h.submit('busy','Write a clearer note.');const end=Date.now()+5000;while((await h.snapshot()).works[0].status!=='Working'){if(Date.now()>end)throw Error('worker deadline');await new Promise(r=>setImmediate(r));}const ref=await h.attachScreenContext(await screenFixture());await h.submit('queued','Summarise the reviewed window.',undefined,ref);process.exit(0);`;
 await new Promise<void>((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx','--input-type=module'],{cwd:process.cwd(),env:{...process.env,SCREEN_TEST_HOME:location},stdio:['pipe','ignore','pipe'],timeout:8000});let error='';child.stderr.on('data',data=>{error+=String(data);});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('Isolated restart fixture failed: '+error.slice(-1000))));child.stdin.end(script);});
 const calls:string[]=[];const host=await openHost({home:location,fixture:true,provider:async request=>{calls.push(request);return result;}});
 try{const state=await until(host,s=>s.works.find(w=>w.id==='queued')?.status==='Interrupted');assert.equal(state.works.find(w=>w.id==='queued')!.needsScreenContext,true);assert.equal(calls.includes('Summarise the reviewed window.'),false);assert.equal(state.works.find(w=>w.id==='queued')!.result,null);}finally{await host.close();}
});
