import {test,expect} from '@playwright/test';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {componentPage} from '../helpers/components.js';
import path from 'node:path';
import os from 'node:os';
import {openHost} from '../../runtime/pi-durable-adapter.js';

// Intent: ELF-8 explicit Feedback intake + ELF-10 accepted finite Living ink.
// This exercises standalone components and real local storage, not native integration.
test('Feedback only saves deliberately; Living ink retargets and refuses unverified success',async({page})=>{
 const base=process.env.PIP_TEST_ROOT??path.join(os.tmpdir(),'pip-ui-fixtures');await mkdir(base,{recursive:true});
 const home=await mkdtemp(path.join(base,'feedback-'));await writeFile(path.join(home,'.pip-test-home'),'pip-test-only');
 const host=await openHost({home,fixture:true});
 try{
  await host.saveWorkToBacklog({id:'document-later',request:'Read this document and give me a short summary later.',title:'Summarise the document',priority:'normal'});
  await page.exposeFunction('saveFeedback',async(input:any)=>{await host.saveFeedback(input);return input.id;});
  await page.exposeFunction('queryTracker',async(input:any)=>host.tracker(input.view,input.query,input.status));
  await componentPage(page,'<pip-living-ink></pip-living-ink><pip-feedback></pip-feedback><pip-tracker></pip-tracker>',`import '/living-ink.js';import '/feedback.js';import '/tracker.js';const tracker=document.querySelector('pip-tracker');tracker.addEventListener('tracker-query',async e=>{tracker.setRecords(e.detail.view,await window.queryTracker(e.detail),e.detail.revision);});document.querySelector('pip-feedback').addEventListener('feedback-save',async e=>{const id=await window.saveFeedback(e.detail);document.querySelector('pip-feedback').acknowledge(id);tracker.request();});tracker.request();`);
  const feedback=page.locator('pip-feedback'),ink=page.locator('pip-living-ink');
  await expect(feedback.getByRole('heading')).toHaveText('Feedback about Pip');
  const workTracker=page.locator('pip-tracker');await workTracker.getByRole('button',{name:'Backlog · Summarise the document'}).click();
  await expect(workTracker.getByRole('region',{name:'Record detail'})).toContainText('Read this document and give me a short summary later.');
  if(process.env.PIP_CAPTURE_DIR)await page.screenshot({fullPage:true,path:path.join(process.env.PIP_CAPTURE_DIR,'independent-work.png')});
  await page.evaluate(()=>{(document.querySelector('pip-feedback') as any).seed('Pip opens on the wrong display');});
  expect((await host.tracker('about')).length).toBe(0);
  await page.evaluate(()=>{(window as any).cancelled=false;document.querySelector('pip-feedback')!.addEventListener('feedback-cancel',()=>{(window as any).cancelled=true;});});
  await feedback.getByRole('button',{name:'Cancel',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).cancelled)).toBe(true);expect((await host.tracker('about')).length).toBe(0);
  await feedback.getByLabel('Kind').selectOption('bug');await feedback.getByLabel('Title',{exact:true}).fill('Use the active display');
  await feedback.getByLabel('How to reproduce, if relevant').fill('Summon Pip from a document on the other display.');
  await feedback.getByRole('button',{name:'Save to backlog'}).click();
  await expect(feedback.getByRole('status')).toContainText('to About Pip · Backlog');
  const tracker=page.locator('pip-tracker');await tracker.getByRole('button',{name:'About Pip',exact:true}).click();
  await tracker.getByRole('button',{name:'Backlog · Use the active display'}).click();
  await expect(tracker.getByRole('region',{name:'Record detail'})).toContainText('Pip opens on the wrong display');
  await tracker.getByLabel('Search').fill('no matching bug');await expect(tracker.getByRole('status')).toHaveText('0 matching About Pip records');
  await tracker.getByLabel('Search').fill('display');await expect(tracker.getByRole('status')).toHaveText('1 matching About Pip records');
  const records=await host.tracker('about');expect(records).toHaveLength(1);expect(records[0].originalWords).toBe('Pip opens on the wrong display');expect((await host.snapshot()).works).toHaveLength(1);expect((await host.snapshot()).works[0].status).toBe('Backlog');expect((await host.snapshot()).works[0].taskId).toBe(0);
  // Intent: ELF-8 real tracker visibility; stale replies cannot satisfy native render readiness.
  const accepted=await page.evaluate(()=>{
   const el=document.querySelector('pip-tracker') as any,events:any[]=[];
   const listener=(event:any)=>events.push(event.detail);el.addEventListener('tracker-rendered',listener);
   const current=el.records;el.setRecords(el.view,[],el.queryRevision-1);const afterStale=events.length;
   el.setRecords(el.view,current,el.queryRevision);el.removeEventListener('tracker-rendered',listener);
   return {afterStale,events,visible:[...el.shadowRoot.querySelectorAll('#records button')].map((button:any)=>button.dataset.recordId)};
  });
  expect(accepted.afterStale).toBe(0);expect(accepted.events).toHaveLength(1);expect(accepted.events[0].ids).toEqual(records.map(record=>record.id));expect(accepted.visible).toEqual(accepted.events[0].ids);
  const bounded=await page.evaluate(()=>{
   const el=document.querySelector('pip-living-ink') as any;
   el.showState('working');el.showState('approval');el.showState('unknown');
   const animations=el.shadowRoot.getAnimations();return {animations:animations.length,targets:new Set(animations.map((a:Animation)=>(a.effect as KeyframeEffect).target)).size,state:el.dataset.state,seal:getComputedStyle(el.shadowRoot.querySelector('.seal')).visibility};
  });expect(bounded.state).toBe('unknown');expect(bounded.seal).toBe('hidden');expect(bounded.animations).toBeLessThanOrEqual(bounded.targets);
  expect(await page.evaluate(()=>{const el=document.querySelector('pip-living-ink') as any;el.showState('working');return el.shadowRoot.getAnimations().every((a:Animation)=>a.effect!.getTiming().iterations===1&&a.effect!.getTiming().duration===1800);})).toBe(true);
  expect(await page.evaluate(()=>{try{(document.querySelector('pip-living-ink') as any).showState('done');return false;}catch{return true;}})).toBe(true);
  expect(await page.evaluate(()=>{try{(document.querySelector('pip-living-ink') as any).showState('toString');return false;}catch{return true;}})).toBe(true);
  expect(await page.evaluate(()=>{const el=document.querySelector('pip-living-ink') as any;el.style.setProperty('--pip-motion-duration','0ms');el.showState('working');const running=el.shadowRoot.getAnimations().filter((a:Animation)=>a.playState==='running').length;el.style.removeProperty('--pip-motion-duration');return running;})).toBe(0);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{(document.querySelector('pip-living-ink') as any).showState('done',{verified:true});});
  await expect(ink.getByRole('status')).toHaveText('Verified result');
  expect(await page.evaluate(()=>(document.querySelector('pip-living-ink') as any).shadowRoot.getAnimations().filter((a:Animation)=>a.playState==='running').length)).toBe(0);
  if(process.env.PIP_CAPTURE_DIR)await page.screenshot({fullPage:true,path:path.join(process.env.PIP_CAPTURE_DIR,'independent-feedback-ink.png')});
 }finally{await host.close();}
});
