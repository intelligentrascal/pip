import { test,expect } from '@playwright/test';
import {composer,openMore} from '../helpers/chat-page.js';
import { TaskBrowsers } from '../../runtime/task-browser.js';
import { openHost, type Host } from '../../runtime/pi-durable-adapter.js';
import { trackerRecords } from '../../runtime/tracker.js';
import { browserPageURL,linkedURL,savedBrowserPage } from '../helpers/browser-page.js';
import { mkdtemp,mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fauxEngine,calls as scripted,said } from '../helpers/faux-engine.js';

// Intent: accepted ELF-8 compact Watch/site/title/driver, private Take over,
// fresh Return control and closing Watch without stopping useful task browsing.
// Real host, SQLite and Chromium; the provider/HTTPS response are explicit fixtures.
test('reviewed task reads a page and exposes truthful Watch, private handoff, return and Stop',async({page})=>{
 test.setTimeout(60000);
 const receive=async(message:unknown)=>page.evaluate(m=>(window as any).pipReceive(m),message);
 const browsers=new TaskBrowsers(state=>{void receive({kind:'browserState',payload:state});},{headless:true,fixture:{respond:url=>savedBrowserPage(url)}});
 const root=process.env.PIP_TEST_ROOT??os.tmpdir();await mkdir(root,{recursive:true});const home=await mkdtemp(path.join(root,'pip-browser-ui-'));await writeFile(path.join(home,'.pip-test-home'),'pip-test-only');
 let host:Host;let connected=false;
 let holdFrame=false,frameHeld=()=>{},releaseFrame=()=>{},frameDelivered=()=>{};
 let frameRelease:Promise<void>=Promise.resolve();
 const snapshot=async()=>{if(host&&connected){const state=await host.snapshot();await receive({kind:'state',payload:{state,workViews:trackerRecords(state,'work')}});}};
 const {faux,engine}=fauxEngine();
 faux.setResponses([scripted(['inspect',{}]),said('Browser source read\n\nThe reviewed page was read.')]);
 host=await openHost({home,fixture:true,engine,browser:id=>browsers.tools(id),changed:()=>{void snapshot();}});
 const capture=async(name:string)=>{if(process.env.PIP_CAPTURE_DIR)await page.screenshot({path:path.join(process.env.PIP_CAPTURE_DIR,name+'.png')});};
 try{
  await page.exposeFunction('pipTestBridge',async(m:any)=>{
   try{
    if(m.kind==='snapshot'){connected=true;await snapshot();}
    else if(m.kind==='submit'){if(m.payload.browserPages)browsers.grant(m.id,m.payload.browserPages);await host.submit(m.id,m.payload.request,undefined,undefined,undefined,!!m.payload.browserPages);}
    else if(m.kind==='browser'){
     const result=await browsers.command(m.payload.workId,m.payload.op),held=m.payload.op==='watch'&&holdFrame;
     if(held){frameHeld();await frameRelease;}
     await receive({id:m.id,kind:'browserResult',payload:result});if(held)frameDelivered();
    }
    else if(m.kind==='saveComposer')await host.saveComposer(m.payload.text);
    else if(m.kind==='stop'){await browsers.closeAll();await host.stop();}
   }catch(error){await receive({id:m.id,kind:'error',payload:{message:(error as Error).message}});}
  });
  await page.goto('/');await expect(composer(page)).toBeFocused();await capture('browser-entry');
  await openMore(page,'Browser task');
  await page.getByLabel('What should Pip do?').fill('Read the Pi durable introduction and explain how it keeps work after a crash.');
  await page.getByLabel('Reviewed page addresses, one per line').fill(browserPageURL+'\n'+linkedURL);await capture('browser-review');
  await page.getByRole('button',{name:'Start reviewed browser task'}).click();
  const watch=page.locator('pip-task-browser');
  await expect(watch.getByText('Pip is driving · Watch only')).toBeVisible();
  await expect(watch.getByRole('img')).toBeVisible({timeout:25000});
  await expect(watch.getByText('Pi durable · captured public README',{exact:true})).toBeVisible();
  await expect(watch.getByText('https://raw.githubusercontent.com',{exact:true})).toBeVisible();
  // Intent: compact Watch must actually show its preview, not put it below the scroll boundary.
  await expect(watch.getByRole('img')).toBeInViewport({ratio:1});
  await capture('browser-watch');
  // Intent: Watch polling must never swallow Take over or restore an old frame
  // after private control. Hold one real frame response, not the browser itself.
  holdFrame=true;const held=new Promise<void>(resolve=>frameHeld=resolve);
  frameRelease=new Promise<void>(resolve=>releaseFrame=resolve);const delivered=new Promise<void>(resolve=>frameDelivered=resolve);
  await watch.getByRole('button',{name:'Refresh view',exact:true}).click();await held;
  await watch.getByRole('button',{name:'Take over',exact:true}).click();
  await expect(watch.getByText('You are driving · Private')).toBeVisible();
  holdFrame=false;releaseFrame();await delivered;
  await expect(watch.getByRole('img')).toBeHidden();await capture('browser-private');
  await watch.getByRole('button',{name:'Return control',exact:true}).click();
  await expect(watch.getByText('Pip is driving · Watch only')).toBeVisible();
  await expect(watch.getByRole('img')).toBeVisible({timeout:10000});await capture('browser-return');
  await watch.getByRole('button',{name:'Back',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Browser source read'})).toBeVisible();
  const id=(await host.snapshot()).works[0].id;expect(browsers.state(id).driver).toBe('pip');
  await page.getByRole('button',{name:'Watch browser'}).click();
  await expect(watch.getByRole('img')).toBeVisible({timeout:10000});
  await watch.getByRole('button',{name:'Stop browser'}).click();await expect(watch.getByText('Browser stopped')).toBeVisible();await expect(watch.getByRole('img')).toBeHidden();await capture('browser-stopped');
  const state=await host.snapshot();expect(state.works[0].browserRequired).toBe(true);
  expect(JSON.stringify(state)).not.toContain('data:image');
 }finally{holdFrame=false;releaseFrame();await browsers.closeAll();await host.close();}
});
