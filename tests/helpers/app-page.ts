import type {Page} from '@playwright/test';
import {initialState} from '../../runtime/domain.js';

/** Pip's real page with a recording stand-in for the native bridge. `native` is the host's status message, so a test can say what the Mac reports. */
export async function openApp(page:Page,native:Record<string,unknown>={}){
 const sent:any[]=[];
 await page.exposeFunction('pipTestBridge',(message:any)=>{sent.push(message);if(message.kind==='snapshot')void page.evaluate(state=>(window as any).pipReceive({kind:'state',payload:{state,workViews:[]}}),initialState());});
 await page.goto('/');
 await page.evaluate(native=>(window as any).pipReceive({kind:'nativeStatus',payload:{hotkey:'⌘⇧E',visibleHeight:800,...native}}),native);
 await page.evaluate(()=>document.querySelector<any>('pip-character').ready);
 return {sent,receive:(message:object)=>page.evaluate(message=>(window as any).pipReceive(message),message)};
}
