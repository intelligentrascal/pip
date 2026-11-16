import { test, expect, type Page } from '@playwright/test';
import {openMore} from '../helpers/chat-page.js';

// Intent (captain, ELF-24): AI provider section in Settings, an Allow screen before any send,
// one named backup, and keys that never pass through the web page.
const providers=[
 {id:'openai',name:'ChatGPT plan',connect:'sign-in-page',connected:true,allowed:false,active:true,backup:false,model:'m',models:[{id:'m',label:'M'}],disclosure:{sends:['Your request.'],goes:'OpenAI, through your ChatGPT plan.',bills:'Your ChatGPT plan’s allowance.'},signingIn:false,message:''},
 {id:'openrouter',name:'OpenRouter',connect:'sign-in-page',connected:true,allowed:true,active:false,backup:false,model:'a',models:[{id:'a',label:'A'}],disclosure:{sends:['Your request.'],goes:'OpenRouter.',bills:'Your OpenRouter credit.'},signingIn:false,message:''},
 {id:'deepseek',name:'DeepSeek',connect:'secure-field',connected:false,allowed:false,active:false,backup:false,model:'d',models:[{id:'d',label:'D'}],disclosure:{sends:['Your request.','Approved remembered facts.'],goes:'DeepSeek’s own servers. DeepSeek’s policy says these are in China.',bills:'Your DeepSeek balance.'},signingIn:false,message:''}
];
async function open(page:Page,messages:any[]){
 await page.exposeFunction('pipTestBridge',(m:any)=>{messages.push(m);});
 await page.goto('/index.html');
 await page.evaluate(p=>(window as any).pipReceive({kind:'state',payload:{state:{composer:'',works:[],memory:[],proposals:[]},providers:{providers:p,active:'openai',backup:null},workViews:[]}}),providers);
 await openMore(page,'Settings');
}
test('Settings lists each provider, shows the Allow screen first, and offers a backup among allowed providers',async({page})=>{
 const messages:any[]=[];await open(page,messages);
 const chatgpt=page.locator('[data-provider=openai]');
 await expect(chatgpt).toContainText('Connected · Not allowed · Active');
 await expect(page.locator('[data-provider=deepseek]')).toContainText('Not connected');
 await expect(page.locator('#provider-backup option')).toHaveText(['None','OpenRouter']);
 await chatgpt.getByRole('button',{name:'Review Allow'}).click();
 await expect(page.getByRole('heading',{name:'Let Pip send requests to ChatGPT plan?'})).toBeVisible();
 await expect(page.getByText('Pip sends nothing to this provider until you choose Allow.')).toBeVisible();
 expect(messages.filter(m=>m.kind.startsWith('provider.'))).toEqual([]);
 await page.getByRole('button',{name:'Allow ChatGPT plan'}).click();
 expect(messages.find(m=>m.kind==='provider.allow')?.payload).toEqual({id:'openai'});
});
test('DeepSeek asks natively for its key: the page has no key field and sends only the provider id',async({page})=>{
 const messages:any[]=[];await open(page,messages);
 await expect(page.locator('input[type=password], [data-provider] input, [data-provider] textarea')).toHaveCount(0);
 await page.locator('[data-provider=deepseek]').getByRole('button',{name:'Enter key…'}).click();
 expect(messages.find(m=>m.kind==='provider.enterKey')?.payload).toEqual({id:'deepseek'});
 await page.locator('[data-provider=deepseek]').getByRole('button',{name:'Review Allow'}).click();
 await expect(page.getByText('DeepSeek’s policy says these are in China.')).toBeVisible();
});
