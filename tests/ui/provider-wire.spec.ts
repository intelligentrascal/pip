import { test, expect } from '@playwright/test';
import {openMore} from '../helpers/chat-page.js';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Intent (ELF-30): the normal bundled renderer must consume the production service's
// ProvidersView envelope, not a hand-shaped provider array. No sign-in or inference.
test('production service envelopes render fresh state, Allow, active provider and backup updates', async ({ page }) => {
 const base=process.env.PIP_TEST_ROOT??path.join(os.tmpdir(),'pip-ui-fixtures');
 await mkdir(base,{recursive:true});
 const home=await mkdtemp(path.join(base,'pip-provider-wire-'));
 await writeFile(path.join(home,'.pip-test-home'),'pip-test-only');
 const service=spawn(process.execPath,['dist/service.js'],{env:{...process.env,PIP_HOME:home,PIP_TEST_ROOT:base,PIP_TEST:'1',PIP_NATIVE:'',PIP_ISOLATED_BACKENDS:''},stdio:['pipe','pipe','pipe']});
 const exited=new Promise<number|null>((resolve,reject)=>{service.once('error',reject);service.once('exit',resolve);});
 const errors:string[]=[],transcript:any[]=[],requests:any[]=[];
 let stderr='',ready=false,delivery=Promise.resolve();
 let firstState!:()=>void;
 const stateDelivered=new Promise<void>(resolve=>{firstState=resolve;});
 service.stderr.on('data',data=>{stderr+=data;});
 page.on('pageerror',error=>errors.push(error.message));
 const lines=createInterface({input:service.stdout});
 lines.on('line',line=>{
  const message=JSON.parse(line);transcript.push(message);
  if(ready)delivery=delivery.then(async()=>{
   try{await page.evaluate(m=>(window as any).pipReceive(m),message);}
   catch(error){errors.push(String(error));}
   finally{if(message.kind==='state')firstState();}
  });
 });
 await page.exposeFunction('pipTestBridge',(message:any)=>{
  if(message.kind==='resize')return;
  ready=true;requests.push(message);service.stdin.write(JSON.stringify(message)+'\n');
 });
 const capture=async(name:string)=>{if(process.env.PIP_CAPTURE_DIR)await page.screenshot({path:path.join(process.env.PIP_CAPTURE_DIR,name+'.png')});};
 try {
  await page.goto('/index.html');
  // Service startup and rendering are event-driven, bounded by the shared test
  // deadline, not an unrelated five-second polling budget under machine load.
  await stateDelivered;
  await openMore(page,'Settings');
  await capture('provider-wire-settings');
  expect(errors).toEqual([]);
  const initial=transcript.find(m=>m.kind==='state').payload.providers;
  expect(Array.isArray(initial.providers)).toBe(true);
  expect(initial.active).toBe('openai');expect(initial.backup).toBeNull();
  await expect(page.locator('[data-provider]')).toHaveCount(initial.providers.length);
  await expect(page.locator('[data-provider=openai]')).toContainText('Not connected · Not allowed · Active');
  await expect(page.locator('[data-provider=deepseek]')).toContainText('Not connected · Not allowed');
  await expect(page.locator('#provider-backup option')).toHaveText(['None']);
  await page.locator('[data-provider=openai]').scrollIntoViewIfNeeded();
  await capture('provider-wire-rows');

  // Only local Allow/settings writes: never connect a provider or send inference.
  await page.locator('[data-provider=openai]').getByRole('button',{name:'Review Allow'}).click();
  await expect(page.getByRole('heading',{name:'Let Pip send requests to ChatGPT plan?'})).toBeVisible();
  await page.getByRole('heading',{name:'Let Pip send requests to ChatGPT plan?'}).scrollIntoViewIfNeeded();
  await capture('provider-wire-allow');
  expect(requests.some(m=>m.kind==='submit'||m.kind==='provider.signIn')).toBe(false);
  await page.getByRole('button',{name:'Allow ChatGPT plan',exact:true}).click();
  await expect(page.locator('[data-provider=openai]')).toContainText('Not connected · Allowed · Active');
  await page.locator('[data-provider=deepseek]').getByRole('button',{name:'Review Allow'}).click();
  await page.getByRole('button',{name:'Allow DeepSeek',exact:true}).click();
  await expect(page.locator('#provider-backup option')).toHaveText(['None','DeepSeek']);
  await page.locator('#provider-backup').selectOption('deepseek');
  await expect(page.locator('[data-provider=deepseek]')).toContainText('Not connected · Allowed · Backup');
  await expect(page.locator('#provider-backup')).toHaveValue('deepseek');
  await page.locator('#provider-backup').scrollIntoViewIfNeeded();
  await capture('provider-wire-backup');

  // Selection through the private service command, with no key or model request.
  // A disconnected active provider must still render its name and not-ready state.
  service.stdin.write(JSON.stringify({version:1,id:'wire-select',kind:'provider.select',payload:{id:'deepseek'}})+'\n');
  await expect(page.locator('#result')).toContainText('DeepSeek is not ready.');
  await expect(page.locator('[data-provider=deepseek]')).toContainText('Not connected · Allowed · Active');
  await expect(page.locator('#provider-backup')).toHaveValue('');
  await expect(page.locator('[data-provider=deepseek]').getByRole('button',{name:'Use this model'})).toBeDisabled();
  service.stdin.write(JSON.stringify({version:1,id:'wire-select-openai',kind:'provider.select',payload:{id:'openai'}})+'\n');
  await expect(page.locator('[data-provider=openai]')).toContainText('Not connected · Allowed · Active');
  await page.locator('#provider-backup').selectOption('deepseek');
  await expect(page.locator('[data-provider=deepseek]')).toContainText('Backup');
  await page.locator('[data-provider=deepseek]').getByRole('button',{name:'Withdraw Allow'}).click();
  await expect(page.locator('[data-provider=deepseek]')).toContainText('Not connected · Not allowed');
  await expect(page.locator('#provider-backup')).toHaveValue('');
  expect(errors).toEqual([]);
  expect(requests.some(m=>m.kind==='submit'||m.kind==='provider.signIn'||m.kind==='provider.enterKey')).toBe(false);
 } finally {
  if(process.env.PIP_CAPTURE_DIR){
   await mkdir(process.env.PIP_CAPTURE_DIR,{recursive:true});
   await writeFile(path.join(process.env.PIP_CAPTURE_DIR,'provider-wire-transcript.json'),JSON.stringify({errors,transcript,requests},null,2));
  }
  ready=false;await delivery;service.stdin.end();expect(await exited,stderr).toBe(0);
 }
});
