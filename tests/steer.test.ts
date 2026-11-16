import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openHost } from '../runtime/pi-durable-adapter.js';
import { fauxEngine, said, calls, held } from './helpers/faux-engine.js';
import { testHome, until, finished } from './helpers/ask.js';
import type { Message } from '@earendil-works/pi-ai';

// Intent: the captain's ask "steering Pip mid-task: typing while he works, Return redirects without stopping him" (ELF-65 spec, built in
// the Steer box task). Pip's engine steers natively (pi-durable `whenBusy: 'steer'`), so a steer must join the run that is working, never
// start another, and its words count as the captain's own words for the pause rule. Fixture: pi-ai's scripted model, a real host and home.
const texts=(messages:Message[])=>messages.flatMap(m=>m.role==='user'?[typeof m.content==='string'?m.content:m.content.filter(b=>b.type==='text').map(b=>(b as {text:string}).text).join('')]:[]);

test('a steer joins the working run: one ask, one answer, and the model sees the new words',async()=>{
 const home=await testHome('pip-steer-');const {faux,engine}=fauxEngine();
 const hold=held();const seen:Message[][]=[];
 faux.setResponses([hold.step,(context:{messages:Message[]})=>{seen.push(context.messages);return said('Friday: dentist at 11:00, two clear hours from 8:00.');}]);
 const host=await openHost({home,fixture:true,engine,retry:{maxRetries:0}});
 try{
  await host.submit('plan','Plan my Friday around the dentist.');await hold.entered;
  await host.steer('plan','Mornings only, please.');
  assert.equal((await host.snapshot()).works.find(w=>w.id==='plan')!.status,'Working','a steer does not stop Pip');
  hold.release('Friday looks open from 2 pm.');
  const state=await until(host,finished('plan'));
  assert.equal(state.works.length,1,'the steer is not a second ask');
  const work=state.works[0];
  assert.equal(work.status,'Done');
  assert.equal(work.result?.text,'Friday: dentist at 11:00, two clear hours from 8:00.','the answer is the one given after the steer');
  assert.deepEqual(work.steers?.map(s=>s.text),['Mornings only, please.'],'the steer is kept on the ask, in the captain\'s words');
  assert.ok(texts(seen[0]).some(t=>t.includes('Mornings only, please.')),'the model saw the steer in the same conversation');
 }finally{await host.close();}
});

test('steering is refused when that work is not running, and nothing is queued',async()=>{
 const home=await testHome('pip-steer-');const {faux,engine}=fauxEngine();
 faux.setResponses([said('Done.')]);
 const host=await openHost({home,fixture:true,engine,retry:{maxRetries:0}});
 try{
  await assert.rejects(host.steer('nothing','Mornings only.'),/not working on that/);
  await host.submit('a','Say hello.');await until(host,finished('a'));
  await assert.rejects(host.steer('a','Actually, say goodbye.'),/not working on that/);
  assert.equal((await host.snapshot()).works[0].steers,undefined);
 }finally{await host.close();}
});

test('a steer is a steer for its own ask only',async()=>{
 const home=await testHome('pip-steer-');const {faux,engine}=fauxEngine();
 const hold=held();faux.setResponses([hold.step,said('First done.'),said('Second done.')]);
 const host=await openHost({home,fixture:true,engine,retry:{maxRetries:0}});
 try{
  await host.submit('one','First.');await hold.entered;await host.submit('two','Second.');
  await assert.rejects(host.steer('two','Change the second.'),/not working on that/,'the second ask has not started, so it cannot be steered');
  hold.release('First answer.');await until(host,finished('two'));
 }finally{await host.close();}
});

test('words added by a steer count as asking for a step, so a send the steer asked for is not paused',async()=>{
 const home=await testHome('pip-steer-');const {faux,engine}=fauxEngine();
 const hold=held();const sent:string[]=[];
 const message={channel:'email',to:'ana@example.com',subject:'Friday',text:'Dinner is at 8.'};
 faux.setResponses([hold.step,calls(['send_message',message]),said('Sent.')]);
 const host=await openHost({home,fixture:true,engine,retry:{maxRetries:0},native:p=>{sent.push(p.action.type);setTimeout(()=>void host.receipt(p.id,'succeeded','Sent on the stand-in Mac.'),1);}});
 try{
  await host.submit('plan','Plan dinner for Friday.');await hold.entered;
  await host.steer('plan','Then send Ana the time.');
  hold.release('Dinner at 8 works.');
  const state=await until(host,finished('plan'));
  assert.equal(state.works[0].status,'Done');
  assert.deepEqual(sent,['message.send']);
  assert.equal(state.proposals.some(p=>p.action.type==='step.pause'),false,'the captain asked for the send in the steer, so there is no pause');
 }finally{await host.close();}
});

test('a steer cannot ask for what the captain never said: an unrelated steer still leaves a send paused',async()=>{
 const home=await testHome('pip-steer-');const {faux,engine}=fauxEngine();
 const hold=held();
 const message={channel:'email',to:'ana@example.com',subject:'Friday',text:'Dinner is at 8.'};
 faux.setResponses([hold.step,calls(['send_message',message]),said('Skipped.')]);
 const host=await openHost({home,fixture:true,engine,retry:{maxRetries:0}});
 try{
  await host.submit('plan','Plan dinner for Friday.');await hold.entered;
  await host.steer('plan','Make it a vegetarian place.');
  hold.release('Dinner at 8 works.');
  const state=await until(host,s=>s.proposals.some(p=>p.action.type==='step.pause'&&p.status==='proposed'));
  assert.equal(state.works[0].status,'Working');
  await host.cancel(state.proposals.find(p=>p.action.type==='step.pause')!.id);
  await until(host,finished('plan'));
 }finally{await host.close();}
});

test('Stop after a steer ends the ask instead of waiting for the steer',async()=>{
 const home=await testHome('pip-steer-');const {faux,engine}=fauxEngine();
 const hold=held();faux.setResponses([hold.step,said('Never reached.')]);
 const host=await openHost({home,fixture:true,engine,retry:{maxRetries:0}});
 try{
  await host.submit('plan','Plan my Friday.');await hold.entered;
  await host.steer('plan','Mornings only.');await host.stop();
  assert.equal((await until(host,finished('plan'))).works[0].status,'Stopped');
 }finally{await host.close();}
});

test('telling Pip instead at a paused step: the step is not sent and the steer redirects the same ask',async()=>{
 const home=await testHome('pip-steer-');const {faux,engine}=fauxEngine();
 const sent:string[]=[];const seen:Message[][]=[];
 const message={channel:'email',to:'ana@example.com',subject:'Friday',text:'Dinner is at 8.'};
 faux.setResponses([calls(['send_message',message]),(context:{messages:Message[]})=>{seen.push(context.messages);return said('I will leave Ana out and just plan the evening.');}]);
 const host=await openHost({home,fixture:true,engine,retry:{maxRetries:0},native:p=>{sent.push(p.action.type);}});
 try{
  await host.submit('plan','Plan dinner for Friday.');
  const pause=(await until(host,s=>s.proposals.some(p=>p.action.type==='step.pause'&&p.status==='proposed'))).proposals.find(p=>p.action.type==='step.pause')!;
  await host.cancel(pause.id);await host.steer('plan','Do not message anyone, just plan the evening.');
  const state=await until(host,finished('plan'));
  assert.equal(state.works.length,1);assert.equal(state.works[0].result?.text,'I will leave Ana out and just plan the evening.');
  assert.deepEqual(sent,[],'the paused send never reached the Mac');
  assert.deepEqual(state.works[0].steers?.map(x=>x.text),['Do not message anyone, just plan the evening.'],'kept on the ask');
  assert.ok(texts(seen[0]).includes('Do not message anyone, just plan the evening.'));
 }finally{await host.close();}
});
