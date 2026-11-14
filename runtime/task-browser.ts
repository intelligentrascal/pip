import { chromium, type Browser, type BrowserContext, type Page, type CDPSession } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { browserProxy, browserURL } from './browser-network.js';

export type BrowserReading = {revision:number;url:string;title:string;text:string;truncated:boolean;links:{ref:string;title:string;url:string}[]};
export type BrowserTools = {inspect:()=>Promise<BrowserReading>;navigate:(ref:string,revision:number)=>Promise<BrowserReading>;scroll:(direction:'up'|'down',revision:number)=>Promise<BrowserReading>};
export type BrowserState = {workId:string;driver:'pip'|'pausing'|'captain'|'stopped';revision:number;url:string;title:string;activity:string;frameAt?:string;pages:string[]};
type Session = {inspected?:boolean;state:BrowserState;browser?:Browser;context?:BrowserContext;page?:Page;cdp?:CDPSession;proxy?:Awaited<ReturnType<typeof browserProxy>>;opening?:Promise<void>;closing?:Promise<void>;busy?:Promise<unknown>;refs:Map<string,string>;generation:number};
export class TaskBrowsers {
 private sessions=new Map<string,Session>();
 constructor(private changed:(state:BrowserState)=>void=()=>{},private options:{headless?:boolean;fixture?:{respond:(url:string)=>{body:string;contentType:string}|undefined}}={}){}
 grant(workId:string,pages:unknown) {
  if(!/^[a-zA-Z0-9-]{1,100}$/.test(workId)||this.sessions.has(workId))throw Error('This task already has a browser.');
  if(!Array.isArray(pages)||!pages.length||pages.length>8)throw Error('Review between one and eight public HTTPS pages.');
  const allowed=[...new Set(pages.map(browserURL))];
  const session:Session={state:{workId,driver:'pip',revision:0,url:allowed[0],title:'Not opened yet',activity:'Reviewed page scope; browser not opened yet.',pages:allowed},refs:new Map(),generation:0};
  this.sessions.set(workId,session);this.publish(session);
 }
 has(id:string){return this.sessions.has(id);}
 state(id:string){return structuredClone(this.session(id).state);}
 private session(id:string){const s=this.sessions.get(id);if(!s)throw Error('No browser belongs to this task.');return s;}
 private publish(s:Session){this.changed(structuredClone(s.state));}
 private invalidate(s:Session){s.inspected=false;s.state.revision++;s.refs.clear();s.generation++;}
 private async open(s:Session) {
  if(s.page)return;
  if(s.opening)return s.opening;
  s.opening=(async()=>{
   s.proxy=await browserProxy(s.state.pages);
   try{
    if(this.state(s.state.workId).driver==='stopped')throw Error('Browser stopped.');
    s.browser=await chromium.launch({channel:'chrome',chromiumSandbox:true,headless:this.options.headless??false,proxy:{server:s.proxy.url,bypass:'<-loopback>'},args:['--disable-quic','--disable-background-networking','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']});
    s.browser.on('disconnected',()=>{void this.close(s.state.workId);});
    s.context=await s.browser.newContext({viewport:{width:1100,height:720},acceptDownloads:false,serviceWorkers:'block',permissions:[]});
    s.context.setDefaultTimeout(10000);s.context.setDefaultNavigationTimeout(15000);
    await s.context.routeWebSocket('**/*',socket=>socket.close());
    await s.context.route('**/*',async route=>{
     try {
      const request=route.request(),url=browserURL(request.url());
      const origins=s.state.pages.map(p=>new URL(p).origin);
      if(!origins.includes(new URL(url).origin)||s.state.driver==='stopped')throw Error();
      if(s.state.driver!=='captain'&&request.method()!=='GET')throw Error();
      if(request.isNavigationRequest()&&s.state.driver!=='captain'&&!s.state.pages.includes(url))throw Error();
      const fixture=this.options.fixture?.respond(url);
      if(fixture)await route.fulfill({status:200,...fixture});else await route.continue();
     } catch {await route.abort('blockedbyclient').catch(()=>{});}
    });
    s.page=await s.context.newPage();
    s.context.on('page',page=>{if(page!==s.page)void page.close();});
    s.page.on('download',download=>void download.cancel());
    s.page.on('dialog',dialog=>void dialog.dismiss());
    s.page.on('framenavigated',frame=>{if(frame===s.page?.mainFrame()){this.invalidate(s);}});
    s.page.on('close',()=>{void this.close(s.state.workId);});
    s.cdp=await s.context.newCDPSession(s.page);
    if(!this.options.headless)await this.window(s,'minimized');
    if(this.state(s.state.workId).driver==='stopped')throw Error('Browser stopped.');
    await s.page.goto(s.state.pages[0],{waitUntil:'domcontentloaded'});
   }catch(error){await s.browser?.close();await s.proxy?.close();s.page=undefined;s.state.driver='stopped';s.state.activity='Browser could not open. No account or personal profile was used.';this.publish(s);throw error;}
  })();
  return s.opening;
 }
 private async window(s:Session,state:'normal'|'minimized'){
  const {windowId}=await s.cdp!.send('Browser.getWindowForTarget');
  await s.cdp!.send('Browser.setWindowBounds',{windowId,bounds:{windowState:state}});
 }
 private async run<T>(id:string,action:(s:Session)=>Promise<T>):Promise<T>{
  const s=this.session(id);
  if(s.state.driver!=='pip')throw Error('Pip cannot use this browser while you drive or it is stopped.');
  const previous=s.busy;
  const operation=(async()=>{await previous?.catch(()=>{});if(s.state.driver!=='pip')throw Error('Browser control changed. Inspect it again.');await this.open(s);if(s.state.driver!=='pip')throw Error('Browser control changed. Inspect it again.');return action(s);})();
  s.busy=operation;
  try{return await operation;}finally{if(s.busy===operation)s.busy=undefined;}
 }
 private async requireReadable(s:Session){
  if(await s.page!.locator('input[type="password"],input[autocomplete="one-time-code"]').count())throw Error('Sign-in or verification fields need private takeover. Pip did not read or capture this page.');
 }
 private async reading(s:Session):Promise<BrowserReading>{
  if(s.state.driver!=='pip')throw Error('The captain has control.');
  const url=browserURL(s.page!.url());if(!s.state.pages.includes(url))throw Error('This page needs source-scope review.');
  await this.requireReadable(s);
  this.invalidate(s);const generation=s.generation;
  const title=(await s.page!.title()).slice(0,250)||new URL(url).hostname;
  const content=await s.page!.locator('body').evaluate(body=>{const text=(body as HTMLElement).innerText;return {text:text.slice(0,24000),truncated:text.length>24000};},{},{timeout:5000});
  const anchors=await s.page!.locator('a[href]').evaluateAll(elements=>elements.slice(0,80).map(e=>({url:(e as HTMLAnchorElement).href,title:(e.textContent??'').slice(0,150)})));
  if(s.state.driver!=='pip'||generation!==s.generation||s.page!.url()!==url)throw Error('Control or page changed during inspection. Inspect again.');
  const links=anchors.filter(a=>s.state.pages.includes(a.url)).map(a=>{const ref=randomUUID();s.refs.set(ref,a.url);return {ref,...a};});
  s.inspected=true;s.state.url=url;s.state.title=title;s.state.activity='Read the reviewed page.';this.publish(s);
  // Never inspect input values, secure fields, cookies, storage or hidden tabs.
  return {revision:s.state.revision,url,title,...content,links};
 }
 tools(id:string):BrowserTools|undefined {
  if(!this.has(id)||this.session(id).state.driver==='stopped')return;
  return {
   inspect:()=>this.run(id,s=>this.reading(s)),
   navigate:(ref,revision)=>this.run(id,async s=>{
    const url=s.refs.get(ref);if(revision!==s.state.revision||!url)throw Error('That page reference expired. Inspect the page again.');
    // Link refs are URL targets, not positional clicks. Revalidate live membership.
    if(!await s.page!.locator('a[href]').evaluateAll((nodes,url)=>nodes.some(n=>(n as HTMLAnchorElement).href===url),url))throw Error('The page changed. Inspect it again.');
    if(s.state.driver!=='pip'||revision!==s.state.revision)throw Error('Control or page changed. Inspect again.');
    this.invalidate(s);s.state.activity='Opening a reviewed reading page.';this.publish(s);
    await s.page!.goto(url,{waitUntil:'domcontentloaded'});return this.reading(s);
   }),
   scroll:(direction,revision)=>this.run(id,async s=>{
    if(!s.inspected||revision!==s.state.revision||!['up','down'].includes(direction))throw Error('That page reference expired. Inspect the page again.');
    await s.page!.evaluate(direction=>window.scrollBy(0,direction==='down'?560:-560),direction);s.state.activity='Scrolled the current page.';this.publish(s);return this.reading(s);
   })
  };
 }
 async watch(id:string):Promise<{state:BrowserState;frame?:string}>{
  const current=this.session(id);
  if(current.state.driver==='pip'&&current.busy)return {state:this.state(id)};
  return this.run(id,async s=>{
  const currentURL=browserURL(s.page!.url());
  if(!s.state.pages.includes(currentURL)){
   // A private sign-in callback can contain a code in its path/query. Even after
   // handback, an unreviewed destination contributes only its origin to the UI.
   s.state.url=new URL(currentURL).origin;s.state.title='Page outside reviewed scope';s.state.activity='This page needs source review. Start a new task or take over to return to a reviewed page.';this.publish(s);return {state:this.state(id)};
  }
  await this.requireReadable(s);
  s.state.url=currentURL;s.state.title=(await s.page!.title()).slice(0,250)||new URL(currentURL).hostname;
  if(s.state.driver!=='pip')throw Error('Private takeover has no Watch frames.');
  const generation=s.generation;
  const frame=await s.page!.screenshot({type:'jpeg',quality:65,timeout:5000});
  if(s.state.driver!=='pip'||s.generation!==generation||s.page!.url()!==currentURL)throw Error('Control or page changed. This frame was discarded.');
  s.state.frameAt=new Date().toISOString();this.publish(s);
  return {state:this.state(id),frame:frame.toString('base64')};
 });}
 async takeOver(id:string){
  const s=this.session(id);if(s.state.driver!=='pip')throw Error('This browser is not available for takeover.');
  s.state.driver='pausing';this.invalidate(s);s.state.activity='Pausing Pip before private takeover.';this.publish(s);
  try{await s.busy?.catch(()=>{});await this.open(s);if(this.state(id).driver==='stopped')throw Error('Browser stopped.');
   await s.cdp!.send('Page.stopLoading');if(!this.options.headless)await this.window(s,'normal');
   if(this.state(id).driver!=='pausing')throw Error('The task browser closed during takeover.');
   s.state.driver='captain';s.state.activity='You drive in the task browser. Pip cannot inspect, capture or enter anything.';this.publish(s);return this.state(id);
  }catch(error){await this.close(id);throw error;}
 }
 async returnControl(id:string){
  const s=this.session(id);if(s.state.driver!=='captain')throw Error('The captain is not driving this browser.');
  if(!this.options.headless)await this.window(s,'minimized');
  if(this.state(id).driver!=='captain')throw Error('The task browser closed before control returned.');
  this.invalidate(s);s.state.driver='pip';s.state.activity='Control returned. Fresh inspection is required; no submission authority was granted.';this.publish(s);
  // No stale refs survive handback. Tools must explicitly inspect before acting.
  return this.state(id);
 }
 async close(id:string){
  const s=this.session(id);if(s.closing)return s.closing;
  s.state.driver='stopped';this.invalidate(s);s.state.activity='Stopping. Further browser commands are blocked.';this.publish(s);
  s.closing=(async()=>{
   await s.opening?.catch(()=>{});await s.browser?.close();await s.proxy?.close();
   s.page=undefined;s.context=undefined;s.cdp=undefined;s.browser=undefined;s.proxy=undefined;
   s.state.activity='Stopped. Browser session and private data discarded.';this.publish(s);
  })();
  return s.closing;
 }
 async command(id:string,op:unknown){
  switch(op){
   case 'state':return {state:this.state(id)};
   case 'watch':return this.watch(id);
   case 'takeover':return {state:await this.takeOver(id)};
   case 'return':return {state:await this.returnControl(id)};
   case 'close':await this.close(id);return {state:this.state(id)};
   default:throw Error('Unsupported browser operation.');
  }
 }
 async closeAll(){await Promise.all([...this.sessions.keys()].map(id=>this.close(id)));}
}
