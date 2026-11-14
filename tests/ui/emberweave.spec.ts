import { test, expect, type Page } from '@playwright/test';
import { armFirstVisiblePolygon, readFirstVisiblePolygon } from '../helpers/first-visible-polygon.js';

// Intent (captain, ELF-18/ELF-20): the popup unrolls like a scroll from Pip's hand, outwards and upwards;
// the mascot is not on top; every state has its own contextual effect, with approval, blocked and listening
// told apart; GPU effects, no sound; reduced motion keeps readable still poses.
// Real production page in Chromium with the bridge stubbed; native WKWebView timing is proved separately.
const view={width:660,height:620};
async function open(page:Page,messages:any[]=[]){
 await page.setViewportSize(view);
 await page.exposeFunction('pipTestBridge',(m:any)=>{messages.push(m);});
 await page.goto('/index.html');await expect(page.locator('#composer')).toBeVisible();
}
const receive=(page:Page,message:unknown)=>page.evaluate(m=>(window as any).pipReceive(m),message);
const work=(status:string,extra:object={})=>({id:'w1',request:'Help me plan my day',status,...extra});
const setState=(page:Page,works:any[],proposals:any[]=[],workViews:any[]=[])=>receive(page,{kind:'state',payload:{state:{composer:'',works,memory:[],proposals},claudeAllowed:false,workViews}});
const settled=(page:Page)=>expect(page.locator('#surface')).toHaveAttribute('data-motion','still',{timeout:5000});
const rect=(page:Page,selector:string)=>page.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};});
// The prop ids drawn for the current state: what a person can tell apart without reading any text.
const props=(page:Page)=>page.evaluate(()=>{
 const ids=new Set<string>();
 for(const group of document.querySelectorAll<SVGElement>('#ew-props [data-for]')){
  if(getComputedStyle(group).display==='none')continue;
  if(group.id)ids.add(group.id);group.querySelectorAll('[id]').forEach(e=>ids.add(e.id));
 }
 if(Number(document.getElementById('ew-quill')!.getAttribute('opacity'))>0)ids.add('ew-quill');
 return [...ids].sort();
});

test('summon unrolls the page from Pip\'s palm, up and outwards, with Pip beside it and input never waiting',async({page})=>{
 await open(page);await settled(page);
 const composerRest=await rect(page,'#composer');
 // ELF-26: arm without awaiting motion; typing must not move the observation boundary.
 await page.evaluate(armFirstVisiblePolygon);
 await receive(page,{kind:'summon',payload:{}});
 await page.evaluate(()=>document.getElementById('composer').focus());
 await page.keyboard.type('typing starts at once');
 await expect(page.locator('#composer')).toHaveValue('typing starts at once');
 // Consume the first eligible observed polygon, not whichever phase follows typing.
 // Positivity remains an assertion below, never a filter that could skip an absent early phase.
 const early=await page.evaluate(readFirstVisiblePolygon);
 expect(early.left).toBeGreaterThan(0);expect(early.top).toBeGreaterThan(0);expect(early.rolled).toBe(true);
 await settled(page);
 await expect(page.locator('.panel')).toHaveCSS('clip-path','none');
 expect(await rect(page,'#composer')).toEqual(composerRest);
 const panel=await rect(page,'.panel'),pip=await rect(page,'#apparition');
 // Pip stands beside the page, not above it, with his palm at the page's lower right corner.
 expect(pip.top).toBeGreaterThan(panel.top);expect(pip.bottom).toBeGreaterThan(panel.bottom);
 const palm={x:pip.left+pip.width*.34,y:pip.top+pip.height*.44};
 expect(Math.abs(palm.x-panel.right)).toBeLessThan(8);expect(Math.abs(palm.y-panel.bottom)).toBeLessThan(8);
 // GPU effects ran, and the frame loop stops once the finite event settles.
 const gpu=await page.locator('#ew-fx').evaluate(c=>({...c.dataset}));
 expect(gpu.renderer).toBe('webgl2');expect(gpu.atlas).toBe('generated-r8-pack');expect(Number(gpu.draws)).toBeGreaterThan(5);
 await page.waitForTimeout(400);
 expect(await page.locator('#ew-fx').evaluate(c=>(c as HTMLElement).dataset.draws)).toBe(gpu.draws);
});

test('approval, blocked, unknown, done, working, thinking and listening each have their own still props',async({page})=>{
 await open(page);await receive(page,{kind:'summon',payload:{}});await settled(page);
 const seen:Record<string,string[]>={};
 const go=async(name:string,run:()=>Promise<unknown>)=>{await run();await settled(page);await page.waitForTimeout(60);seen[name]=await props(page);};
 await go('thinking',()=>setState(page,[work('Queued')]));
 await go('working',()=>setState(page,[work('Working')]));
 await go('approval',()=>setState(page,[work('Working')],[{id:'p1',status:'proposed',revision:1,digest:'d',action:{type:'memory.save',text:'I prefer walking routes.',source:'x'}}]));
 await go('blocked',()=>setState(page,[work('Blocked',{error:'Calendar is not connected.'})]));
 await go('unknown',()=>setState(page,[work('Working')],[{id:'p2',status:'unknown',receipt:'Unconfirmed',action:{type:'memory.save',text:'x'}}]));
 await go('done',()=>setState(page,[work('Done',{result:{kind:'answer',title:'Saved',text:'ok',sources:[],model:'fixture'}})],[],[{id:'w1',status:'Done'}]));
 expect(seen.approval).toEqual(expect.arrayContaining(['ew-rest-line','ew-clip','ew-quill']));
 expect(seen.approval).not.toContain('ew-fold-band');
 expect(seen.blocked).toEqual(expect.arrayContaining(['ew-fold-band','ew-fold-flap','ew-thread','ew-quill']));
 expect(seen.blocked).not.toContain('ew-clip');
 expect(seen.unknown).toContain('ew-knot');expect(seen.done).toContain('ew-seal');
 expect(seen.thinking).toEqual(expect.arrayContaining(['ew-islands','ew-route']));expect(seen.thinking).not.toContain('ew-quill');
 expect(seen.working).toEqual(expect.arrayContaining(['ew-rail-line','ew-writing']));
 // No two states share a prop set, so none can be mistaken for another by its drawing alone.
 const keys=Object.values(seen).map(v=>v.join('|'));expect(new Set(keys).size).toBe(keys.length);
});

test('listening is an ear pose and a meter that follows only the measured input level',async({page})=>{
 const messages:any[]=[];await open(page,messages);await receive(page,{kind:'summon',payload:{}});await settled(page);
 await page.getByRole('button',{name:'Talk',exact:true}).click();
 await expect.poll(()=>messages.filter(m=>m.kind==='dictation.start').length).toBe(1);
 const session=messages.find(m=>m.kind==='dictation.start').payload.session;
 const heights=()=>page.locator('#ew-meter rect').evaluateAll(r=>r.map(e=>Number(e.getAttribute('height'))));
 // Starting is not listening: no marker and no ear pose until native capture reports it.
 await expect(page.locator('#ew-props')).not.toHaveAttribute('data-scene','listening');
 await receive(page,{kind:'dictation',payload:{session,state:'capturing',text:'',message:'Listening on this Mac.'}});
 await expect(page.locator('#ew-props')).toHaveAttribute('data-scene','listening');await expect(page.locator('pip-character')).toHaveAttribute('data-state','listening');
 await settled(page);
 await receive(page,{kind:'dictation',payload:{session,state:'level',level:0}});
 expect((await heights()).every(h=>h===2)).toBe(true);
 await receive(page,{kind:'dictation',payload:{session,state:'level',level:.9}});
 const loud=await heights();expect(Math.max(...loud)).toBeGreaterThan(10);
 await receive(page,{kind:'dictation',payload:{session:'someone-else',state:'level',level:0}});expect(await heights()).toEqual(loud);
 await receive(page,{kind:'dictation',payload:{session,state:'review',text:'hello',message:'Review'}});
 await expect(page.locator('#ew-props')).not.toHaveAttribute('data-scene','listening');expect((await heights()).every(h=>h===2)).toBe(true);
});

test('Close rolls the page back into Pip and ends with neither showing; a second request hides at once',async({page})=>{
 const messages:any[]=[];await open(page,messages);await receive(page,{kind:'summon',payload:{}});await settled(page);
 await page.getByRole('button',{name:'Hide Pip popup',exact:true}).click();
 await expect.poll(()=>page.locator('.panel').evaluate(p=>(p as HTMLElement).style.clipPath)).not.toBe('');
 expect(messages.some(m=>m.kind==='hide')).toBe(false);
 await expect.poll(()=>messages.some(m=>m.kind==='hide'),{timeout:2000}).toBe(true);
 await receive(page,{kind:'popupHidden',payload:{}});
 await expect(page.locator('.panel')).toHaveCSS('clip-path',/^inset\(100% 0(px|%) 0(px|%) 100%\)$/);
 expect(Number(await page.locator('#apparition').evaluate(e=>getComputedStyle(e).opacity))).toBe(0);
 // Re-summon shows page and Pip again; Escape twice during the roll-back hides immediately.
 await receive(page,{kind:'summon',payload:{}});await settled(page);messages.length=0;
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 await expect.poll(()=>messages.filter(m=>m.kind==='hide').length,{timeout:300}).toBeGreaterThan(0);
});

test('reduced motion cuts to still, distinct poses with no GPU frames and no running animation',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 const messages:any[]=[];await open(page,messages);
 await receive(page,{kind:'summon',payload:{}});
 await expect(page.locator('.panel')).toHaveCSS('clip-path','none');
 await setState(page,[work('Working')],[{id:'p1',status:'proposed',revision:1,digest:'d',action:{type:'memory.save',text:'x',source:'x'}}]);
 expect(await props(page)).toEqual(expect.arrayContaining(['ew-rest-line','ew-clip','ew-quill']));
 await setState(page,[work('Blocked',{error:'No calendar.'})]);expect(await props(page)).toEqual(expect.arrayContaining(['ew-fold-band','ew-thread']));
 expect(await page.locator('#ew-fx').evaluate(c=>(c as HTMLElement).dataset.draws??'0')).toBe('0');
 expect(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
 await page.getByRole('button',{name:'Hide Pip popup',exact:true}).click();
 await expect.poll(()=>messages.some(m=>m.kind==='hide')).toBe(true);
});

test('Browse and Watch fit 660 by 620, remove the frame in private control and stay still under reduced motion',async({page})=>{
 const messages:any[]=[];await page.emulateMedia({reducedMotion:'reduce'});await open(page,messages);
 await page.getByRole('button',{name:'Browse',exact:true}).click();
 await page.getByLabel('What should Pip do?').fill('Read the public page');await page.getByLabel(/Reviewed page addresses/).fill('https://example.com/');
 await page.getByRole('button',{name:'Start reviewed browser task'}).click();
 await expect.poll(()=>messages.some(m=>m.kind==='browser')).toBe(true);
 const base=(driver:string,revision:number)=>({workId:messages.find(m=>m.kind==='submit').id,revision,driver,url:'https://example.com/',title:'Example',activity:'Reading',frameAt:1});
 const jpeg='/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
 const browserCommand=messages.filter(m=>m.kind==='browser').at(-1);
 await receive(page,{id:browserCommand.id,kind:'browserResult',payload:{state:base('pip',1),frame:jpeg}});
 const watchImage=page.locator('pip-task-browser img');await expect(watchImage).toBeVisible();
 const panel=await rect(page,'.panel'),pip=await rect(page,'#apparition');
 expect(panel.top).toBeGreaterThanOrEqual(0);expect(pip.bottom).toBeLessThanOrEqual(view.height);expect(pip.right).toBeLessThanOrEqual(view.width);expect(panel.right).toBeLessThanOrEqual(pip.left+pip.width*.5);
 // A private Take over removes the frame and keeps it removed.
 await receive(page,{kind:'browserState',payload:base('captain',2)});
 await expect(watchImage).toBeHidden();await expect(watchImage).not.toHaveAttribute('src',/.+/);
 await expect(page.getByText('You are driving · Private')).toBeVisible();
 expect(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
});

// Intent (captain, ELF-32): a quick repeat summon plays a short version (about 300 ms) instead of the
// full 1,350 ms arrival. A controlled page clock stands in for time, so nothing here waits.
test('a quick repeat summon settles in about 300 ms while the first plays in full',async({page})=>{
 await page.clock.install();await open(page);await page.clock.runFor(2000);await settled(page);
 const motion=()=>page.locator('#surface').getAttribute('data-motion');
 await receive(page,{kind:'summon',payload:{}});
 await page.clock.runFor(500);expect(await motion()).toBe('playing');
 await page.clock.runFor(1500);expect(await motion()).toBe('still');
 await receive(page,{kind:'summon',payload:{}});
 await page.clock.runFor(200);expect(await motion()).toBe('playing');
 await page.clock.runFor(200);expect(await motion()).toBe('still');
});
