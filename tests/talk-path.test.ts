import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fauxAssistantMessage, fauxText } from '@earendil-works/pi-ai';
import { openHost, type ConversationMessage } from '../runtime/pi-durable-adapter.js';
import { fauxEngine, said, calls, held } from './helpers/faux-engine.js';
import { testHome, until, finished } from './helpers/ask.js';
import { screenFixture } from './helpers/screen-context.js';

// Intent: ELF-56 — Pip's asks are one pi-durable conversation whose streaming events survive restarts.
const entryTexts=(snapshot:any)=>JSON.stringify(snapshot.entries);

test('the conversation streams a snapshot and then one batch of events per commit, in order',async()=>{
 const home=await testHome('pip-talk-');const {faux,engine}=fauxEngine();
 faux.setResponses([calls(['propose_action',{action:{type:'clipboard.copy',text:'Tea, please.'}}]),fauxAssistantMessage([fauxText('Prepared. '.repeat(30))])]);
 const messages:ConversationMessage[]=[];
 const host=await openHost({home,fixture:true,engine,events:m=>messages.push(m)});
 try{
  await host.submit('a','Copy a note for me.');await until(host,finished('a'));
  assert.ok('snapshot' in messages[0],'the first message is the snapshot a page draws before any event');
  assert.equal(messages.slice(1).every(m=>'events' in m&&m.events.length>0),true);
  const types=messages.slice(1).flatMap(m=>'events' in m?m.events.map((e:any)=>e.type as string):[]);
  for(const wanted of ['message_start','tool_execution_start','tool_execution_end','message_end','run_start'])assert.ok(types.includes(wanted),wanted+' is streamed');
  assert.ok(types.indexOf('tool_execution_start')<types.indexOf('tool_execution_end'));
  // The reply a person reads is in the events themselves, not only in the saved result.
  assert.match(JSON.stringify(messages),/Prepared\. Prepared\./);
  // No event is sent after the host closed.
  const count=messages.length;await host.close();await new Promise(r=>setTimeout(r,50));assert.equal(messages.length,count);
 }finally{await host.close();}
});

test('after a restart the stream starts again from a fresh snapshot holding the whole earlier transcript',async()=>{
 const home=await testHome('pip-talk-');const a=fauxEngine();a.faux.setResponses([said('Hello there.')]);
 let host=await openHost({home,fixture:true,engine:a.engine});
 await host.submit('a','hi');await until(host,finished('a'));await host.close();
 const messages:ConversationMessage[]=[];const b=fauxEngine();
 host=await openHost({home,fixture:true,engine:b.engine,events:m=>messages.push(m)});
 try{
  const first=messages[0] as {snapshot:unknown};assert.ok('snapshot' in first);
  const text=entryTexts(first.snapshot);assert.match(text,/"content":"hi"/);assert.match(text,/Hello there\./);
  assert.equal(messages.slice(1).some(m=>'events' in m&&JSON.stringify(m).includes('Hello there.')),false,'the old answer is not replayed as new events');
  assert.equal(b.faux.state.callCount,0,'reopening asks the model nothing');
 }finally{await host.close();}
});

test('one conversation: a later ask sees every earlier ask without being linked to it, also after restart',async()=>{
 const home=await testHome('pip-talk-');const a=fauxEngine();a.faux.setResponses([said('Noted: tea.'),said('Noted: oat milk.')]);
 let host=await openHost({home,fixture:true,engine:a.engine});
 await host.submit('one','I like tea.');await until(host,finished('one'));
 await host.submit('two','And oat milk.');await until(host,finished('two'));await host.close();
 const b=fauxEngine();let seen='';b.faux.setResponses([ctx=>{seen=JSON.stringify(ctx.messages);return fauxAssistantMessage('Tea with oat milk.');}]);
 host=await openHost({home,fixture:true,engine:b.engine});
 try{
  await host.submit('three','What do I like?');const state=await until(host,finished('three'));
  for(const needle of ['I like tea.','Noted: tea.','And oat milk.','Noted: oat milk.','What do I like?'])assert.ok(seen.includes(needle),needle);
  assert.equal(state.works.find(w=>w.id==='three')!.context,undefined,'no selected result was needed');
  assert.ok(seen.indexOf('I like tea.')<seen.indexOf('And oat milk.')&&seen.indexOf('And oat milk.')<seen.indexOf('What do I like?'),'in order');
 }finally{await host.close();}
});

test('window pixels reach the model for one request only and never appear in the streamed events',async()=>{
 const home=await testHome('pip-talk-');const {faux,engine}=fauxEngine();const image=await screenFixture();
 const requests:string[]=[];faux.setResponses([ctx=>{requests.push(JSON.stringify(ctx.messages));return fauxAssistantMessage('I see it.');},ctx=>{requests.push(JSON.stringify(ctx.messages));return fauxAssistantMessage('Nothing shared now.');}]);
 const messages:ConversationMessage[]=[];
 const host=await openHost({home,fixture:true,engine,events:m=>messages.push(m)});
 try{
  if(image.content.type!=='image')throw Error('image fixture required');
  const needle=image.content.data.slice(200,400);
  await host.submit('with','Look at this window.',undefined,await host.attachScreenContext(image));await until(host,finished('with'));
  await host.submit('without','And now?');await until(host,finished('without'));
  assert.ok(requests[0].includes(needle),'the shared window reaches the first request');
  assert.equal(requests[1].includes(needle),false,'it is not carried into the next request of the same conversation');
  assert.equal(JSON.stringify(messages).includes(needle),false,'it is not streamed to the page either');
 }finally{await host.close();}
});

test('Stop ends the running ask and the conversation answers the next ask',async()=>{
 const home=await testHome('pip-talk-');const {faux,engine}=fauxEngine();
 const hold=held();faux.setResponses([hold.step,said('Back again.')]);
 const host=await openHost({home,fixture:true,engine});
 try{
  await host.submit('slow','Think for a long time.');await hold.entered;await host.stop();
  assert.equal((await until(host,finished('slow'))).works[0].status,'Stopped');
  await host.submit('next','Are you there?');const state=await until(host,finished('next'));
  assert.equal(state.works.find(w=>w.id==='next')!.result?.text,'Back again.');
 }finally{await host.close();}
});

test('the service hands the page the conversation stream from its first message',{timeout:20000},async()=>{
 const home=await testHome('pip-service-');
 const service=spawn(process.execPath,['--import','tsx','runtime/service.ts'],{env:{...process.env,PIP_HOME:home,PIP_TEST:'1'},stdio:['pipe','pipe','pipe']});
 let stderr='';service.stderr.on('data',d=>{stderr+=d;});
 const lines=createInterface({input:service.stdout});
 const first=new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('No conversation message: '+stderr)),15000);lines.on('line',line=>{const m=JSON.parse(line);if(m.kind==='conversation'){clearTimeout(timer);resolve(m);}});});
 const exit=new Promise<number|null>(resolve=>service.once('exit',resolve));
 try{const m=await first;assert.equal(m.version,1);assert.equal(m.payload.snapshot.type,'snapshot');assert.deepEqual(m.payload.snapshot.entries,[]);}
 finally{service.stdin.end();assert.equal(await exit,0,stderr);}
});
