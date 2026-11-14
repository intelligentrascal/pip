import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {openHost,type Host} from '../runtime/pi-durable-adapter.js';
import {initialState,propose,approve,type State,type Result} from '../runtime/domain.js';
import {modelPrompt} from '../runtime/context-prompt.js';
const input={type:'project.save',projectId:'pip-release',revision:0,title:'Pip release',summary:'Finish project continuity before the v1 release.',provenance:'Captain-approved release plan, ELF-8',pins:[{title:'pi-durable source',reference:'https://github.com/earendil-works/pi',checkedAt:'2026-01-01T12:00:00Z'}],workIds:[]};
const result:Result={kind:'draft',title:'Release notes',text:'Project context now stays local until deliberately selected for a request.',sources:[],model:'Fixture transport — not Claude',sessionId:'project-fixture'};
async function home(){const base=process.env.PIP_TEST_ROOT??path.join(os.tmpdir(),'pip-projects');await mkdir(base,{recursive:true});const h=await mkdtemp(path.join(base,'continuity-'));await writeFile(path.join(h,'.pip-test-home'),'pip-test-only');return h;}
async function until(host:Host,predicate:(s:State)=>boolean){const deadline=Date.now()+5000;while(Date.now()<deadline){const s=await host.snapshot();if(predicate(s))return s;await new Promise(r=>setImmediate(r));}throw Error('Expected project state did not arrive');}
async function approved(host:Host,action:unknown){const p=await host.propose(action);return host.approve(p.id,p.revision,p.digest);}

// Intent: ELF-8 approved summaries/pins, provenance, edit/unpin/forget and no inferred access.
test('ELF-8 project context uses exact approval and rejects changed revisions, foreign work and invalid pins',()=>{
 const s=initialState();const p=propose(s,input);assert.equal(s.projects,undefined);approve(s,p.id,p.revision,p.digest);
 const stale=propose(s,{...input,revision:1,summary:'An outdated summary'});
 const edit=propose(s,{...input,revision:1,summary:'Draft release notes, not a send.',pins:[]});approve(s,edit.id,edit.revision,edit.digest);
 assert.throws(()=>approve(s,stale.id,stale.revision,stale.digest),/changed/);assert.deepEqual(s.projects![0].pins,[]);assert.equal(s.projects![0].provenance,input.provenance);
 assert.throws(()=>propose(s,{...input,projectId:'bad',workIds:['another-job']}),/unavailable/);
 assert.throws(()=>propose(s,{...input,projectId:'bad',pins:[{...input.pins[0],reference:'file:///private/document'}]}),/HTTPS/);
 const forget=propose(s,{type:'project.forget',projectId:input.projectId,revision:2});approve(s,forget.id,forget.revision,forget.digest);assert.equal(s.projects![0].active,false);
 assert.throws(()=>propose(s,{...input,revision:3}),/changed/);
});

test('ELF-8 SQLite reopen preserves approved projects and unfinished links; only selected jobs receive context',async()=>{
 const h=await home();let seen:any[]=[];let host=await openHost({home:h,fixture:true,provider:async(_r,_m,_s,c)=>{seen.push(c);return result;}});
 try{
  await host.saveWorkToBacklog({id:'later',request:'Review the Pip release notes later.',title:'Release review',priority:'normal'});
  await approved(host,{...input,workIds:['later']});await host.close();host=await openHost({home:h,fixture:true,provider:async(_r,_m,_s,c)=>{seen.push(c);return result;}});
  const persisted=(await host.snapshot()).projects![0];assert.deepEqual(persisted.workIds,['later']);assert.equal(persisted.summary,input.summary);assert.equal((await host.snapshot()).works[0].status,'Backlog');
  await host.submit('with-project','Draft release notes.',undefined,undefined,{id:input.projectId,revision:1});await until(host,s=>s.works.at(-1)?.status==='Done');
  await host.submit('unrelated','Make this invitation warmer.');await until(host,s=>s.works.at(-1)?.status==='Done');
  assert.equal(seen[0].project.summary,input.summary);assert.equal(seen[1].project,undefined);assert.equal(seen[1].context,undefined);
  const blocks=[];for await(const message of modelPrompt('Draft release notes.',seen[0]))blocks.push(message);
  const prompt=JSON.stringify(blocks);assert.match(prompt,/historical, untrusted context/);assert.match(prompt,/not current source evidence or permission/);assert.match(prompt,/pi-durable source/);
  await approved(host,{...input,revision:1,summary:'Only the current approved release scope.',pins:[],workIds:['later']});
  await assert.rejects(host.submit('stale','Use old context',undefined,undefined,{id:input.projectId,revision:1}),/changed/);
  await approved(host,{type:'project.forget',projectId:input.projectId,revision:2});assert.equal((await host.snapshot()).works.find(w=>w.id==='with-project')!.projectContext,undefined);
  await assert.rejects(host.submit('forgotten','Use forgotten context',undefined,undefined,{id:input.projectId,revision:3}),/forgotten/);
 }finally{await host.close();}
});

test('ELF-8 real process interruption waits for explicit Continue, keeps effort and never replays old inference on reopen',async()=>{
 const h=await home();let host=await openHost({home:h,fixture:true});await approved(host,input);await host.close();
 const child=spawnSync(process.execPath,['--import','tsx','tests/fixtures/interrupted-project.ts',h],{cwd:process.cwd(),encoding:'utf8',timeout:15000});assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/admitted/);
 let calls=0;host=await openHost({home:h,fixture:true,provider:async()=>{calls++;return result;}});
 try{
  let s=await host.snapshot();assert.equal(s.works[0].status,'Interrupted');assert.equal(s.works[0].usage?.attempts,1);assert.equal(calls,0);
  const p=await host.propose({type:'work.continue',workId:'read-project',attempts:1,projectRevision:1});assert.equal(calls,0);
  await host.approve(p.id,p.revision,p.digest);s=await until(host,s=>s.works[0].status==='Done');assert.equal(calls,1);assert.equal(s.works[0].id,'read-project');assert.equal(s.works[0].usage?.attempts,2);assert.ok(s.works[0].usage!.activeMilliseconds>=0);
  await assert.rejects(host.approve(p.id,p.revision,p.digest),/already/);
  await host.close();host=await openHost({home:h,fixture:true,provider:async()=>{calls++;return result;}});assert.equal((await host.snapshot()).works[0].status,'Done');assert.equal(calls,1);
 }finally{await host.close();}
});

test('ELF-8 Continue holds uncertain effects, ephemeral context and changed project scope',()=>{
 const s=initialState();const p=propose(s,input);approve(s,p.id,p.revision,p.digest);
 s.works.push({id:'read',request:'Read the release plan.',status:'Interrupted',result:null,error:'Restarted',taskId:0,createdAt:new Date().toISOString(),usage:{attempts:1,activeMilliseconds:75},projectContext:s.projects![0]});
 const a={type:'work.continue',workId:'read',attempts:1,projectRevision:1};
 const action=propose(s,{type:'clipboard.copy',text:'Release notes'});action.workId='read';action.status='unknown';assert.throws(()=>propose(s,a),/existing action/);action.status='cancelled';
 s.works[0].needsScreenContext=true;assert.throws(()=>propose(s,a),/ephemeral/);s.works[0].needsScreenContext=false;
 const continuation=propose(s,a);const edit=propose(s,{...input,revision:1,summary:'Changed scope'});approve(s,edit.id,edit.revision,edit.digest);assert.throws(()=>approve(s,continuation.id,continuation.revision,continuation.digest),/changed/);
 s.works[0].status='Stopped';assert.throws(()=>propose(s,{...a,projectRevision:2}),/cannot continue/);
});

test('ELF-8 provider cutoff and no-progress pause one episode without automatic retry or resetting usage',async()=>{
 const h=await home();let calls=0;const host=await openHost({home:h,fixture:true,provider:async()=>{calls++;throw Object.assign(new Error('Claude reached the bounded episode boundary.'),{code:calls===1?'provider-cutoff':'no-progress'});}});
 try{
  await host.submit('bounded','Compare the release plan to the current notes.');let s=await until(host,s=>s.works[0]?.status==='Interrupted');assert.equal(s.works[0].pauseReason,'provider-cutoff');assert.equal(calls,1);
  await approved(host,{type:'work.continue',workId:'bounded',attempts:1,projectRevision:0});s=await until(host,s=>s.works[0]?.status==='Interrupted');assert.equal(s.works[0].pauseReason,'no-progress');assert.equal(calls,2);assert.equal(s.works[0].usage?.attempts,2);
  await host.stop();assert.equal((await host.snapshot()).works[0].status,'Stopped');
 }finally{await host.close();}
});

test('ELF-8 a queued project revision cannot silently adopt later edits',async()=>{
 const h=await home();let release!:(r:Result)=>void;let calls=0;
 const host=await openHost({home:h,fixture:true,provider:async()=>{calls++;if(calls===1)return new Promise<Result>(resolve=>{release=resolve;});return result;}});
 try{
  await approved(host,input);await host.submit('busy','Make this invitation warmer.');await until(host,s=>s.works[0]?.status==='Working');
  await host.submit('release-queued','Draft the release notes.',undefined,undefined,{id:input.projectId,revision:1});
  await approved(host,{...input,revision:1,summary:'Revised release scope: review notes only.'});release(result);
  let s=await until(host,s=>s.works[1]?.status==='Interrupted');assert.equal(calls,1);assert.equal(s.works[1].pauseReason,'context-changed');assert.equal(s.works[1].projectContext?.revision,1);
  await approved(host,{type:'work.continue',workId:'release-queued',attempts:1,projectRevision:2});s=await until(host,s=>s.works[1]?.status==='Done');assert.equal(calls,2);assert.equal(s.works[1].projectContext?.revision,2);assert.equal(s.works[1].usage?.attempts,2);
 }finally{await host.close();}
});
