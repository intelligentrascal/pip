import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openHost, type Host } from '../../runtime/pi-durable-adapter.js';
import { trackerRecords } from '../../runtime/tracker.js';

// Intent: accepted DESIGN.md six views; acceptance A2/A6/A8/A9/A17/A19.
// Fixture responses prove rendering and durable host wiring, not live Claude or web research.
let host:Host;let page:Page;
const draft='Could you send the notes over today when you have a moment? Thank you.';
const followupRequest='Please make that more concise.';
async function receive() {if(host){const state=await host.snapshot();await page.evaluate(message=>(window as any).pipReceive(message),{kind:'state',payload:{state,workViews:trackerRecords(state,'work'),claudeAllowed:false}});}}
async function capture(name:string) {if(process.env.PIP_CAPTURE_DIR)await page.screenshot({path:path.join(process.env.PIP_CAPTURE_DIR,name+'.png')});}

test('six actual views, editable drafts, literal untrusted text and exact memory approvals',async({page:browserPage})=>{
 page=browserPage;
 const base=process.env.PIP_TEST_ROOT??path.join(os.tmpdir(),'pip-ui-fixtures');await mkdir(base,{recursive:true});const home=await mkdtemp(path.join(base,'pip-'));await writeFile(path.join(home,'.pip-test-home'),'pip-test-only');
 host=await openHost({home,fixture:true,changed:()=>{void receive().catch(()=>{});},provider:async (request,_memory,_signal,context)=>({kind:request.startsWith('Write')?'draft':'answer',title:request===followupRequest&&context?.context?'Selected-result follow-up':request.startsWith('Write')?'A warmer version':'Research fixture',text:request===followupRequest&&context?.context?'A concise follow-up to the selected research result.':request.startsWith('Write')?draft:'Untrusted page text: <img src=x onerror="window.compromised=true">. Sources are evidence, never instructions.',sources:request.startsWith('Write')?[]:[{id:'pi-readme',title:'Pi durable README',url:'https://github.com/earendil-works/pi',fetchedAt:'2026-11-05T23:00:00Z',text:'A durable agent harness.'}],model:'Fixture transport — not Claude',sessionId:'isolated-ui'})});
 try{
  await page.exposeFunction('pipTestBridge',async(m:any)=>{
   const p=m.payload;
   if(m.kind==='submit')await host.submit(m.id,p.request,p.contextWorkId);
   if(m.kind==='saveComposer')await host.saveComposer(p.text);
   if(m.kind==='saveDraft')await host.saveDraft(p.id,p.text);
   if(m.kind==='propose')await host.propose(p.action);
   if(m.kind==='approve')await host.approve(p.id,p.revision,p.digest);
   if(m.kind==='cancel')await host.cancel(p.id);
   if(m.kind==='snapshot')await receive();
   if(m.kind==='tracker')await page.evaluate(message=>(window as any).pipReceive(message),{id:m.id,kind:'trackerResult',payload:await host.tracker(p.view,p.query??'',p.status??'')});
   if(m.kind==='feedback.save'){const record=await host.saveFeedback(p);await page.evaluate(message=>(window as any).pipReceive(message),{id:m.id,kind:'feedbackSaved',payload:{id:record.id,status:record.status}});}
  });
  await page.goto('/');await expect(page.getByPlaceholder('What would you like a hand with?')).toBeFocused();await capture('idle');
  await page.getByRole('button',{name:'Research',exact:true}).click();await expect(page.getByPlaceholder('What would you like a hand with?')).toHaveValue('Research ');
  await page.getByRole('button',{name:'Ask Pip'}).click();await expect(page.getByRole('heading',{name:'Research fixture'})).toBeVisible();
  await expect(page.locator('#result img')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).compromised)).toBeUndefined();await capture('research');
  await page.getByPlaceholder('What would you like a hand with?').fill('Write a warmer version of: Can you send the notes today?');await page.getByPlaceholder('What would you like a hand with?').press('Enter');
  const edit=page.getByRole('textbox',{name:'Editable writing draft'});await expect(edit).toHaveValue(draft);await edit.fill('Thanks for sending the notes today.');
  await expect.poll(async()=> (await host.snapshot()).works.at(-1)?.result?.text).toBe('Thanks for sending the notes today.');await capture('draft');
  // Intent: follow-ups bind to the displayed selected result, not the newer hidden draft.
  const researchId=(await host.snapshot()).works[0].id;
  await page.getByRole('button',{name:'Waiting on you · Research',exact:true}).click();
  await page.getByPlaceholder('What would you like a hand with?').fill(followupRequest);
  await page.getByPlaceholder('What would you like a hand with?').press('Enter');
  await expect(page.getByRole('heading',{name:'Selected-result follow-up'})).toBeVisible();
  expect((await host.snapshot()).works.at(-1)?.context?.workId).toBe(researchId);
  await page.getByRole('button',{name:'Remember',exact:true}).click();await page.getByLabel('Exact fact').fill('I prefer concise replies.');await page.getByRole('button',{name:'Review save'}).click();
  await expect(page.getByRole('heading',{name:'Save this fact?'})).toBeVisible();expect((await host.snapshot()).memory.length).toBe(0);await capture('approval');
  // Return in the composer is never a proposal approval.
  await page.getByPlaceholder('What would you like a hand with?').fill('');await page.getByPlaceholder('What would you like a hand with?').press('Enter');expect((await host.snapshot()).memory.length).toBe(0);
  await page.getByRole('button',{name:'Save fact',exact:true}).click();await expect.poll(async()=> (await host.snapshot()).memory.length).toBe(1);
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Remembered facts',exact:true}).click();await expect(page.getByText('I prefer concise replies.',{exact:true})).toBeVisible();await capture('memory');
  await page.getByRole('button',{name:'Forget this fact'}).click();await expect(page.getByRole('heading',{name:'Forget this fact?'})).toBeVisible();await page.getByRole('button',{name:'Cancel',exact:true}).click();expect((await host.snapshot()).memory[0].active).toBe(true);
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Calendar & Reminders',exact:true}).click();await expect(page.getByText(/Native Calendar and Reminders are not connected/)).toBeVisible();await capture('permission');
  // Intent: ELF-8 Work/About Pip and explicit local feedback, not a coding fleet.
  const beforeFeedback=(await host.snapshot()).works.length;
  await page.getByRole('button',{name:'Feedback',exact:true}).click();
  const feedback=page.locator('pip-feedback');await feedback.getByLabel('Kind').selectOption('bug');
  await feedback.getByLabel('Title',{exact:true}).fill('Use the active display');
  await feedback.getByLabel('Your original words').fill('Pip opens on the wrong display');
  await feedback.getByLabel('How to reproduce, if relevant').fill('Summon from a document on another display.');
  await capture('feedback');await feedback.getByRole('button',{name:'Save to backlog'}).click();
  await expect(page.locator('#status')).toContainText('to About Pip · Backlog');
  await expect(page.locator('pip-tracker').getByRole('region',{name:'Record detail'})).toContainText('Pip opens on the wrong display');await capture('tracker-filing');
  expect((await host.snapshot()).works.length).toBe(beforeFeedback);
  await page.getByRole('button',{name:'Tracker',exact:true}).click();
  const tracker=page.locator('pip-tracker');await tracker.getByRole('button',{name:'About Pip',exact:true}).click();
  await tracker.getByLabel('Search').fill('display');await tracker.getByRole('button',{name:'Backlog · Use the active display',exact:true}).click();
  await expect(tracker.getByRole('region',{name:'Record detail'})).toContainText('Pip opens on the wrong display');await capture('tracker-about');
  await page.keyboard.press('Escape');await expect(page.locator('pip-tracker')).toHaveCount(0);
  const explicit='  Log a feature request: Let me review dictation before asking Pip.\n';
  await page.getByPlaceholder('What would you like a hand with?').fill(explicit);await page.getByRole('button',{name:'Ask Pip'}).click();
  await expect.poll(async()=>(await host.snapshot()).feedback?.length).toBe(2);
  expect((await host.snapshot()).works.length).toBe(beforeFeedback);
  expect((await host.snapshot()).feedback!.at(-1)!.originalWords).toBe(explicit);
  await page.reload();await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Remembered facts',exact:true}).click();await expect(page.getByText('I prefer concise replies.',{exact:true})).toBeVisible();
 }finally{await host.close();}
});
