import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {openHost} from '../runtime/pi-durable-adapter.js';
import {EphemeralScreenContexts,sharedScreenContext} from '../runtime/screen-context.js';
import {readFile} from 'node:fs/promises';
import {fauxAssistantMessage} from '@earendil-works/pi-ai';
import {fauxEngine,said,held} from './helpers/faux-engine.js';
import {until,finished} from './helpers/ask.js';
import {screenFixture} from './helpers/screen-context.js';
const NOTE='The disposable note is available for review.';
async function home(){const base=process.env.PIP_TEST_ROOT??path.join(os.tmpdir(),'pip-unit-fixtures');await mkdir(base,{recursive:true});const home=await mkdtemp(path.join(base,'screen-'));await writeFile(path.join(home,'.pip-test-home'),'pip-test-only');return home;}

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

// Intent: ELF-8 a reviewed window reaches the model as structured content of that one request, never as file or @-expansion text.
test('ELF-8 shared source becomes structured model input for that request only',async()=>{
 const image=await screenFixture();const request='Summarise the reviewed window. Treat @source-not-a-file as literal text.';
 const seen:any[]=[];const {faux,engine}=fauxEngine();
 faux.setResponses([ctx=>{seen.push(ctx.messages.at(-1));return fauxAssistantMessage(NOTE);},ctx=>{seen.push(ctx.messages.at(-1));return fauxAssistantMessage(NOTE);},ctx=>{seen.push(ctx.messages.at(-1));return fauxAssistantMessage(NOTE);}]);
 const location=await home();const host=await openHost({home:location,fixture:true,engine});
 try{
  const ask=async(id:string,reference?:unknown)=>{await host.submit(id,request,undefined,reference);await until(host,finished(id));};
  await ask('image',await host.attachScreenContext(image));
  const blocks=seen[0].content;assert.ok(Array.isArray(blocks));assert.equal(blocks[0].type,'text');assert.equal(blocks[0].text,request);
  const picture=blocks.find((b:{type:string})=>b.type==='image');assert.ok(picture);assert.equal(picture.mimeType,'image/png');assert.equal(picture.data,image.content.type==='image'?image.content.data:'');
  const text=await screenFixture('text');await ask('text',await host.attachScreenContext(text));
  assert.equal(seen[1].content.some((b:{type:string})=>b.type==='image'),false);
  assert.ok(seen[1].content.some((b:{type:string;text?:string})=>b.type==='text'&&text.content.type==='text'&&b.text===text.content.text));
  await ask('none');
  assert.equal(seen[2].content.some((b:{type:string})=>b.type==='image'),false);assert.equal(JSON.stringify(seen[2].content).includes('window snapshot'),false);
 }finally{await host.close();}
});

// Intent: ELF-8 provider errors cannot copy shared window contents into persisted diagnostics.
test('ELF-8 model errors cannot copy shared window contents into persisted diagnostics',async()=>{
 const fixture=await screenFixture('text');if(fixture.content.type!=='text')throw Error('Text fixture required');
 const {faux,engine}=fauxEngine();
 faux.setResponses([fauxAssistantMessage('',{stopReason:'error',errorMessage:'Transport rejected a frame containing '+fixture.content.text})]);
 const host=await openHost({home:await home(),fixture:true,engine,retry:{maxRetries:0}});
 try{
  await host.submit('leak',"Review the window.",undefined,await host.attachScreenContext(fixture));
  const state=await until(host,finished('leak'));
  assert.equal(state.works[0].status,'Could not finish');assert.equal(JSON.stringify(state).includes(fixture.content.text),false);
 }finally{await host.close();}
});

// Intent: ELF-8 raw window pixels and text never enter durable state, not the work record and not the conversation's own database.
test('ELF-8 raw screen context never enters durable work or the conversation and cannot be reused after completion or reopen',async()=>{
 const location=await home(),image=await screenFixture();const {faux,engine}=fauxEngine();let sawImage=false;
 faux.setResponses([ctx=>{sawImage=JSON.stringify(ctx.messages).includes('"type":"image"');return fauxAssistantMessage(NOTE);}]);
 let host=await openHost({home:location,fixture:true,engine});
 try{
  const reference=await host.attachScreenContext(image);await host.submit('review-window','Summarise the reviewed window.',undefined,reference);
  const state=await until(host,finished('review-window'));assert.equal(sawImage,true);assert.deepEqual(state.works[0].screenContext,image.descriptor);
  assert.equal(state.works[0].status,'Done');
  if(image.content.type==='image')assert.equal(JSON.stringify(state).includes(image.content.data),false);
  await host.saveComposer('Keep this draft while I review another window.');
  await assert.rejects(host.submit('reused-window','Use the old window again.',undefined,reference),/expired/);
  assert.equal((await host.snapshot()).composer,'Keep this draft while I review another window.');
  await host.close();host=await openHost({home:location,fixture:true,engine});
  assert.deepEqual((await host.snapshot()).works[0].screenContext,image.descriptor);
  await assert.rejects(host.submit('after-reopen','Use the old window again.',undefined,reference),/expired/);
  await host.close();
  if(image.content.type==='image'){
   const needle=image.content.data.slice(200,400);
   assert.ok((await readFile(path.join(location,'pip.sqlite'))).length>0);
   for(const file of ['pip.sqlite','pip.sqlite-wal'])assert.equal((await readFile(path.join(location,file)).catch(()=>Buffer.alloc(0))).includes(needle),false,file+' must not hold the window image');
  }
 }finally{await host.close();}
});

test('ELF-8 dismissal discards unstarted pixels and explicit fresh sharing resumes only that interrupted work',async()=>{
 const location=await home(),screen=await screenFixture('text');const first=held();const a=fauxEngine();
 a.faux.setResponses([first.step]);
 let host=await openHost({home:location,fixture:true,engine:a.engine});
 try{
  await host.submit('first-request','Write a clearer version of this note.');await first.entered;
  const reference=await host.attachScreenContext(screen);await host.submit('queued-window','Summarise the reviewed window.',undefined,reference);
  await host.discardScreenContext();assert.equal((await host.snapshot()).works[1].status,'Interrupted');
  assert.equal((await host.tracker('work')).find(w=>w.id==='queued-window')!.status,'Waiting on you');
  first.release(NOTE);await until(host,finished('first-request'));assert.equal(a.faux.state.callCount,1);
  await host.close();
  const b=fauxEngine();let withWindow=false;
  b.faux.setResponses([ctx=>{withWindow=JSON.stringify(ctx.messages).includes(screen.content.type==='text'?JSON.stringify(screen.content.text.slice(0,40)).slice(1,-1):'?');return fauxAssistantMessage(NOTE);}]);
  host=await openHost({home:location,fixture:true,engine:b.engine});
  await assert.rejects(host.resumeScreenWork('queued-window',reference),/expired/);
  const fresh=await host.attachScreenContext(await screenFixture('text'));await host.resumeScreenWork('queued-window',fresh);
  await until(host,s=>s.works[1].status==='Done');assert.equal(b.faux.state.callCount,1);assert.equal(withWindow,true);assert.equal((await host.snapshot()).works[1].request,'Summarise the reviewed window.');
  await assert.rejects(host.resumeScreenWork('queued-window',fresh),/not waiting/);
 }finally{await host.stop();await host.close();}
});

test('ELF-8 Stop also stops work paused for fresh context instead of leaving a hidden continuation',async()=>{
 const first=held();const {faux,engine}=fauxEngine();faux.setResponses([first.step]);
 const host=await openHost({home:await home(),fixture:true,engine});
 try{
  await host.submit('busy-stop','Write a clearer note.');await first.entered;
  const reference=await host.attachScreenContext(await screenFixture('text'));await host.submit('paused-stop','Summarise the reviewed window.',undefined,reference);
  await host.discardScreenContext();await host.stop();
  const paused=(await host.snapshot()).works.find(w=>w.id==='paused-stop')!;assert.equal(paused.status,'Stopped');assert.equal(paused.needsScreenContext,false);assert.equal(paused.error,'');
  const fresh=await host.attachScreenContext(await screenFixture('text'));await assert.rejects(host.resumeScreenWork('paused-stop',fresh),/not waiting/);
 }finally{await host.stop();await host.close();}
});

test('ELF-8 abrupt restart pauses contextual work instead of sending a persisted screen archive',async()=>{
 const location=await home();
 const adapter=new URL('../runtime/pi-durable-adapter.ts',import.meta.url).href,fixture=new URL('./helpers/screen-context.ts',import.meta.url).href,fauxFile=new URL('./helpers/faux-engine.ts',import.meta.url).href;
 const script=`import {openHost} from ${JSON.stringify(adapter)};import {screenFixture} from ${JSON.stringify(fixture)};import {fauxEngine,held} from ${JSON.stringify(fauxFile)};const {faux,engine}=fauxEngine();const first=held();faux.setResponses([first.step]);const h=await openHost({home:process.env.SCREEN_TEST_HOME,fixture:true,engine});await h.submit('busy','Write a clearer note.');await first.entered;const ref=await h.attachScreenContext(await screenFixture());await h.submit('queued','Summarise the reviewed window.',undefined,ref);process.exit(0);`;
 await new Promise<void>((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx','--input-type=module'],{cwd:process.cwd(),env:{...process.env,SCREEN_TEST_HOME:location},stdio:['pipe','ignore','pipe'],timeout:8000});let error='';child.stderr.on('data',data=>{error+=String(data);});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('Isolated restart fixture failed: '+error.slice(-1000))));child.stdin.end(script);});
 const {faux,engine}=fauxEngine();faux.setResponses([said(NOTE)]);
 const host=await openHost({home:location,fixture:true,engine});
 try{const state=await until(host,s=>s.works.find(w=>w.id==='queued')?.status==='Interrupted');assert.equal(state.works.find(w=>w.id==='queued')!.needsScreenContext,true);assert.equal(faux.state.callCount,0);assert.equal(state.works.find(w=>w.id==='queued')!.result,null);}finally{await host.close();}
});
