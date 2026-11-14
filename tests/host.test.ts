import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openHost, type Host } from '../runtime/pi-durable-adapter.js';
import { initialState, propose, approve, validateAction, type Result, type Proposal } from '../runtime/domain.js';
import { publicAddress, resolvePublic } from '../runtime/public-web.js';
import { claudeProvider } from '../runtime/claude.js';

const base=process.env.PIP_TEST_ROOT??path.join(os.tmpdir(),'pip-unit-fixtures');
async function fixture() {await mkdir(base,{recursive:true});const home=await mkdtemp(path.join(base,'pip-'));await writeFile(path.join(home,'.pip-test-home'),'pip-test-only');return home;}
async function until(host:Host, predicate:(s:Awaited<ReturnType<Host['snapshot']>>)=>boolean) {const deadline=Date.now()+5000;while(Date.now()<deadline){const state=await host.snapshot();if(predicate(state))return state;await new Promise(resolve=>setImmediate(resolve));}throw new Error('Expected committed state did not arrive');}
const draft:Result={kind:'draft',title:'A warmer version',text:'Could you send the notes over today when you have a moment? Thank you.',sources:[],model:'Fixture transport — not Claude',sessionId:'fixture-rewrite'};

test('A8/A9 exact approval owns stale, denied, duplicate and revision binding',()=>{
 const s=initialState();const p=propose(s,{type:'memory.save',text:'I prefer concise replies.',source:'Explicit Remember form'});
 assert.equal(s.memory.length,0);
 assert.throws(()=>approve(s,p.id,2,p.digest),/stale/);
 assert.throws(()=>approve(s,p.id,1,'changed'),/stale/);
 approve(s,p.id,1,p.digest);assert.equal(s.memory[0].text,'I prefer concise replies.');assert.equal(s.memory[0].source,'Explicit Remember form');
 assert.throws(()=>approve(s,p.id,1,p.digest),/already/);
 const old=propose(s,{type:'memory.edit',memoryId:p.id,revision:1,text:'I prefer concise replies with sources.'});
 const edit=propose(s,{type:'memory.edit',memoryId:p.id,revision:1,text:'I prefer concise replies in English.'});
 approve(s,edit.id,1,edit.digest);assert.equal(s.memory[0].revision,2);
 assert.throws(()=>approve(s,old.id,1,old.digest),/changed/);
 const forget=propose(s,{type:'memory.forget',memoryId:p.id,revision:2});approve(s,forget.id,1,forget.digest);assert.equal(s.memory[0].active,false);
 const cancelled=propose(s,{type:'memory.save',text:'Tea, please.',source:'Explicit Remember form'});cancelled.status='cancelled';assert.throws(()=>approve(s,cancelled.id,1,cancelled.digest),/stale/);
});

test('A4/A6/A19 reject coding, undeclared fields and private web endpoints at the interface',async()=>{
 for(const action of [{type:'shell',command:'echo hello'},{type:'app.open',bundleId:'com.apple.Terminal'},{type:'memory.save',text:'Tea',source:'page',execute:true},{type:'url.open',url:'file:///etc/passwd'}])assert.throws(()=>validateAction(action));
 for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.2.1','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1','2001:db8::1'])assert.equal(publicAddress(address),false,address);
 assert.equal(publicAddress('93.184.216.34'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
 await assert.rejects(resolvePublic('https://127.0.0.1/'),/public hostname/);
 await assert.rejects(resolvePublic('https://localhost/'),/Local/);
 await assert.rejects(resolvePublic('https://example.com:8443/'),/public HTTPS/);
});

test('A13 real pi-durable SQLite reopen, single writer and approved memory persistence',async()=>{
 const home=await fixture();let host=await openHost({home,fixture:true});
 try {
  assert.deepEqual(host.durability,{journal:'wal',synchronous:2});
  await assert.rejects(openHost({home,fixture:true}),/held by another/);
  const p=await host.propose({type:'memory.save',text:'I prefer concise replies.',source:'Explicit Remember form'});
  await host.approve(p.id,p.revision,p.digest);await host.saveComposer('Help me plan tomorrow.');
  await host.close();host=await openHost({home,fixture:true});
  const s=await host.snapshot();assert.equal(s.memory[0].text,'I prefer concise replies.');assert.equal(s.composer,'Help me plan tomorrow.');assert.equal(s.proposals[0].status,'succeeded');
 } finally {await host.close();}
 await assert.rejects(openHost({home:base,fixture:true}),/ENOENT/);
 await assert.rejects(openHost({home:path.join(os.homedir(),'Library/Application Support/Pip'),fixture:true}),/production/);
});

test('A14 persist intent before native dispatch; unknown effects never replay on reopen',async()=>{
 const home=await fixture();let effects:Proposal[]=[];let host=await openHost({home,fixture:true,native:p=>effects.push(p)});
 const p=await host.propose({type:'clipboard.copy',text:draft.text});await host.approve(p.id,p.revision,p.digest);
 assert.equal((await host.snapshot()).proposals[0].status,'intent-recorded');assert.equal(effects.length,1);
 await assert.rejects(host.approve(p.id,p.revision,p.digest),/already/);
 await host.close();effects=[];host=await openHost({home,fixture:true,native:p=>effects.push(p)});
 try {assert.equal((await host.snapshot()).proposals[0].status,'unknown');assert.equal(effects.length,0);await assert.rejects(host.approve(p.id,p.revision,p.digest),/already/);}finally{await host.close();}
});

test('A3/A7 work identity, queue responsiveness and Stop use a fixture, never an account',async()=>{
 const home=await fixture();let release!:(r:Result)=>void;let calls=0;
 const host=await openHost({home,fixture:true,provider:async(_request,_memory,signal)=>{calls++;return new Promise((resolve,reject)=>{release=resolve;signal.addEventListener('abort',()=>reject(new Error('Stopped')),{once:true});});}});
 try{
  await host.submit('rewrite-notes','Give me a warmer version of: Can you send the notes today?');await until(host,s=>s.works[0]?.status==='Working');
  await host.submit('research-pi','Compare the official pi-durable README and DeepSeek prototype philosophy.');
  assert.equal((await host.snapshot()).works[1].status,'Queued');assert.equal(calls,1);
  release(draft);await until(host,s=>s.works[0].status==='Done'&&s.works[1].status==='Working');
  assert.equal((await host.snapshot()).works[0].result?.text,draft.text);
  await host.submit('rewrite-notes','Duplicate intake must preserve the original request.');assert.equal((await host.snapshot()).works.length,2);
  await host.stop();assert.equal((await host.snapshot()).works[1].status,'Stopped');
 } finally {await host.close();}
});

// Intent: V1-SPEC persists the request/session mapping before its first model call.
test('A13 model identity is committed before the provider receives the request',async()=>{
 const home=await fixture();let host:Host;let observed:any;
 host=await openHost({home,fixture:true,provider:async(...args:any[])=>{
  const work=(await host.snapshot()).works.find(w=>w.id==='rewrite-identity');
  observed={context:args[3],work};return {...draft,sessionId:args[3]?.sessionId??'unmapped-fixture'};
 }});
 try{
  await host.submit('rewrite-identity','Give me a warmer version of: Can you send the notes today?');
  await until(host,s=>s.works[0]?.status==='Done');
  assert.equal(typeof observed.context?.sessionId,'string');
  assert.match(observed.context.sessionId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(observed.work.sessionId,observed.context.sessionId);
 }finally{await host.close();}
});

// Intent: V1-SPEC selected-result follow-ups go to that work's context, including after restart.
test('A3/A13 selected-result follow-up survives restart with an immutable context snapshot',async()=>{
 const home=await fixture();let seen:any;
 let host=await openHost({home,fixture:true,provider:async()=>draft});
 await host.submit('notes-draft','Give me a warmer version of: Can you send the notes today?');
 await until(host,s=>s.works[0]?.status==='Done');await host.close();
 host=await openHost({home,fixture:true,provider:async(...args:any[])=>{seen=args[3];return {...draft,text:'Could you send the notes today? Thank you.',sessionId:args[3]?.sessionId??'unmapped-fixture'};}});
 try{
  await host.submit('shorter-notes','Make it shorter.','notes-draft');
  await host.saveDraft('notes-draft','A separate later edit should not change the submitted follow-up context.');
  const state=await until(host,s=>s.works[1]?.status==='Done');
  assert.equal(seen?.context?.workId,'notes-draft');
  assert.equal(seen.context.result.text,draft.text);
  assert.equal((state.works[1] as any).context.result.text,draft.text);
  assert.equal((state.works[1] as any).threadId,'notes-draft');
  await assert.rejects(host.submit('bad-context','Make it shorter.','missing-result'),/result/);
 }finally{await host.close();}
});

test('A3/A20 disabled Claude never calls the SDK and keeps the useful input',async()=>{
 await assert.rejects(claudeProvider(false,'/not-a-client')('Write a thank-you note.',[],new AbortController().signal),/not connected/);
 const home=await fixture();const host=await openHost({home,fixture:true});
 try {await host.submit('thank-you','Write a thank-you note.');const s=await until(host,s=>s.works[0]?.status==='Could not finish');assert.equal(s.works[0].request,'Write a thank-you note.');assert.match(s.works[0].error,/not connected/);assert.equal(s.works[0].result,null);}finally{await host.close();}
});
