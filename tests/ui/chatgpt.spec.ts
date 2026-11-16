import {test,expect,type Page} from '@playwright/test';
import {openMore} from '../helpers/chat-page.js';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ProviderManager} from '../../runtime/providers.js';
import {openaiProvider} from '@earendil-works/pi-ai/providers/openai';

// Intent: ELF-24/26, ChatGPT Settings and Allow use the real manager/bridge, with
// sign-in kept on the provider’s page. This OAuth stand-in is not account proof.
test.use({viewport:{width:680,height:1100},reducedMotion:'reduce'});
async function open(page:Page){
 const root=process.env.PIP_TEST_ROOT??path.join(os.tmpdir(),'pip-ui-fixtures');await mkdir(root,{recursive:true});const home=await mkdtemp(path.join(root,'chatgpt-ui-'));await writeFile(path.join(home,'.pip-test-home'),'pip-test-only');
 const messages:any[]=[];let finishLogin:()=>void=()=>{};
 let loginReady=Promise.resolve();let loginStarted:()=>void=()=>{};
 let ready=false;
 const receive=async()=>{if(ready)await page.evaluate(providers=>(window as any).pipReceive({kind:'state',payload:{state:{composer:'',works:[],memory:[],proposals:[]},providers,workViews:[]}}),await manager.view());};
 const manager=new ProviderManager({home,notify:e=>{if(e.type==='changed')void receive();}});
 manager.models.setProvider({...openaiProvider(),auth:{oauth:{name:'Protocol fixture — not live ChatGPT',login:async interaction=>new Promise((yes,no)=>{
  finishLogin=()=>yes({type:'oauth',access:'pip-ui-fixture-access',refresh:'pip-ui-fixture-refresh',expires:Date.now()+3600000});loginStarted();
  interaction.signal.addEventListener('abort',()=>no(Error('Cancelled')),{once:true});
 }),refresh:async c=>c,toAuth:async c=>({apiKey:c.access})}}});
 await page.exposeFunction('pipTestBridge',async(m:any)=>{
  messages.push(m);const id=m.payload.id;
  if(m.kind==='provider.allow')await manager.allow(id);
  if(m.kind==='provider.select')await manager.select(id,m.payload.model);
  if(m.kind==='provider.signIn'){loginReady=new Promise<void>(yes=>{loginStarted=yes;});await manager.signIn(id);}
  if(m.kind==='provider.cancelSignIn')await manager.cancelSignIn(id);
  if(m.kind==='provider.remove')await manager.remove(id);
  if(m.kind==='provider.backup')await manager.setBackup(id);
 });
 await page.goto('/');ready=true;await receive();await openMore(page,'Settings');
 return {manager,messages,finishLogin:async()=>{await loginReady;finishLogin();}};
}
async function capture(page:Page,name:string){if(process.env.PIP_CAPTURE_DIR)await page.screenshot({path:path.join(process.env.PIP_CAPTURE_DIR,name+'.png'),clip:{x:25,y:375,width:640,height:710}});}

test('ChatGPT Allow, waiting, cancel, connection, model, backup and Remove preserve private boundaries',async({page})=>{
 const env=await open(page);const row=page.locator('[data-provider=openai]');
 await row.scrollIntoViewIfNeeded();await expect(row).toContainText('Not connected · Not allowed');await expect(row.getByRole('button',{name:'Use this model',exact:true})).toBeDisabled();
 await capture(page,'settings-after');
 await row.getByRole('button',{name:'Review Allow'}).click();await expect(page.getByRole('heading',{name:'Let Pip send requests to ChatGPT plan?'})).toBeVisible();
 await page.getByRole('heading',{name:'Let Pip send requests to ChatGPT plan?'}).scrollIntoViewIfNeeded();await capture(page,'chatgpt-allow-top');
 await page.getByRole('button',{name:'Allow ChatGPT plan',exact:true}).scrollIntoViewIfNeeded();
 await expect(page.getByText('Your ChatGPT plan’s allowance and the limits you approve on OpenAI’s sign-in page. This is not API-key billing.')).toBeVisible();await capture(page,'chatgpt-allow-bottom');
 expect(env.messages.filter(m=>m.kind.startsWith('provider.'))).toEqual([]);
 await page.getByRole('button',{name:'Allow ChatGPT plan',exact:true}).click();
 await row.getByRole('button',{name:'Continue with ChatGPT'}).click();
 await expect(row.getByRole('button',{name:'Waiting for sign-in…'})).toBeDisabled();
 await row.scrollIntoViewIfNeeded();await capture(page,'chatgpt-waiting');
 await row.getByRole('button',{name:'Cancel sign-in'}).click();await expect(row).toContainText('Sign-in was cancelled.');
 await row.getByRole('button',{name:'Continue with ChatGPT'}).click();await expect(row.getByRole('button',{name:'Waiting for sign-in…'})).toBeDisabled();await env.finishLogin();
 await expect(row).toContainText('Connected · Allowed');await expect(page.locator('input[type=password], [data-provider] input, [data-provider] textarea')).toHaveCount(0);
 await capture(page,'chatgpt-connected-fixture');
 // The already-allowed ChatGPT connection may be named as the one backup while another provider is active.
 await env.manager.select('deepseek');await expect(page.locator('[data-provider=deepseek]')).toContainText('Active');
 await expect(page.locator('#provider-backup option')).toHaveText(['None','ChatGPT plan']);
 await page.locator('#provider-backup').selectOption('openai');await expect(row).toContainText('Backup');
 await row.getByRole('button',{name:'Use ChatGPT plan',exact:true}).click();await expect(row).toContainText('Active');
 expect((await env.manager.view()).active).toBe('openai');expect((await env.manager.view()).backup).toBeNull();
 await row.getByRole('button',{name:'Remove',exact:true}).click();await expect(row).toContainText('Not connected · Allowed · Active');
 expect(await env.manager.connected('openai')).toBe(false);
 expect(env.messages.filter(m=>m.kind==='provider.signIn').every(m=>JSON.stringify(m.payload)==='{"id":"openai"}')).toBe(true);
});
