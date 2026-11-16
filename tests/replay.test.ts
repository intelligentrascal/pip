import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModels, fauxProvider, fauxAssistantMessage, type FauxResponseStep } from '@earendil-works/pi-ai';
import { ProviderManager } from '../runtime/providers.js';
import { openHost } from '../runtime/pi-durable-adapter.js';
import { calls, said } from './helpers/faux-engine.js';
import { testHome, until, finished } from './helpers/ask.js';
import { screenFixture } from './helpers/screen-context.js';
import { withPublicPage } from './helpers/public-page.js';

// Intent: ELF-56 acceptance — the advisor's 12-request replay. Against the previous Pip every one of the 12 ended
// "Blocked: not allowed yet" before any model saw it. Here one Allow is given once, all 12 asks run in ONE conversation
// through the real host, providers and tools, and each reaches the model. The model is scripted (a stand-in, not live):
// this proves the plumbing and the tools, never the quality of a real model's answers. Piece 2 removes the four-app list and
// the forbidding prompt: opening an app the captain asked for now runs at once (the Mac is a stand-in that confirms), while a
// fact still waits for the captain's approval. Piece 4 adds the Mac abilities: forms fill through the automation package's
// tools (R8), files are found, read and sent (R9, R10) and the shell lists the folder (R12), all on stand-ins.
const fixture=JSON.parse(await readFile(new URL('./fixtures/public-readme.json',import.meta.url),'utf8'));
type Ask={key:string;request:string;script:FauxResponseStep[]};
const mustSee=(needle:string,then:FauxResponseStep):FauxResponseStep=>ctx=>{assert.ok(JSON.stringify(ctx.messages).includes(needle),`the model must see: ${needle}`);return typeof then==='function'?then(ctx,undefined,undefined as never,undefined as never):then;};
const toolSucceeded=(then:FauxResponseStep):FauxResponseStep=>(ctx=>{
 const last=ctx.messages.at(-1);assert.ok(last&&last.role==='toolResult'&&last.isError!==true,'the step ran and its result reaches the model');
 return typeof then==='function'?then(ctx,undefined,undefined as never,undefined as never):then;
}) as FauxResponseStep;
const stubServer=fileURLToPath(new URL('./fixtures/mcp-stub.mjs',import.meta.url));
const asks:Ask[]=[
 {key:'R1',request:'hi',script:[said('Hello! What can I do for you?')]},
 {key:'R2',request:'Research the best noise-cancelling headphones this year and summarise the top three',script:[calls(['read_public_url',{url:fixture.source}]),said('Here are the top three from the page I read.')]},
 {key:'R3',request:'Rewrite this email so it is shorter and friendlier: Hi team, the meeting has moved to Thursday at 3.',script:[calls(['present_draft',{title:'A friendlier note',text:'Hi team, the meeting moved to Thursday at 3. Thanks!'}]),said('Here is a shorter version.')]},
 {key:'R4',request:'Remember that I prefer tea',script:[calls(['propose_action',{action:{type:'memory.save',text:'The captain prefers tea.',source:'ignored: the host binds the real request'}}]),said('I can remember that once you approve it.')]},
 {key:'R5',request:'Remind me to call the dentist tomorrow at 9',script:[calls(['open_app',{bundleId:'com.apple.reminders'}]),toolSucceeded(said('I opened Reminders for you; creating the item itself needs the connected calendar.'))]},
 {key:'R6',request:'Add lunch with Aminaz to my calendar on Friday at 1',script:[calls(['open_app',{bundleId:'com.apple.iCal'}]),toolSucceeded(said('I opened Calendar for you; adding the event itself needs the connected calendar.'))]},
 {key:'R7',request:'Open WhatsApp',script:[calls(['open_app',{bundleId:'net.whatsapp.WhatsApp'}]),toolSucceeded(said('I opened WhatsApp.'))]},
 {key:'R8',request:'Fill in this form',script:[calls(['stub_browser_navigate',{url:'https://example.test/booking'}]),toolSucceeded(calls(['stub_browser_fill_form',{fields:{name:'Ana',guests:'2'}}])),toolSucceeded(said('Filled the form with your name and two guests.'))] as FauxResponseStep[]},
 {key:'R9',request:'Find this file and give me a short summary to send via WhatsApp',script:[calls(['bash',{command:'find . -name "*.md" -maxdepth 2'}]),toolSucceeded(calls(['send_message',{channel:'whatsapp',to:'Aminaz',text:'Summary of the found note.'}])),toolSucceeded(said('Found your note and sent the summary to Aminaz on WhatsApp.'))] as FauxResponseStep[]},
 {key:'R10',request:'Read this document, then send a WhatsApp message to Aminaz',script:[calls(['read',{path:'lisbon-notes.md'}]),toolSucceeded(calls(['send_message',{channel:'whatsapp',to:'Aminaz',text:'The Lisbon notes, read and passed on.'}])),toolSucceeded(said('Read the Lisbon notes and sent them to Aminaz on WhatsApp.'))] as FauxResponseStep[]},
 {key:'R11',request:'Read what is on my screen and help me with the task there',script:[mustSee('disposable note for local preview',said('The window shows a disposable preview note.'))]},
 {key:'R12',request:'Summarise the files in the folder I am in',script:[mustSee('Remember that I prefer tea',calls(['bash',{command:'ls'}])),toolSucceeded(said('Your folder holds the Lisbon notes; and your tea preference is remembered.'))] as FauxResponseStep[]},
];

test('ELF-56 the advisor\'s 12 requests all reach the model in one conversation after a single Allow',{timeout:120000},async()=>{
 const home=await testHome('pip-replay-');
 // The document R10 reads, inside the isolated test home where the file tools work.
 await writeFile(path.join(home,'lisbon-notes.md'),'Weekend plan: two tascas, one pastelaria, under 400 euros.');
 const faux=fauxProvider({provider:'openrouter',api:'pip-replay',models:[{id:'anthropic/claude-sonnet-5.5',input:['text','image']}]});
 const models=createModels();models.setProvider(faux.provider);
 const manager=new ProviderManager({home,models});
 await manager.credentials.modify('openrouter',async()=>({type:'api_key',key:'pip-replay-fake-key'}));
 await manager.select('openrouter');
 const natives:{id:string;status:string;action:{type:string}}[]=[];
 // The Mac is a stand-in that confirms every effect it is handed, once.
 let host!:Awaited<ReturnType<typeof openHost>>;
 host=await openHost({home,fixture:true,engine:manager.engine(),retry:{maxRetries:0},native:p=>{natives.push(p as never);setTimeout(()=>void host.receipt(p.id,'succeeded','Done on the stand-in Mac.'),1);},
  // R8's form filling runs through the automation packages; the stand-in server speaks the real MCP frames.
  mac:{servers:[{name:'stub',label:'Stub',command:process.execPath,args:[stubServer]}]}});
 const transcript:Record<string,unknown>[]=[];
 try{
  // Before Allow nothing is sent (the Allow screen itself is a later piece of work).
  await host.submit('before-allow','hi');
  assert.match((await until(host,finished('before-allow'))).works[0].error,/not allowed yet/);assert.equal(faux.state.callCount,0);
  await manager.allow('openrouter');
  await withPublicPage({...fixture,source:fixture.source},async()=>{
   let expectedCalls=0;
   for(const ask of asks){
    faux.setResponses(ask.script);expectedCalls+=ask.script.length;
    const screen=ask.key==='R11'?await host.attachScreenContext(await screenFixture('text')):undefined;
    await host.submit(ask.key,ask.request,undefined,screen);
    const work=(await until(host,finished(ask.key))).works.find(w=>w.id===ask.key)!;
    assert.equal(work.status,'Done',`${ask.key}: ${work.error}`);
    transcript.push({key:ask.key,request:ask.request,status:work.status,kind:work.result?.kind,title:work.result?.title,text:work.result?.text,sources:work.result?.sources.map(s=>s.url),proposal:work.result?.proposal?.type??null});
    assert.equal(faux.state.callCount,expectedCalls+0,`${ask.key}: every scripted turn ran, none was skipped`);
    expectedCalls=faux.state.callCount;
   }
  });
  const state=await host.snapshot();
  const done=(key:string)=>state.works.find(w=>w.id===key)!.result!;
  assert.equal(done('R1').text,'Hello! What can I do for you?');
  assert.equal(done('R2').sources[0].url,fixture.source);
  assert.equal(done('R3').kind,'draft');assert.match(done('R3').text,/Thursday at 3/);
  // The captain asked, so the three apps opened at once through the ledger; only the personal fact still waits for approval.
  assert.deepEqual(state.proposals.map(p=>p.action.type+(p.action.type==='app.open'?':'+p.action.bundleId:'')),['memory.save','app.open:com.apple.reminders','app.open:com.apple.iCal','app.open:net.whatsapp.WhatsApp','message.send','message.send']);
  assert.deepEqual(state.proposals.map(p=>p.status),['proposed','succeeded','succeeded','succeeded','succeeded','succeeded'],'the captain asked for both WhatsApp sends, so they ran at once');
  assert.deepEqual(natives.map(n=>n.status),['intent-recorded','intent-recorded','intent-recorded','intent-recorded','intent-recorded'],'each effect was recorded before the Mac was asked');
  assert.equal(state.proposals[0].action.type==='memory.save'&&state.proposals[0].action.source,'Remember that I prefer tea');
  assert.equal(done('R7').proposal,undefined);assert.match(done('R7').text,/opened WhatsApp/);
  for(const key of ['R8','R9','R10','R12'])assert.equal(done(key).proposal,undefined,key+' proposes nothing');
  assert.match(done('R8').text,/Filled the form/,'the automation tool did the form, not a refusal');
  assert.match(done('R12').text,/Lisbon notes/,'the shell listed the folder');
  // All 12 asks live in one conversation: the last model call saw the first (checked inside R12's script).
  assert.equal(state.works.filter(w=>w.status==='Done').length,12);
  // One approval executes the memory fact through the same exact-approval path as before.
  const memory=state.proposals[0];await host.approve(memory.id,memory.revision,memory.digest);
  assert.equal((await host.snapshot()).memory[0].text,'The captain prefers tea.');
  if(process.env.PIP_REPLAY_OUT)await writeFile(process.env.PIP_REPLAY_OUT,JSON.stringify(transcript,null,1));
 }finally{await host.close();}
});
