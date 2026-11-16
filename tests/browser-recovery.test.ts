import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openHost, type Host } from '../runtime/pi-durable-adapter.js';
import { fauxEngine, said } from './helpers/faux-engine.js';

// Intent: accepted ELF-8 restart reacquires ephemeral browser context; old work
// never becomes an implicit browser/account grant. Exercise the durable worker,
// not source-text pins. A real user-like reading request survives SQLite reopen.
test('expired browser-dependent work interrupts without inference or renewed source access', {timeout:10000},async()=>{
 const root=process.env.PIP_TEST_ROOT??os.tmpdir();await mkdir(root,{recursive:true});const home=await mkdtemp(path.join(root,'pip-browser-recovery-'));await writeFile(path.join(home,'.pip-test-home'),'pip-test-only');
 const {faux,engine}=fauxEngine();faux.setResponses([said('Expired scope must not invoke inference')]);
 let host:Host|undefined,done:()=>void=()=>{},resumed:()=>void=()=>{},resumeAttempts=Infinity;
 const finished=new Promise<void>(resolve=>done=resolve);
 host=await openHost({home,fixture:true,engine,changed:()=>{if(host)void host.snapshot().then(state=>{if(state.works[0]?.status==='Interrupted')done();});}});
 try{await host.submit('read-expired','Read the official Pi durable introduction and explain crash recovery.',undefined,undefined,undefined,true);await finished;const before=await host.snapshot();assert.equal(faux.state.callCount,0);assert.match(before.works[0].error,/browser expired/i);await host.close();host=undefined;
  host=await openHost({home,fixture:true,engine,changed:()=>{if(host)void host.snapshot().then(state=>{if(state.works[0]?.status==='Interrupted'&&(state.works[0].usage?.attempts??0)>resumeAttempts)resumed();});}});const after=await host.snapshot();assert.equal(after.works[0].id,before.works[0].id);assert.equal(after.works[0].browserRequired,true);assert.equal(after.works[0].status,'Interrupted');assert.equal(faux.state.callCount,0);
  // ELF-16's reviewed Continue renews a worker episode, never browser source scope.
  resumeAttempts=after.works[0].usage?.attempts??0;const interruptedAgain=new Promise<void>(resolve=>resumed=resolve);
  const approval=await host.propose({type:'work.continue',workId:'read-expired',attempts:resumeAttempts,projectRevision:0});
  await host.approve(approval.id,approval.revision,approval.digest);await interruptedAgain;
  assert.equal(faux.state.callCount,0);assert.match((await host.snapshot()).works[0].error,/browser expired/i);
 }finally{await host?.close();}
});
