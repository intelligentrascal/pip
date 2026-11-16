import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fauxAssistantMessage, fauxText } from '@earendil-works/pi-ai';
import { openHost, type Host } from '../runtime/pi-durable-adapter.js';
import { asked, outwardKind } from '../runtime/pause.js';
import { fauxEngine, said, calls } from './helpers/faux-engine.js';
import { testHome, until, finished } from './helpers/ask.js';

// Intent: ELF-56 piece 2, the captain's choice "your ask is the approval; Pip pauses only before sending, paying, publishing
// or deleting that you did not ask for". Source: the plan card and the captain's answer on the advice card.
const message={channel:'email',to:'bookings@tasca.example',subject:'Booking',text:'Table for two on Saturday at 8.'};

test('the captain\'s own words ask for a step; a page\'s words never do',()=>{
 const asks:[Parameters<typeof asked>[0],string][]=[
  ['send','Send Ana a message that I will be ten minutes late'],['send','Email Ana the plan for Saturday'],['send','I need to email the landlord about the lease'],['send','Summarise this and then text me the key points'],['send','Read this document, then send a WhatsApp message to Aminaz'],
  ['pay','Pay the electricity bill with my saved card'],['pay','Book the 8pm table for two'],['publish','Post this thank-you note on the team page'],
  ['delete','Delete the old draft called Lisbon v1'],['delete','Cancel my gym membership'],
 ];
 for(const [kind,request] of asks)assert.equal(asked(kind,request),true,request);
 const notAsks:[Parameters<typeof asked>[0],string][]=[
  ['send','Summarise this booking page for me'],['send','Rewrite this email so it is shorter and friendlier'],['pay','What is the best noise-cancelling headphone this year?'],
  ['publish','Plan a food weekend in Lisbon for two'],['delete','Open Reminders'],['send','Research vegetarian tascas in Alfama'],['send','Draft an email to Ana about Saturday'],['send','Convert this page to text'],
 ];
 for(const [kind,request] of notAsks)assert.equal(asked(kind,request),false,request);
 assert.deepEqual(['send_message','make_payment','publish_content','delete_item','read_public_url','copy_to_clipboard','toString'].map(outwardKind),['send','pay','publish','delete',undefined,undefined,undefined]);
});

/** One host whose Mac is a stand-in: it records each effect it is handed and confirms it when told to. */
async function setup(options:{limits?:{milliseconds?:number};confirm?:boolean}={}) {
 const home=await testHome('pip-pause-');const {faux,engine}=fauxEngine();
 const natives:{id:string;status:string;action:{type:string;[k:string]:unknown}}[]=[];
 const host:Host=await openHost({home,fixture:true,engine,retry:{maxRetries:0},...(options.limits?{limits:options.limits}:{}),native:p=>{natives.push(p as never);if(options.confirm!==false)setTimeout(()=>void host.receipt(p.id,'succeeded','Sent on the stand-in Mac.'),1);}});
 return {home,faux,host,natives};
}
const pausedStep=async(host:Host)=>(await until(host,s=>s.proposals.some(p=>p.action.type==='step.pause'&&p.status==='proposed'))).proposals.find(p=>p.action.type==='step.pause')!;

test('a send the captain asked for runs at once with no pause',async()=>{
 const {faux,host,natives}=await setup();
 try{
  faux.setResponses([calls(['send_message',message]),said('I emailed the tasca.')]);
  await host.submit('a','Email the tasca at bookings@tasca.example to book a table for two on Saturday at 8');
  const state=await until(host,finished('a'));
  assert.equal(state.works[0].status,'Done');assert.equal(state.works[0].result?.text,'I emailed the tasca.');
  assert.deepEqual(state.proposals.map(p=>[p.action.type,p.status]),[['message.send','succeeded']],'only the effect is in the ledger, no pause');
  assert.deepEqual(natives.map(n=>[n.action.type,n.status]),[['message.send','intent-recorded']],'the intent was recorded before the Mac was asked');
 }finally{await host.close();}
});

test('a send nobody asked for pauses before anything is sent, and Allow lets the same call go ahead',async()=>{
 const {faux,host,natives}=await setup();
 try{
  faux.setResponses([calls(['send_message',message]),said('The booking went to the tasca.')]);
  await host.submit('a','Summarise the tasca page for me');
  const pause=await pausedStep(host);
  assert.equal(pause.action.type==='step.pause'&&pause.action.kind,'send');
  assert.match(pause.action.type==='step.pause'?pause.action.details:'',/bookings@tasca\.example/,'the captain sees exactly what would be sent');
  assert.equal(natives.length,0,'nothing was sent while paused');
  assert.equal((await host.snapshot()).works[0].status,'Working');
  await host.approve(pause.id,pause.revision,pause.digest);
  const state=await until(host,finished('a'));
  assert.equal(state.works[0].status,'Done');
  assert.deepEqual(natives.map(n=>n.action.type),['message.send'],'it went out once, after Allow');
  assert.deepEqual(state.proposals.map(p=>[p.action.type,p.status]),[['step.pause','succeeded'],['message.send','succeeded']]);
 }finally{await host.close();}
});

test('Skip tells the model the step was not allowed and nothing is sent',async()=>{
 const {faux,host,natives}=await setup();
 let told='';
 try{
  faux.setResponses([calls(['make_payment',{payee:'Booking Co',amount:'96',currency:'EUR'}]),ctx=>{told=JSON.stringify(ctx.messages.at(-1));return fauxAssistantMessage([fauxText('I skipped the payment.')]);}]);
  await host.submit('a','What would one night in Alfama cost?');
  const pause=await pausedStep(host);await host.cancel(pause.id);
  const state=await until(host,finished('a'));
  assert.equal(state.works[0].result?.text,'I skipped the payment.');
  assert.match(told,/chose not to allow/);assert.equal(natives.length,0);
  assert.deepEqual(state.proposals.map(p=>p.status),['cancelled']);
 }finally{await host.close();}
});

test('Stop ends a pause, cancels it, and a late Allow can no longer send anything',async()=>{
 const {faux,host,natives}=await setup();
 try{
  faux.setResponses([calls(['delete_item',{target:'Lisbon v1'}]),said('Deleted.')]);
  await host.submit('a','Tidy up my notes');
  const pause=await pausedStep(host);
  await host.stop();
  const state=await until(host,finished('a'));
  assert.equal(state.works[0].status,'Stopped');assert.equal(state.proposals[0].status,'cancelled');
  await assert.rejects(host.approve(pause.id,pause.revision,pause.digest),/stale|over/);
  assert.equal(natives.length,0);
 }finally{await host.close();}
});

test('the ten-minute limit ends a pause nobody answers (shortened here to a fraction of a second)',async()=>{
 const {faux,host,natives}=await setup({limits:{milliseconds:400}});
 try{
  faux.setResponses([calls(['publish_content',{destination:'team page',text:'Hello'}]),said('Published.')]);
  await host.submit('a','Look at the team page');
  const state=await until(host,finished('a'),5000);
  assert.equal(state.works[0].status,'Interrupted');assert.match(state.works[0].error,/time boundary/);
  assert.equal(state.proposals[0].status,'cancelled');assert.equal(natives.length,0);
 }finally{await host.close();}
});

test('a pause left open when Pip quits is cancelled on the next start and never resumes by itself',async()=>{
 const {home,faux,host}=await setup();
 faux.setResponses([calls(['send_message',message]),said('Sent.')]);
 await host.submit('a','Summarise the page');await pausedStep(host);
 await host.close();
 const again=fauxEngine();const natives:unknown[]=[];
 const reopened=await openHost({home,fixture:true,engine:again.engine,native:p=>natives.push(p)});
 try{
  const state=await reopened.snapshot();
  assert.equal(state.proposals[0].status,'cancelled');assert.equal(state.works[0].status,'Interrupted');
  assert.equal(natives.length,0);assert.equal(again.faux.state.callCount,0);
 }finally{await reopened.close();}
});

test('a step the Mac never confirms is Unknown and is not repeated; the model is told not to retry',async()=>{
 const {faux,host,natives}=await setup({confirm:false});
 let told='';
 try{
  faux.setResponses([calls(['send_message',message]),ctx=>{told=JSON.stringify(ctx.messages.at(-1));return said('I cannot confirm it.');}]);
  await host.submit('a','Send the tasca a booking request for Saturday');
  await until(host,s=>natives.length===1);
  await host.receipt(natives[0].id,'unknown','I can’t confirm it happened.');
  const state=await until(host,finished('a'));
  assert.equal(state.proposals[0].status,'unknown');assert.match(told,/Do not try it again/);assert.equal(natives.length,1);
 }finally{await host.close();}
});

test('the page cannot make Pip hold a step itself',async()=>{
 const {host}=await setup();
 try{await assert.rejects(host.propose({type:'step.pause',tool:'send_message',kind:'send',summary:'x',details:'x'}),/pause rule/);}
 finally{await host.close();}
});
