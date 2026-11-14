import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {initialState,propose,currentSchema,type Work} from '../runtime/domain.js';
import {migrateTracker,saveFeedback,correctFeedback,trackerRecords} from '../runtime/tracker.js';
import {openHost} from '../runtime/pi-durable-adapter.js';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {Harness,defineDoc,createRegistry} from '@earendil-works/pi-durable';
import {createModels} from '@earendil-works/pi-ai/models';
import {openNodeSqliteDatabase} from '@earendil-works/pi-durable/storage/sqlite/node';
import {SqliteStorage} from '@earendil-works/pi-durable/storage/sqlite';
const request={id:'wrong-display',originalWords:'Pip opens on the wrong display',title:'Use the active display',kind:'bug' as const,priority:'normal' as const,reproduction:'Summon Pip while editing a document on the other display.'};

test('ELF-8 tracker migration preserves old work and does not invent a verified outcome',()=>{
 const s=initialState();
 const work:Work={id:'document-summary',request:'Read this document, then send a WhatsApp message to Aminaz',status:'Done',result:{kind:'draft',title:'Summary',text:'Here is the short summary for review.',sources:[],model:'Fixture transport',sessionId:'document-summary'},error:'',taskId:0,createdAt:'2026-11-06T12:00:00Z'};
 s.works.push(work);const original=structuredClone(work);
 migrateTracker(s);migrateTracker(s);assert.equal(s.schema,currentSchema);assert.deepEqual(s.works,[original]);assert.deepEqual(s.feedback,[]);
 assert.equal(trackerRecords(s,'work')[0].status,'Waiting on you');
 work.completion='result';work.goal='effect';assert.equal(trackerRecords(s,'work')[0].status,'Waiting on you');
 const summary={...work,id:'summary-only',request:'Give me a short summary of this document',goal:'result' as const};s.works.push(summary);
 assert.equal(trackerRecords(s,'work').find(r=>r.id===summary.id)!.status,'Done');
 s.works.pop();
 const p=propose(s,{type:'note.save',text:work.result!.text});p.workId=work.id;
 assert.equal(trackerRecords(s,'work')[0].status,'Waiting on you');
 p.status='unknown';assert.equal(trackerRecords(s,'work')[0].status,'Held/Unknown');
 p.status='failed-known';assert.equal(trackerRecords(s,'work')[0].status,'Blocked');
 s.schema=currentSchema+1;assert.throws(()=>migrateTracker(s),/Unsupported/);
});

test('ELF-8 explicit feedback save, replay, corrections and duplicates preserve provenance without starting work',()=>{
 const s=initialState();const f=saveFeedback(s,request);
 assert.equal(f.status,'Backlog');assert.equal(s.works.length,0);assert.equal(s.proposals.length,0);
 assert.equal(saveFeedback(s,request).id,f.id);assert.equal(s.feedback!.length,1);
 assert.throws(()=>saveFeedback(s,{...request,title:'Different'}),/already used/);
 saveFeedback(s,{...request,id:'display-again'});
 correctFeedback(s,f.id,1,{title:'Use the display where I summon Pip',reproduction:'Occurs with two displays.',note:'Added display count.',duplicateOf:'display-again'});
 assert.equal(f.originalWords,request.originalWords);assert.equal(f.history[0].title,request.title);assert.equal(f.history[0].reproduction,request.reproduction);assert.equal(f.history.length,2);assert.equal(f.duplicateOf,'display-again');
 assert.throws(()=>correctFeedback(s,f.id,1,{title:'Changed',reproduction:'',note:'Stale edit'}),/changed/);
 assert.throws(()=>correctFeedback(s,f.id,2,{title:'Changed',reproduction:'',note:'Self duplicate',duplicateOf:f.id}),/another/);
 assert.equal(trackerRecords(s,'about','two displays','Backlog').length,1);
 assert.equal(trackerRecords(s,'about','','Done').length,0);
 assert.equal(trackerRecords(s,'work').length,0);
});

test('ELF-8 old SQLite state migrates without losing composer, work, memory or receipts',async()=>{
 const base=process.env.PIP_TEST_ROOT??path.join(os.tmpdir(),'pip-unit-fixtures');await mkdir(base,{recursive:true});
 const home=await mkdtemp(path.join(base,'legacy-tracker-'));await writeFile(path.join(home,'.pip-test-home'),'pip-test-only');
 const legacy=initialState();legacy.composer='Give me a short summary to review.';
 legacy.works.push({id:'legacy-draft',request:'Write a warmer version of: Can you send the notes today?',status:'Done',result:{kind:'draft',title:'A warmer version',text:'Could you send the notes today when you have a moment?',sources:[],model:'Fixture transport',sessionId:'legacy-draft'},error:'',taskId:0,createdAt:'2026-11-06T12:00:00Z'});
 legacy.memory.push({id:'concise-replies',text:'I prefer concise replies.',source:'Explicit Remember form',revision:1,active:true,updatedAt:'2026-11-06T12:00:00Z'});
 const receipt=propose(legacy,{type:'clipboard.copy',text:legacy.works[0].result!.text});receipt.status='succeeded';receipt.receipt='Copied the approved draft';
 const doc=defineDoc({kind:'pip.state',version:1,scope:'session',initial:initialState,checkpointWhen:()=>true});
 const db=await openNodeSqliteDatabase(path.join(home,'pip.sqlite'));
 const storage=await SqliteStorage.open(db);
 const harness=await Harness.open(storage,{models:createModels(),registry:createRegistry()},context);
 await harness.root(context);await harness.commit(async tx=>Object.assign(await tx.doc(doc),legacy),context);await harness.close(context);
 const host=await openHost({home,fixture:true});
 try{
  assert.ok(host.migrationBackup);
  const backupDB=await openNodeSqliteDatabase(host.migrationBackup);const backupStorage=await SqliteStorage.open(backupDB);
  const backup=await Harness.open(backupStorage,{models:createModels(),registry:createRegistry()},context);
  try{await backup.root(context);const saved=await backup.snapshot(doc,context);assert.equal(saved!.schema,legacy.schema);assert.deepEqual(saved!.works,legacy.works);assert.deepEqual(saved!.memory,legacy.memory);}finally{await backup.close(context);}
  const migrated=await host.snapshot();assert.equal(migrated.schema,currentSchema);assert.equal(migrated.composer,legacy.composer);assert.deepEqual(migrated.works,legacy.works);assert.deepEqual(migrated.memory,legacy.memory);assert.deepEqual(migrated.proposals,legacy.proposals);assert.equal((await host.tracker('work'))[0].status,'Waiting on you');}
 finally{await host.close();}
});

test('ELF-8 saved delegated work stays Backlog without inference and survives restart',async()=>{
 const base=process.env.PIP_TEST_ROOT??path.join(os.tmpdir(),'pip-unit-fixtures');await mkdir(base,{recursive:true});
 const home=await mkdtemp(path.join(base,'work-backlog-'));await writeFile(path.join(home,'.pip-test-home'),'pip-test-only');
 let calls=0;const provider=async()=>{calls++;throw Error('Backlog must never call a provider');};
 let host=await openHost({home,fixture:true,provider});
 const input={id:'read-document-later',request:'Find this document and give me a short summary to review later.',title:'Summarise the document',priority:'normal' as const};
 try{
  await host.saveWorkToBacklog(input);await host.saveWorkToBacklog(input);
  assert.equal((await host.tracker('work','','Backlog')).length,1);assert.equal((await host.snapshot()).works[0].taskId,0);
  await assert.rejects(host.submit(input.id,input.request),/separate start/);
  await host.close();host=await openHost({home,fixture:true,provider});
  const work=(await host.snapshot()).works[0];assert.equal(work.status,'Backlog');assert.equal(work.request,input.request);assert.equal(work.title,input.title);assert.equal(work.history!.length,1);assert.equal(calls,0);
  await assert.rejects(host.saveFeedback({id:input.id,originalWords:'Pip opens on the wrong display',title:'Wrong display',kind:'bug',priority:'normal'}),/already used/);
 }finally{await host.close();}
});

test('ELF-8 Feedback shares the existing durable SQLite owner and survives reopen',async()=>{
 const base=process.env.PIP_TEST_ROOT??path.join(os.tmpdir(),'pip-unit-fixtures');await mkdir(base,{recursive:true});
 const home=await mkdtemp(path.join(base,'tracker-'));await writeFile(path.join(home,'.pip-test-home'),'pip-test-only');
 let host=await openHost({home,fixture:true});
 try{
  assert.equal((await host.snapshot()).schema,currentSchema);
  await host.saveFeedback(request);
  await host.correctFeedback(request.id,1,{title:'Active display',reproduction:'Two displays',note:'Added reproduction details.'});
  await host.close();host=await openHost({home,fixture:true});
  const records=await host.tracker('about','display','Backlog');assert.equal(records.length,1);assert.equal(records[0].feedback!.revision,2);assert.equal(records[0].originalWords,request.originalWords);
  assert.equal((await host.snapshot()).works.length,0);
  assert.equal((await host.tracker('work')).length,0);
  await host.saveFeedback({...request,id:'voice-request',kind:'feature',title:'Review dictation before sending',originalWords:'Let me edit what Pip heard before I ask.'});
  assert.equal((await host.tracker('about')).length,2);
 }finally{await host.close();}
});
