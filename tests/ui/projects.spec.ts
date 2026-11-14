import {test,expect} from '@playwright/test';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {openHost,type Host} from '../../runtime/pi-durable-adapter.js';
import {trackerRecords} from '../../runtime/tracker.js';

test.use({video:{mode:'on',size:{width:680,height:720}}});

// Intent: ELF-8 project approval, visible inspection/correction/unpin/forget and restart Continue.
// Real SQLite and browser UI, disposable source descriptions; no native input or account.
test('approved projects persist, attach only deliberately and offer exact restart continuation',async({page})=>{
 const base=process.env.PIP_TEST_ROOT??path.join(os.tmpdir(),'pip-project-ui');await mkdir(base,{recursive:true});const home=await mkdtemp(path.join(base,'project-'));await writeFile(path.join(home,'.pip-test-home'),'pip-test-only');
 let host:Host;let calls:any[]=[];
 const provider=async(_request:any,_memory:any,_signal:any,context:any)=>{calls.push(context);return {kind:'draft' as const,title:'Release notes',text:'Pip keeps explicitly approved project context between visits.',sources:[],model:'Fixture transport — not Claude',sessionId:'project-ui'};};
 const receive=async()=>{const state=await host.snapshot();await page.evaluate(message=>(window as any).pipReceive(message),{kind:'state',payload:{state,workViews:trackerRecords(state,'work'),claudeAllowed:false}});};
 const connect=()=>openHost({home,fixture:true,provider,changed:()=>void receive().catch(()=>{})});host=await connect();
 const capture=async(name:string)=>{if(process.env.PIP_CAPTURE_DIR){
  if(name!=='after-settings')await page.locator('#conversation').evaluate(el=>{el.scrollTop=0;});
  await page.locator('.panel').screenshot({path:path.join(process.env.PIP_CAPTURE_DIR,name+'.png')});
  if(['project-review','project-reopened','continue-review'].includes(name)){
   await page.locator('#conversation').evaluate(el=>{el.scrollTop=el.scrollHeight;});
   await page.locator('.panel').screenshot({path:path.join(process.env.PIP_CAPTURE_DIR,name+'-actions.png')});
  }
 }};
 try{
  await page.exposeFunction('pipTestBridge',async(m:any)=>{const p=m.payload;
   if(m.kind==='snapshot')await receive();
   if(m.kind==='propose')await host.propose(p.action);
   if(m.kind==='approve')await host.approve(p.id,p.revision,p.digest);
   if(m.kind==='cancel')await host.cancel(p.id);
   if(m.kind==='stop')await host.stop();
   if(m.kind==='submit')await host.submit(m.id,p.request,p.contextWorkId,undefined,p.project);
   if(m.kind==='saveComposer')await host.saveComposer(p.text);
   if(m.kind==='saveDraft')await host.saveDraft(p.id,p.text);
  });
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Back',exact:true}).scrollIntoViewIfNeeded();await capture('after-settings');
  await page.getByRole('button',{name:'Projects',exact:true}).click();await expect(page.getByText('No approved projects yet.')).toBeVisible();
  await page.getByRole('button',{name:'New project',exact:true}).click();await page.getByLabel('Project title',{exact:true}).fill('An unsaved project');await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByLabel('Project title',{exact:true})).toHaveCount(0);expect((await host.snapshot()).projects).toHaveLength(0);
  await page.getByRole('button',{name:'New project',exact:true}).click();await page.getByLabel('Project title',{exact:true}).fill('Pip release');await page.getByLabel('Approved summary',{exact:true}).fill('Finish project continuity before the v1 release.');await page.getByLabel('Where this context came from').fill('Captain-approved release plan, ELF-8');
  await page.getByLabel(/Pinned public references/).fill('pi-durable source | https://github.com/earendil-works/pi | 2026-01-01T12:00:00Z');
  // ELF-8: background completion must not discard an unapproved project-context draft.
  await host.submit('background-release','Draft a short release introduction.');await expect.poll(async()=>(await host.snapshot()).works.find(w=>w.id==='background-release')?.status).toBe('Done');await receive();
  await expect(page.getByLabel('Project title',{exact:true})).toHaveValue('Pip release');await expect(page.getByLabel('Approved summary',{exact:true})).toHaveValue('Finish project continuity before the v1 release.');const callsBeforeSave=calls.length;
  await capture('project-editor');await page.getByRole('button',{name:'Review project context',exact:true}).click();await expect(page.getByRole('button',{name:'Save project context',exact:true})).toBeVisible();expect((await host.snapshot()).projects).toHaveLength(0);await capture('project-review');
  await page.getByRole('button',{name:'Save project context',exact:true}).click();await expect.poll(async()=>(await host.snapshot()).projects?.length).toBe(1);expect(calls).toHaveLength(callsBeforeSave);
  await host.close();host=await connect();await receive();
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Projects',exact:true}).click();await expect(page.getByText('Finish project continuity before the v1 release.',{exact:true})).toBeVisible();await capture('project-reopened');
  await page.getByRole('button',{name:'Edit summary and pins'}).click();await page.getByLabel('Approved summary',{exact:true}).fill('Draft the release notes; do not send them.');await page.getByLabel(/Pinned public references/).fill('');await page.getByRole('button',{name:'Review project context',exact:true}).click();await page.getByRole('button',{name:'Save project context',exact:true}).click();await expect.poll(async()=>(await host.snapshot()).projects![0].revision).toBe(2);
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Projects',exact:true}).click();await page.getByRole('button',{name:'Use for next request',exact:true}).click();
  await page.getByPlaceholder('What would you like a hand with?').fill('Draft the Pip release notes.');await page.getByPlaceholder('What would you like a hand with?').press('Enter');await expect(page.getByRole('heading',{name:'Release notes',exact:true})).toBeVisible();const projected=calls.find(c=>c.project);expect(projected.project.summary).toBe('Draft the release notes; do not send them.');expect(projected.project.pins).toHaveLength(0);await expect(page.locator('#status')).toContainText('only to this request');
  // A typed cutoff fixture produces a real durable interrupted record and exact review controls.
  await host.close();host=await openHost({home,fixture:true,provider:async()=>{throw Object.assign(new Error('Claude reached the episode boundary.'),{code:'provider-cutoff'});},changed:()=>void receive().catch(()=>{})});
  await host.submit('remaining-notes','Review the remaining release notes.');await expect.poll(async()=>(await host.snapshot()).works.at(-1)?.status).toBe('Interrupted');await receive();
  await page.getByRole('button',{name:'Interrupted · Review the remaining release notes.',exact:true}).click();await page.getByRole('button',{name:'Review continuation',exact:true}).click();await expect(page.getByRole('button',{name:'Continue work',exact:true})).toBeVisible();await capture('continue-review');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();expect((await host.snapshot()).works.at(-1)?.usage?.attempts).toBe(1);await page.getByRole('button',{name:'Stop work',exact:true}).click();await expect.poll(async()=>(await host.snapshot()).works.at(-1)?.status).toBe('Stopped');
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Projects',exact:true}).click();await page.getByRole('button',{name:'Forget project',exact:true}).click();await page.getByRole('button',{name:'Forget project',exact:true}).click();await expect.poll(async()=>(await host.snapshot()).projects![0].active).toBe(false);
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Projects',exact:true}).click();await expect(page.getByText('No approved projects yet.')).toBeVisible();await capture('project-forgotten');
 }finally{await host.close();}
});
