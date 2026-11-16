import {test,expect} from '@playwright/test';
import {composer} from '../helpers/chat-page.js';
import path from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {componentPage} from '../helpers/components.js';
import {initialState} from '../../runtime/domain.js';
import {openApp} from '../helpers/app-page.js';

test.use({viewport:{width:520,height:360},video:process.env.PIP_CHARACTER_DEMO?{mode:'on',size:{width:520,height:360}}:'off'});

// Intent (ELF-65's accepted screen spec, built by ELF-62): Pip is drawn from the 26 painted layers in the manifest's paint order, at their offsets,
// with the three scrolls shown, and the decoded rasters are exactly the registered ones. Fixture: the real cropped PNGs and manifest.
test('Pip is drawn from the 26 registered layers at their offsets, scrolls included',async({page})=>{
 const registration=JSON.parse(await readFile('assets/curious-hearth/manifest.json','utf8'));
 await componentPage(page,'<pip-character></pip-character>',`import '/character.js';`);
 const observed=await page.evaluate(async registration=>{
  const character=document.querySelector<any>('pip-character');if(!await character.ready)throw Error('Selected artwork failed to decode');
  const layers=[...character.svg.querySelectorAll('[data-part]:not([data-part=hero]) > image')].map((image:any)=>({file:image.getAttribute('href').split('/').pop(),x:image.x.baseVal.value,y:image.y.baseVal.value,width:image.width.baseVal.value,height:image.height.baseVal.value}));
  const bounds=(name:string)=>{const box=character.parts.get(name).getBoundingClientRect();return box.width>0&&box.height>0;};
  const scrolls=['charm-1','charm-2','charm-3'].map(name=>bounds(name)&&getComputedStyle(character.parts.get(name)).display!=='none');
  return {layers,scrolls,resources:character.resourceStats,slot:character.getBoundingClientRect().width,assetSet:character.svg.dataset.assetSet,
   irises:character.svg.querySelectorAll('[data-role=iris] image').length,outline:character.svg.querySelectorAll('[data-outline]').length};
 },registration);
 const parts=Object.values<any>(registration.parts);
 expect(observed.layers.length).toBe(parts.length);
 for(const part of parts){const layer=observed.layers.find((l:any)=>l.file===part.file);expect(layer,part.file).toEqual({file:part.file,x:part.offset[0],y:part.offset[1],width:part.size[0],height:part.size[1]});}
 // Where two layers overlap, the one later in the manifest's paint order is drawn later.
 const order=registration.paintOrder as string[],at=(name:string)=>observed.layers.findIndex((l:any)=>l.file===registration.parts[name].file);
 const overlaps=(a:any,b:any)=>a.offset[0]<b.offset[0]+b.size[0]&&b.offset[0]<a.offset[0]+a.size[0]&&a.offset[1]<b.offset[1]+b.size[1]&&b.offset[1]<a.offset[1]+a.size[1];
 for(let i=0;i<order.length;i++)for(let j=i+1;j<order.length;j++)if(overlaps(registration.parts[order[i]],registration.parts[order[j]]))expect(at(order[i]),`${order[i]} under ${order[j]}`).toBeLessThan(at(order[j]));
 expect(observed.scrolls).toEqual([true,true,true]);expect(observed.irises).toBe(2);expect(observed.outline).toBe(0);
 // The two iris copies are the only layers drawn twice.
 expect(observed.resources.decodedRgbaBytes).toBe(parts.reduce((total:number,part:any)=>total+part.size[0]*part.size[1]*4,0));
 expect(observed.resources.images).toBe(parts.length);expect(observed.assetSet).toBe(registration.assetSet);expect(observed.slot).toBe(150);
});

// Intent (spec, "Always, at every magic level"): a waiting Pip breathes, blinks, flicks his ears, sways his arms, scarf and lantern, and his three
// scrolls bob, each on the spec's own period, all in CSS so he asks for no script frames. Expected values are the spec's table (one cycle in ms).
test('a waiting Pip moves on the spec\'s periods and asks for no script frames',async({page})=>{
 await openApp(page);
 const cycles=await page.evaluate(()=>{
  const c=document.querySelector<any>('pip-character');
  return c.shadowRoot.getAnimations().filter((a:any)=>a instanceof CSSAnimation).map((a:any)=>{const t=a.effect.getTiming(),target=a.effect.target,role=target.dataset.role??target.dataset.part??target.getAttribute('class');
   return {role:role+(target.dataset.index?target.dataset.index:''),name:a.animationName,cycle:Number(t.duration)*(t.direction==='alternate'?2:1),infinite:t.iterations===Infinity};});
 });
 const expected:Record<string,number>={breath:3800,'arm-left':3400,'arm-right':4600,'arm-right-lantern':4600,lantern:3000,'scarf-tail':4200,'ear-left':6300,'ear-right':8100,glow:2600,'scroll-bob':NaN,'closed-eye-left':5600,'closed-eye-right':5600};
 for(const [role,cycle] of Object.entries(expected).filter(([role])=>role!=='scroll-bob')){
  const found=cycles.filter(c=>c.role===role);expect(found.length,role).toBe(1);expect(found[0].cycle,role).toBe(cycle);expect(found[0].infinite,role).toBe(true);
 }
 const bobs=cycles.filter(c=>c.role==='scroll-bob').map(c=>c.cycle).sort((a,b)=>a-b);expect(bobs).toEqual([3800,4600,5400]);
 // With the pointer still and nothing to look at, the frame loop has stopped and stays stopped.
 await expect.poll(()=>page.evaluate(()=>{const c=document.querySelector<any>('pip-character');const before=c.frames;return new Promise(resolve=>setTimeout(()=>resolve(c.frames===before),400));}),{timeout:8000}).toBe(true);
});

// Intent (spec, "Following the pointer"; done criterion 8): moving the pointer to each screen corner turns his eyes and head toward it within 0.5 s.
test('his eyes and head turn toward each screen corner within half a second',async({page})=>{
 await page.setViewportSize({width:756,height:560});await openApp(page);
 // Pip's face sits at the lower right of the page, so all four corners differ from it in the signs below.
 const corners:[string,number,number,number,number][]=[['top left',4,4,-1,-1],['top right',752,4,1,-1],['bottom left',4,556,-1,1],['bottom right',752,556,1,1]];
 const read=()=>page.evaluate(()=>{const s=document.querySelector<any>('pip-character').style,n=(k:string)=>Number.parseFloat(s.getPropertyValue(k));return {ix:n('--ix'),iy:n('--iy'),hx:n('--hx'),hy:n('--hy')};});
 for(const [name,x,y,sx,sy] of corners){
  await page.mouse.move(x,y);await page.waitForTimeout(500);
  const turned=await read();
  expect(Math.sign(turned.ix),`${name} eyes sideways`).toBe(sx);expect(Math.sign(turned.iy),`${name} eyes up or down`).toBe(sy);
  expect(Math.sign(turned.hx),`${name} head sideways`).toBe(sx);expect(Math.sign(turned.hy),`${name} head up or down`).toBe(sy);
  // The spec's ranges: eyes 11 px sideways and 8 px up or down, head 14 px and 9 px.
  expect(Math.abs(turned.ix)).toBeLessThanOrEqual(11);expect(Math.abs(turned.iy)).toBeLessThanOrEqual(8);expect(Math.abs(turned.hx)).toBeLessThanOrEqual(14);expect(Math.abs(turned.hy)).toBeLessThanOrEqual(9);
 }
});

// Intent (spec, "Poses by state"): each state has its pose: head tilt, concerned mouth when something is wrong, scrolls circling while he works
// and finishing their lap when work ends. The head's rest tilt is the spec's table (degrees); the pointer is off screen so only the pose shows.
test('each state shows its pose, and the scrolls circle while he works then finish the lap',async({page})=>{
 await openApp(page);
 const pose=(scene:string)=>page.evaluate(scene=>{
  const c=document.querySelector<any>('pip-character');c.pointer(null);c.setFocus(()=>null);c.showState(scene);
  return {pose:c.dataset.pose,mouth:[...c.parts].filter(([name]:any)=>name.startsWith('mouth-')).find(([,node]:any)=>node.style.opacity==='1')?.[0]};
 },scene);
 const tilt=()=>page.evaluate(()=>Number.parseFloat(document.querySelector<any>('pip-character').style.getPropertyValue('--hr')));
 // The head eases to its tilt, so each reading waits for the spring to settle.
 for(const [scene,expected,tiltDegrees,mouth] of [['working','working',-3,'mouth-smile'],['approval','paused',-2],['blocked','problem',3,'mouth-concern'],['listening','talking',-4],['rest','rest',0,'mouth-smile']] as [string,string,number,string?][]){
  expect(await pose(scene),scene).toMatchObject({pose:expected,...(mouth?{mouth}:{})});
  await expect.poll(async()=>Math.abs((await tilt())-tiltDegrees)<.05,{message:scene,timeout:3000}).toBe(true);
 }
 const turn=()=>page.evaluate(()=>Number.parseFloat(document.querySelector<any>('pip-character').style.getPropertyValue('--oa')));
 await page.evaluate(()=>document.querySelector<any>('pip-character').showState('working'));
 await page.waitForTimeout(300);const turning=await turn();expect(turning).toBeGreaterThan(20);
 await page.evaluate(()=>document.querySelector<any>('pip-character').showState('rest'));
 await expect.poll(async()=>(await turn())%360,{timeout:4000}).toBe(0);
});

// Intent (spec, "Reduce Motion"): still poses by state; no loops, no following, no effects.
test('Reduce Motion shows still poses: nothing loops and the pointer is not followed',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await openApp(page,{reducedMotion:true});
 await page.mouse.move(4,4);await page.waitForTimeout(400);
 const state=await page.evaluate(()=>{const c=document.querySelector<any>('pip-character');c.showState('working');
  return {running:c.shadowRoot.getAnimations().filter((a:any)=>a instanceof CSSAnimation&&a.playState==='running').length,ix:c.style.getPropertyValue('--ix'),hx:c.style.getPropertyValue('--hx'),hr:c.style.getPropertyValue('--hr')};});
 expect(state.running).toBe(0);expect(Number.parseFloat(state.ix||'0')).toBe(0);expect(Number.parseFloat(state.hx||'0')).toBe(0);expect(Number.parseFloat(state.hr)).toBe(-3);
 for(const scene of ['arrival','working','approval','blocked','unknown','done','tracker']){
  expect(await page.evaluate(scene=>{const c=document.querySelector<any>('pip-character');c.showState(scene,{verified:scene==='done'});return c.shadowRoot.getAnimations().filter((a:any)=>a instanceof CSSAnimation&&a.playState==='running').length;},scene),scene).toBe(0);
 }
});

// Intent (spec, "Typing" and the task's key-to-reaction proof): a key pressed in the message box reacts within 50 ms. Fixture: real key presses.
test('a key pressed in the message box makes Pip react within 50 ms',async({page})=>{
 await openApp(page);
 await page.evaluate(()=>{const c=document.querySelector<any>('pip-character'),box=document.querySelector<any>('#composer');(window as any).__reaction=null;let key=0;
  box.addEventListener('keydown',()=>{key=performance.now();},{capture:true});
  new MutationObserver(()=>{if(key&&(window as any).__reaction===null)(window as any).__reaction=performance.now()-key;}).observe(c,{attributes:true,attributeFilter:['style']});});
 await composer(page).press('a');
 const reaction=await page.evaluate(()=>(window as any).__reaction);
 expect(reaction).not.toBeNull();expect(reaction).toBeLessThan(50);
});

// Intent (spec, done criterion 13): hidden, nothing runs. Fixture: the host's own popupHidden and summon messages.
test('a hidden Pip runs nothing, and wakes with the next summon',async({page})=>{
 const app=await openApp(page);
 await app.receive({kind:'popupHidden',payload:{}});
 const hidden=await page.evaluate(async()=>{const c=document.querySelector<any>('pip-character');c.pointer(10,10);const before=c.frames;await new Promise(r=>setTimeout(r,300));
  return {frames:c.frames-before,paused:c.shadowRoot.getAnimations().filter((a:any)=>a instanceof CSSAnimation).every((a:Animation)=>a.playState!=='running'),attribute:c.hasAttribute('data-hidden')};});
 expect(hidden).toEqual({frames:0,paused:true,attribute:true});
 await app.receive({kind:'summon',payload:{}});
 expect(await page.evaluate(()=>document.querySelector<any>('pip-character').hasAttribute('data-hidden'))).toBe(false);
});

// Intent: accepted keyboard-first Living ink and ELF-14's explicit rule that
// native controls never wait for artwork. Hold genuine image responses, not time.
test('the actual app accepts and reports typing before artwork decodes, then cancels detached motion',async({page})=>{
 let release!:()=>void,initialized!:()=>void,saved!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const started=new Promise<void>(resolve=>{initialized=resolve;});
 const stored=new Promise<void>(resolve=>{saved=resolve;});
 const request='Make this note clearer.';
 await page.route('**/curious-hearth/*.png',async route=>{await gate;await route.continue();});
 await page.exposeFunction('pipTestBridge',async(message:any)=>{
  if(message.kind==='snapshot'){await page.evaluate(state=>(window as any).pipReceive({kind:'state',payload:{state,workViews:[]}}),initialState());initialized();}
  if(message.kind==='saveComposer'&&message.payload.text===request)saved();
 });
 try{
  await page.goto('/',{waitUntil:'domcontentloaded'});await started;
  const input=composer(page);await expect(input).toBeFocused();const before=await input.boundingBox();
  expect(await page.evaluate(()=>document.querySelector<any>('pip-character').assetsReady)).toBe(false);
  await input.pressSequentially(request);await stored;await expect(input).toHaveValue(request);expect(await input.boundingBox()).toEqual(before);
  release();expect(await page.evaluate(()=>document.querySelector<any>('pip-character').ready)).toBe(true);
  await expect(input).toHaveValue(request);expect(await input.boundingBox()).toEqual(before);
  const disposed=await page.evaluate(()=>{const character=document.querySelector<any>('pip-character');character.showState('working');const animations=character.shadowRoot.getAnimations();character.remove();return {owned:animations.length,cancelled:animations.every((animation:Animation)=>animation.playState==='idle')};});
  expect(disposed.owned).toBeGreaterThan(0);expect(disposed.cancelled).toBe(true);
 }finally{release();}
});
