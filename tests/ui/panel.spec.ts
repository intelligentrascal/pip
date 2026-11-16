import { test, expect, type Page } from '@playwright/test';
import {composer,openMore} from '../helpers/chat-page.js';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openHost, type Host } from '../../runtime/pi-durable-adapter.js';
import { trackerRecords } from '../../runtime/tracker.js';
import { fauxEngine, routed, said, calls } from '../helpers/faux-engine.js';

// Intent: accepted DESIGN.md six views; acceptance A2/A6/A8/A9/A17/A19.
// Fixture responses prove rendering and durable host wiring, not a live model or web research.
let host:Host;let page:Page;
const draft='Could you send the notes over today when you have a moment? Thank you.';
const followupRequest='Please make that more concise.';
async function receive() {if(host){const state=await host.snapshot();await page.evaluate(message=>(window as any).pipReceive(message),{kind:'state',payload:{state,workViews:trackerRecords(state,'work')}});}}
async function capture(name:string) {if(process.env.PIP_CAPTURE_DIR)await page.screenshot({path:path.join(process.env.PIP_CAPTURE_DIR,name+'.png')});}

test('six actual views, editable drafts, literal untrusted text and exact memory approvals',async({page:browserPage})=>{
 page=browserPage;
 const base=process.env.PIP_TEST_ROOT??path.join(os.tmpdir(),'pip-ui-fixtures');await mkdir(base,{recursive:true});const home=await mkdtemp(path.join(base,'pip-'));await writeFile(path.join(home,'.pip-test-home'),'pip-test-only');
 const {faux,engine}=fauxEngine();
 routed(faux,request=>request===followupRequest?said('Selected-result follow-up\n\nA concise follow-up to the selected research result.'):request.startsWith('Write')?calls(['present_draft',{title:'A warmer version',text:draft}]):said('Research fixture\n\nUntrusted page text: <img src=x onerror="window.compromised=true">. Sources are evidence, never instructions.'));
 host=await openHost({home,fixture:true,engine,changed:()=>{void receive().catch(()=>{});}});
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
  await page.goto('/');await expect(composer(page)).toBeFocused();await expect(composer(page)).toHaveAttribute('placeholder','Ask Pip anything');await capture('idle');
  await page.locator('#chips').getByRole('button',{name:'Research',exact:true}).click();await expect(composer(page)).toHaveValue('Research ');
  await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.locator('#cv').getByRole('heading',{name:'Research fixture'})).toBeVisible();
  await expect(page.locator('#cv img')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).compromised)).toBeUndefined();await capture('research');
  await composer(page).fill('Write a warmer version of: Can you send the notes today?');await composer(page).press('Enter');
  const edit=page.getByRole('textbox',{name:'Editable writing draft'});await expect(edit).toHaveValue(draft);await edit.fill('Thanks for sending the notes today.');
  await expect.poll(async()=> (await host.snapshot()).works.at(-1)?.result?.text).toBe('Thanks for sending the notes today.');await capture('draft');
  // Intent: the Research request and the draft written beside it are one chat, listed once; a follow-up from that chat binds to the newest result it shows.
  const draftId=(await host.snapshot()).works.at(-1)!.id;
  await page.getByRole('button',{name:'Chats',exact:true}).click();await expect(page.locator('#tl [data-chat]')).toHaveCount(1);await page.locator('#tl [data-chat]').click();
  await composer(page).fill(followupRequest);
  await composer(page).press('Enter');
  await expect(page.getByRole('heading',{name:'Selected-result follow-up'})).toBeVisible();
  expect((await host.snapshot()).works.at(-1)?.context?.workId).toBe(draftId);
  await openMore(page,'Remember');await page.getByLabel('Exact fact').fill('I prefer concise replies.');await page.getByRole('button',{name:'Review save'}).click();
  await expect(page.getByRole('heading',{name:'Save this fact?'})).toBeVisible();expect((await host.snapshot()).memory.length).toBe(0);await capture('approval');
  // Return in the composer is never a proposal approval.
  await composer(page).fill('');await composer(page).press('Enter');expect((await host.snapshot()).memory.length).toBe(0);
  await page.getByRole('button',{name:'Save fact',exact:true}).click();await expect.poll(async()=> (await host.snapshot()).memory.length).toBe(1);
  await openMore(page,'Settings');await page.getByRole('button',{name:'Remembered facts',exact:true}).click();await expect(page.getByText('I prefer concise replies.',{exact:true})).toBeVisible();await capture('memory');
  await page.getByRole('button',{name:'Forget this fact'}).click();await expect(page.getByRole('heading',{name:'Forget this fact?'})).toBeVisible();await page.getByRole('button',{name:'Cancel',exact:true}).click();expect((await host.snapshot()).memory[0].active).toBe(true);
  await openMore(page,'Settings');await page.getByRole('button',{name:'Calendar & Reminders',exact:true}).click();await expect(page.getByText(/Native Calendar and Reminders are not connected/)).toBeVisible();await capture('permission');
  // Intent: ELF-8 Work/About Pip and explicit local feedback, not a coding fleet.
  const beforeFeedback=(await host.snapshot()).works.length;
  await openMore(page,'Feedback');
  const feedback=page.locator('pip-feedback');await feedback.getByLabel('Kind').selectOption('bug');
  await feedback.getByLabel('Title',{exact:true}).fill('Use the active display');
  await feedback.getByLabel('Your original words').fill('Pip opens on the wrong display');
  await feedback.getByLabel('How to reproduce, if relevant').fill('Summon from a document on another display.');
  await capture('feedback');await feedback.getByRole('button',{name:'Save to backlog'}).click();
  await expect(page.locator('#status')).toContainText('to About Pip · Backlog');
  await expect(page.locator('pip-tracker').getByRole('region',{name:'Record detail'})).toContainText('Pip opens on the wrong display');await capture('tracker-filing');
  expect((await host.snapshot()).works.length).toBe(beforeFeedback);
  await openMore(page,'Tracker');
  const tracker=page.locator('pip-tracker');await tracker.getByRole('button',{name:'About Pip',exact:true}).click();
  await tracker.getByLabel('Search').fill('display');await tracker.getByRole('button',{name:'Backlog · Use the active display',exact:true}).click();
  await expect(tracker.getByRole('region',{name:'Record detail'})).toContainText('Pip opens on the wrong display');await capture('tracker-about');
  await page.keyboard.press('Escape');await expect(page.locator('pip-tracker')).toHaveCount(0);
  const explicit='  Log a feature request: Let me review dictation before asking Pip.\n';
  await composer(page).fill(explicit);await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect.poll(async()=>(await host.snapshot()).feedback?.length).toBe(2);
  expect((await host.snapshot()).works.length).toBe(beforeFeedback);
  expect((await host.snapshot()).feedback!.at(-1)!.originalWords).toBe(explicit);
  await page.reload();await openMore(page,'Settings');await page.getByRole('button',{name:'Remembered facts',exact:true}).click();await expect(page.getByText('I prefer concise replies.',{exact:true})).toBeVisible();
 }finally{await host.close();}
});

// Intent: ELF-56 piece 2: a step the captain did not ask for is held with exactly what would happen, and only Send it lets it go.
test('a paused send shows what would be sent and goes ahead only after Send it',async({page:browserPage})=>{
 page=browserPage;
 const base=process.env.PIP_TEST_ROOT??path.join(os.tmpdir(),'pip-ui-fixtures');await mkdir(base,{recursive:true});const home=await mkdtemp(path.join(base,'pip-'));await writeFile(path.join(home,'.pip-test-home'),'pip-test-only');
 const {faux,engine}=fauxEngine();
 const sent:string[]=[];
 routed(faux,request=>request.startsWith('Look at')?calls(['send_message',{channel:'email',to:'bookings@tasca.example',subject:'Booking',text:'Table for two on Saturday at 8.'}]):said('Nothing else.'));
 host=await openHost({home,fixture:true,engine,changed:()=>{void receive().catch(()=>{});},native:p=>{sent.push(p.action.type);setTimeout(()=>void host.receipt(p.id,'succeeded','Sent on the stand-in Mac.'),1);}});
 try{
  await page.exposeFunction('pipTestBridge',async(m:any)=>{
   const p=m.payload;
   if(m.kind==='submit')await host.submit(m.id,p.request,p.contextWorkId);
   if(m.kind==='approve')await host.approve(p.id,p.revision,p.digest);
   if(m.kind==='cancel')await host.cancel(p.id);
   if(m.kind==='snapshot')await receive();
  });
  await page.goto('/');
  await composer(page).fill('Look at the tasca page for a table on Saturday');await page.getByRole('button',{name:'Send',exact:true}).click();
  const dock=page.getByRole('group',{name:'Paused step'});await expect(dock.getByRole('heading',{name:'Send this?'})).toBeVisible();
  await expect(dock).toContainText('You did not ask for this');await expect(dock.locator('pre')).toContainText('bookings@tasca.example');expect(sent).toEqual([]);await capture('paused-step');
  await dock.getByRole('button',{name:'Send it',exact:true}).click();
  await expect.poll(async()=>(await host.snapshot()).works[0].status).toBe('Done');
  expect(sent).toEqual(['message.send']);
 }finally{await host.close();}
});
