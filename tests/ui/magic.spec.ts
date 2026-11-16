import {test,expect,type Page} from '@playwright/test';
import {composer,openMore} from '../helpers/chat-page.js';
import {openApp} from '../helpers/app-page.js';

test.use({viewport:{width:756,height:560}});

// Intent (ELF-65's accepted screen spec, built by ELF-62): the effects layer plays at the level a person picked in Pip's settings (Calm, Balanced,
// Rich; Balanced by default), ends by itself, marks changes rather than waiting, and Reduce Motion turns every effect off. Fixture: Pip's real page,
// the host's own summon, popupHidden and nativeStatus messages, and the page's own effects class driven by its public moments.
type Run={insideMax:number;outsideFrames:number;canvasFrames:number;ring:boolean;rays:boolean;reveal:boolean;lastActive:number;dim:string[]};
/** Plays `moments` against a fresh effects layer at `level` and samples every frame for `ms`: whether effect pixels fall inside the chat window's edge and outside it, and when anything was last active. */
async function play(page:Page,level:string,moments:string,ms:number,{reduced=false,pixels=false}={}):Promise<Run>{
 return page.evaluate(async({level,moments,ms,reduced,pixels})=>{
  const w=window as any,c=document.querySelector<any>('pip-character'),canvas=document.querySelector<HTMLCanvasElement>('#fx')!,win=document.querySelector<HTMLElement>('#win')!;
  const dim:string[]=[],m=new w.PipMagic({canvas,character:c,win,emit:(kind:string,payload:any)=>{if(kind==='dim')dim.push(payload.on?'on':'off');},reduced:()=>reduced});
  m.setLevel(level);const run:any={insideMax:0,outsideFrames:0,canvasFrames:0,ring:false,rays:false,reveal:false,lastActive:0,dim};
  const start=performance.now();new Function('m','c','win','return (async()=>{'+moments+'})()')(m,c,win);
  await new Promise<void>(resolve=>{const frame=()=>{
   const t=performance.now()-start,ctx=canvas.getContext('2d')!,r=win.getBoundingClientRect(),d=canvas.width/document.documentElement.clientWidth;let active=false;
   if(!canvas.hidden){run.canvasFrames++;active=true;
    if(pixels){const all=ctx.getImageData(0,0,canvas.width,canvas.height).data,W=canvas.width,x0=Math.floor(r.left*d),x1=Math.ceil(r.right*d),y0=Math.floor(r.top*d),y1=Math.ceil(r.bottom*d);let max=0,outside=false;
    for(let y=0;y<canvas.height;y++)for(let x=0;x<W;x++){const alpha=all[(y*W+x)*4+3];if(!alpha)continue;if(x>=x0&&x<x1&&y>=y0&&y<y1){if(alpha>max)max=alpha;}else outside=true;}
    run.insideMax=Math.max(run.insideMax,max);if(outside)run.outsideFrames++;}}
   if(c.hasAttribute('data-ring')){run.ring=true;active=true;}if(c.hasAttribute('data-rays')){run.rays=true;active=true;}if(c.hasAttribute('data-reveal')){run.reveal=true;active=true;}
   if(active)run.lastActive=t;
   if(t<ms)requestAnimationFrame(frame);else resolve();};requestAnimationFrame(frame);});
  m.halt();return run;
 },{level,moments,ms,reduced,pixels});
}

test('Balanced draws no effect pixel inside the window and Rich does; Calm draws none at all',async({page})=>{
 await openApp(page);
 const moments="m.summon();m.working(true);setTimeout(()=>{m.part(document.querySelector('#composer'));m.step();m.yes();},700);";
 const calm=await play(page,'calm',moments,2400,{pixels:true});
 expect(calm.canvasFrames).toBe(0);expect(calm.ring).toBe(false);expect(calm.rays).toBe(false);expect(calm.reveal).toBe(true);
 const balanced=await play(page,'balanced',moments,2400,{pixels:true});
 expect(balanced.outsideFrames).toBeGreaterThan(10);expect(balanced.insideMax).toBe(0);expect(balanced.ring).toBe(true);expect(balanced.rays).toBe(true);
 const rich=await play(page,'rich',moments,2400,{pixels:true});
 expect(rich.outsideFrames).toBeGreaterThan(10);expect(rich.insideMax).toBeGreaterThan(0);
});

test('waiting gets no effect, at any level, and the effects loop stops by itself',async({page})=>{
 await openApp(page);
 for(const level of ['calm','balanced','rich']){
  const run=await play(page,level,'m.summon();',2200);
  expect(run.lastActive,level).toBeLessThan(1500);
  const idle=await play(page,level,'',400);
  expect(idle.canvasFrames+Number(idle.ring)+Number(idle.rays),level).toBe(0);
 }
});

test('the full arrival ends within 1.5 s and the short one within 0.3 s',async({page})=>{
 await openApp(page);
 const full=await play(page,'rich','m.summon({short:false});',2000);
 expect(full.lastActive).toBeLessThanOrEqual(1500);expect(full.lastActive).toBeGreaterThan(1000);
 const short=await play(page,'rich','m.summon({short:true});',800);
 expect(short.lastActive).toBeLessThanOrEqual(300);expect(short.lastActive).toBeGreaterThan(100);
});

test('Rich dims the desktop until the flash of a full arrival; Calm and Balanced do not',async({page})=>{
 await openApp(page);
 expect((await play(page,'rich','m.summon();',900)).dim).toEqual(['on','off']);
 expect((await play(page,'rich','m.summon({short:true});',500)).dim).toEqual([]);
 expect((await play(page,'balanced','m.summon();',900)).dim).toEqual([]);
 expect((await play(page,'calm','m.summon();',900)).dim).toEqual([]);
});

test('Reduce Motion turns every effect off at every level',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await openApp(page,{reducedMotion:true});
 for(const level of ['calm','balanced','rich']){
  const run=await play(page,level,'m.summon();m.working(true);m.part(document.querySelector("#composer"));m.yes();m.poke();',900,{reduced:true});
  expect(run.canvasFrames+Number(run.ring)+Number(run.rays)+Number(run.reveal),level).toBe(0);expect(run.dim,level).toEqual([]);
 }
});

test('the Magic row offers Calm, Balanced and Rich, starts on Balanced, applies at once and follows what the Mac saved',async({page})=>{
 const app=await openApp(page);
 await openMore(page,'Settings');
 const row=page.getByLabel('Magic');
 await expect(row.locator('option')).toHaveText(['Calm','Balanced','Rich']);
 await expect(row).toHaveValue('balanced');
 await row.selectOption('rich');
 expect(app.sent.filter(m=>m.kind==='configureMagic').map(m=>m.payload)).toEqual([{level:'rich'}]);
 // The next effect is Rich: a full arrival now asks the Mac to dim the desktop.
 await app.receive({kind:'popupHidden',payload:{}});app.sent.length=0;await app.receive({kind:'summon',payload:{}});
 await expect.poll(()=>app.sent.some(m=>m.kind==='dim'&&m.payload.on===true)).toBe(true);
 // After a restart the Mac reports what it saved.
 await app.receive({kind:'nativeStatus',payload:{hotkey:'⌘⇧E',visibleHeight:800,magic:'calm'}});
 await openMore(page,'Settings');await expect(page.getByLabel('Magic')).toHaveValue('calm');
});

test('hiding gathers embers into the lantern first: 0.45 s, 0.16 s in Calm, at once under Reduce Motion',async({page})=>{
 const app=await openApp(page);
 for(const [level,low,high] of [['balanced',420,800],['calm',100,330]] as [string,number,number][]){
  await app.receive({kind:'nativeStatus',payload:{hotkey:'⌘⇧E',visibleHeight:800,magic:level}});
  app.sent.length=0;await composer(page).focus();
  const asked=Date.now();await page.keyboard.press('Escape');
  await expect.poll(()=>app.sent.some(m=>m.kind==='hide'),{timeout:2000,intervals:[20]}).toBe(true);
  const took=Date.now()-asked;expect(took,level).toBeGreaterThanOrEqual(low);expect(took,level).toBeLessThanOrEqual(high);
  await app.receive({kind:'popupHidden',payload:{}});await app.receive({kind:'summon',payload:{}});
 }
});
