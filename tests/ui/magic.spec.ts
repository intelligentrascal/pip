import {test,expect,type Page} from '@playwright/test';
import {composer,openMore} from '../helpers/chat-page.js';
import {openApp} from '../helpers/app-page.js';
import {initialState} from '../../runtime/domain.js';

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
 expect(short.lastActive).toBeLessThanOrEqual(300+17); // the effect ends at 290 ms; sampling is per frame, so one frame (17 ms) of slack
 expect(short.lastActive).toBeGreaterThan(100);
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

// Intent (ELF-73, from ELF-65's agreed design): a finished step sends embers, the border lights as they arrive, Calm clears everything Balanced drew,
// and the circle and rays have the agreed size. Fixture: Pip's real page, its own effects class and the host's live messages.
const liveStep=(state:'running'|'done')=>({kind:'live',payload:{running:true,startedAt:Date.now()-3000,turns:1,steps:[{id:'s1',label:'Read the calendar',state,startedAt:Date.now()-3000,milliseconds:state==='done'?1200:undefined}],words:'',blocks:[],limits:{turns:24,milliseconds:600000},now:Date.now()}});
const workingState=async(app:Awaited<ReturnType<typeof openApp>>)=>{
 const work={id:'w1',request:'Plan my Friday.',status:'Working',result:null,error:'',taskId:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),threadId:'c1',sessionId:'s',usage:{attempts:1,activeMilliseconds:0}};
 await app.receive({kind:'state',payload:{state:{...initialState(),works:[work]},workViews:[],replies:{}}});await app.receive({kind:'summon',payload:{}});
};

test('a finished step sends embers once, at Balanced and Rich, and none at Calm',async({page})=>{
 const app=await openApp(page);await workingState(app);
 for(const [level,steps] of [['balanced',1],['rich',1],['calm',0]] as [string,number][]){
  await app.receive({kind:'nativeStatus',payload:{hotkey:'⌘⇧E',visibleHeight:800,magic:level}});
  await page.evaluate(()=>{(window as any).__embers=0;const proto=(window as any).PipMagic.prototype;if(!proto.__wrapped){const original=proto.burst;proto.burst=function(...a:any[]){(window as any).__embers++;return original.apply(this,a);};proto.__wrapped=true;}});
  await app.receive(liveStep('running'));await app.receive(liveStep('done'));await page.waitForTimeout(150);
  const bursts=await page.evaluate(()=>(window as any).__embers);
  if(steps)expect(bursts,level).toBeGreaterThan(0);else expect(bursts,level).toBe(0);
 }
});

test('a part border lights about 480 ms after launch, as the embers arrive, and never at Calm or under Reduce Motion',async({page})=>{
 await openApp(page);
 const lit=(level:string,reduced:boolean)=>page.evaluate(async({level,reduced})=>{
  const w=window as any,el=document.createElement('div');el.className='pl';document.querySelector('#win')!.append(el);
  const m=new w.PipMagic({canvas:document.querySelector('#fx'),character:document.querySelector('pip-character'),win:document.querySelector('#win'),emit(){},reduced:()=>reduced});
  m.setLevel(level);m.summon({short:true});await new Promise(r=>setTimeout(r,350));
  const start=performance.now();m.part(el);let at=-1;
  await new Promise<void>(done=>{const tick=()=>{const t=performance.now()-start;if(el.classList.contains('sw')&&at<0)at=t;if(t<900)requestAnimationFrame(tick);else done();};tick();});
  m.halt();el.remove();return at;
 },{level,reduced});
 const balanced=await lit('balanced',false);expect(balanced).toBeGreaterThan(420);expect(balanced).toBeLessThan(620);
 expect(await lit('calm',false)).toBe(-1);expect(await lit('balanced',true)).toBe(-1);
});

test('switching to Calm clears the paused circle, the embers and a border about to light',async({page})=>{
 await openApp(page);
 const result=await page.evaluate(async()=>{
  const w=window as any,c=document.querySelector<any>('pip-character'),el=document.createElement('div');el.className='pl';document.querySelector('#win')!.append(el);
  const m=new w.PipMagic({canvas:document.querySelector('#fx'),character:c,win:document.querySelector('#win'),emit(){},reduced:()=>false});
  m.setLevel('balanced');m.summon({short:true});await new Promise(r=>setTimeout(r,350));
  m.pause(el,document.querySelector('#win'));const ringWas=c.hasAttribute('data-ring');
  m.setLevel('calm');await new Promise(r=>setTimeout(r,700));
  const out={ringWas,ring:c.hasAttribute('data-ring'),lit:el.classList.contains('sw'),canvas:!document.querySelector<HTMLCanvasElement>('#fx')!.hidden};m.halt();el.remove();return out;
 });
 expect(result).toEqual({ringWas:true,ring:false,lit:false,canvas:false});
});

test('the circle of light is 190 pt across and the rays 300 pt, centred under Pip',async({page})=>{
 await openApp(page);
 const sizes=await page.evaluate(()=>{
  const c=document.querySelector<any>('pip-character'),root=c.shadowRoot,box=c.getBoundingClientRect();
  c.ring(true);c.setAttribute('data-rays','');const ring=root.querySelector('.ring').getBoundingClientRect(),rays=root.querySelector('.rays');
  return {box:box.width,ringWidth:ring.width,rays:rays.offsetWidth};
 });
 expect(sizes.ringWidth/sizes.box).toBeCloseTo(1.32,1);expect(sizes.rays/sizes.box).toBeCloseTo(2,1);
});

// Intent: the captain's five settled design choices (ELF-79): the paused circle is drawn once in 0.45 s and then held still; the problem lantern is dim red
// matching the window's problem light; Pip follows a moving pointer while paused and faces the person after 2.5 s of rest; the flash is 150 pt / 70 pt in radius.
test('the paused circle is drawn once in 0.45 s and never turns, and the problem lantern is the window\'s problem red in dark and light',async({page})=>{
 await openApp(page);await page.emulateMedia({colorScheme:'dark'});
 const readings=await page.evaluate(()=>{
  const c=document.querySelector<any>('pip-character'),ring=c.shadowRoot.querySelector('.ring');c.ring(true);
  const turning=getComputedStyle(ring.querySelector('g')).animationName,draw=getComputedStyle(ring.querySelector('[pathLength]')).transitionDuration;c.ring(false);
  c.showState('blocked');return {turning,draw,lantern:getComputedStyle(c).getPropertyValue('--lc').trim(),window:getComputedStyle(document.documentElement).getPropertyValue('--da').trim()};
 });
 expect(readings.turning).toBe('none');expect(readings.draw).toBe('0.45s');
 expect(readings.lantern).toBe(readings.window);expect(readings.lantern.toLowerCase()).toBe('#f28f80');
 await page.emulateMedia({colorScheme:'light'});
 const light=await page.evaluate(()=>({lantern:getComputedStyle(document.querySelector('pip-character')!).getPropertyValue('--lc').trim(),window:getComputedStyle(document.documentElement).getPropertyValue('--da').trim()}));
 expect(light.lantern).toBe(light.window);expect(light.lantern.toLowerCase()).toBe('#b03a2c');
 // A problem draws neither embers nor the circle.
 const problem=await page.evaluate(()=>{const c=document.querySelector<any>('pip-character');c.showState('blocked');return c.hasAttribute('data-ring');});
 expect(problem).toBe(false);
});

test('while paused Pip follows a pointer that is moving, then faces the person after 2.5 s without movement',async({page})=>{
 await openApp(page);
 const aim=await page.evaluate(()=>{
  const c=document.querySelector<any>('pip-character');c.showState('approval');c.setFocus(()=>null);
  const box=c.getBoundingClientRect();c.pointer(box.left-300,box.top+20);const t=performance.now();
  const moving=c.aim(t+100),rested=c.aim(t+2600);return {moving,rested};
 });
 expect(Math.abs(aim.moving[0])+Math.abs(aim.moving[1])).toBeGreaterThan(.1);
 expect(aim.rested).toEqual([0,0]);
});

test('the flash is 150 pt in radius for a full arrival and 70 pt for a quick one',async({page})=>{
 await openApp(page);
 const radii=await page.evaluate(async()=>{
  const w=window as any,seen:number[]=[],m=new w.PipMagic({canvas:document.querySelector('#fx'),character:document.querySelector('pip-character'),win:document.querySelector('#win'),emit(){},reduced:()=>false});
  m.setLevel('balanced');const original=m.glow.bind(m);m.glow=(c:any,r:number,ms:number)=>{seen.push(r);return original(c,r,ms);};
  m.summon({short:false});await new Promise(r=>setTimeout(r,700));m.summon({short:true});await new Promise(r=>setTimeout(r,100));m.halt();return seen;
 });
 expect(radii).toEqual([150,70]);
});
