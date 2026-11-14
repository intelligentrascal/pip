import {test,expect} from '@playwright/test';
import path from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {componentPage} from '../helpers/components.js';
import {initialState} from '../../runtime/domain.js';

test.use({viewport:{width:520,height:360},video:process.env.PIP_CHARACTER_DEMO?{mode:'on',size:{width:520,height:360}}:'off'});

// Intent: ELF-10 authored primary/secondary Living ink motion, current-pose
// interruption and reduced-motion stills; ELF-14's chosen Curious Hearth replaces
// the vector binding without taking authority from the private demo.
test('chosen Hearth retargets its rendered pose without delaying input',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await componentPage(page,'<div class="motion-stage"><pip-character></pip-character><pip-living-ink></pip-living-ink></div><label class="motion-request">Your request<input id="request"></label>',`import '/character.js';import '/living-ink.js';`);
 expect(await page.evaluate(()=>document.querySelector<any>('pip-character').ready)).toBe(true);
 const input=page.getByLabel('Your request');await input.focus();const before=await input.boundingBox();
 const retarget=await page.evaluate(()=>{
  const character=document.querySelector('pip-character') as any,ink=document.querySelector('pip-living-ink') as any;
  character.showState('working');ink.newLeaf();ink.showState('working');
  const writing=ink.shadowRoot.querySelector('.writing'),draw=writing.getAnimations()[0],start=Number.parseFloat(getComputedStyle(writing).strokeDashoffset);
  draw.currentTime=Number(draw.effect.getTiming().duration)/2;const middle=Number.parseFloat(getComputedStyle(writing).strokeDashoffset);draw.finish();const end=Number.parseFloat(getComputedStyle(writing).strokeDashoffset);
  const animations=character.shadowRoot.getAnimations();
  const finite=animations.length>0&&animations.every((a:Animation)=>a.effect!.getTiming().iterations===1);
  for(const animation of animations)animation.currentTime=Number(animation.effect!.getTiming().duration)/2;
  const head=character.headDriver,from=getComputedStyle(head).transform;
  character.showState('approval');
  const frame=head.getAnimations()[0].effect.getKeyframes()[0].transform;
  const fresh=character.shadowRoot.getAnimations();
  const geometry=[...character.shadowRoot.querySelectorAll('[data-part]')].every((node:any)=>node.getBBox().width>0&&node.getBBox().height>0);
  return {finite,from,frame,geometry,writing:{start,middle,end},animations:fresh.length,targets:new Set(fresh.map((a:Animation)=>(a.effect as KeyframeEffect).target)).size};
 });
 expect(retarget.writing.middle).toBeLessThan(retarget.writing.start);expect(retarget.writing.middle).toBeGreaterThan(retarget.writing.end);
 expect(retarget.finite).toBe(true);expect(retarget.geometry).toBe(true);expect(retarget.frame).toBe(retarget.from);expect(retarget.animations).toBe(retarget.targets);
 await input.pressSequentially('Make this note clearer.');await expect(input).toHaveValue('Make this note clearer.');expect(await input.boundingBox()).toEqual(before);
 expect(await page.evaluate(()=>{const c=document.querySelector('pip-character') as any;for(const scene of ['done','listening-fixture']){try{c.showState(scene);return false;}catch{if(c.dataset.state!=='approval')return false;}}return true;})).toBe(true);
 await page.emulateMedia({reducedMotion:'reduce'});
 for(const scene of ['arrival','working','approval','blocked','unknown','done','tracker']){
  const state=await page.evaluate(scene=>{
   const c=document.querySelector('pip-character') as any,ink=document.querySelector('pip-living-ink') as any;
   c.showState(scene,{verified:scene==='done'});ink.showState(scene,{verified:scene==='done'});
   return {running:c.shadowRoot.getAnimations().filter((a:Animation)=>a.playState==='running').length,opacity:getComputedStyle(c.hero).opacity,clip:getComputedStyle(c.hero).clipPath};
  },scene);
  expect(state.running).toBe(0);expect(state.opacity).toBe('1');expect(state.clip).toBe('inset(0%)');
  if(process.env.PIP_CAPTURE_DIR)await page.screenshot({path:path.join(process.env.PIP_CAPTURE_DIR,`character-${scene}.png`)});
 }
 await page.emulateMedia({reducedMotion:'no-preference'});
 const zero=await page.evaluate(()=>{const c=document.querySelector('pip-character') as any;c.style.setProperty('--pip-motion-duration','0ms');c.showState('working');return c.shadowRoot.getAnimations().filter((a:Animation)=>a.playState==='running').length;});expect(zero).toBe(0);
 const background=await page.evaluate(()=>{const c=document.querySelector('pip-character') as any;c.style.removeProperty('--pip-motion-duration');c.showState('unknown',{background:true});return c.shadowRoot.getAnimations().filter((a:Animation)=>a.playState==='running').length;});expect(background).toBe(0);
 expect(errors).toEqual([]);
 if(process.env.PIP_CHARACTER_DEMO){
  await input.fill('');
  const play=async(scene:string,wait=true)=>page.evaluate(async({scene,wait})=>{const c=document.querySelector('pip-character') as any,ink=document.querySelector('pip-living-ink') as any;if(scene==='arrival'){c.conceal();ink.conceal();}if(scene==='working')ink.newLeaf();c.showState(scene,{verified:scene==='done'});ink.showState(scene,{verified:scene==='done'});if(wait)await Promise.all([...c.shadowRoot.getAnimations(),...ink.shadowRoot.getAnimations()].map((a:Animation)=>a.finished.catch(()=>{})));},{scene,wait});
  await play('arrival');await play('working',false);await input.pressSequentially('Needs my review.',{delay:35});await play('approval');
  for(const scene of ['working','blocked','unknown','done','tracker'])await play(scene);
  const video=page.video();await page.close();await video!.saveAs(path.join(process.env.PIP_CHARACTER_DEMO,'character.webm'));
 }
});

// Intent: the captain chose Curious Hearth, not the demo's fixture authorities.
// Read the real cropped PNGs through the browser, preserve their selected rest
// registration/paint order, and account for decoded rasters rather than padded tiles.
test('selected Hearth painting keeps its registered pixels and bounded cropped resources',async({page})=>{
 const registration=JSON.parse(await readFile('assets/curious-hearth/manifest.json','utf8'));
 await componentPage(page,'<pip-character></pip-character>',`import '/character.js';`);
 const observed=await page.evaluate(async registration=>{
  const character=document.querySelector<any>('pip-character');if(!await character.ready)throw Error('Selected artwork failed to decode');
  character.showState('rest',{background:true});
  const [width,height]=registration.canvas,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d')!,scale=width/character.svg.getBoundingClientRect().width;
  for(const image of character.hero.querySelectorAll('image')){
   let opacity=1;for(let element=image;element&&element!==character.svg;element=element.parentElement)opacity*=Number(getComputedStyle(element).opacity);
   if(!opacity)continue;
   const matrix=image.getCTM();context.setTransform(matrix.a*scale,matrix.b*scale,matrix.c*scale,matrix.d*scale,matrix.e*scale,matrix.f*scale);context.globalAlpha=opacity;
   context.drawImage(image,image.x.baseVal.value,image.y.baseVal.value,image.width.baseVal.value,image.height.baseVal.value);
  }
  const expectedImage=new Image();expectedImage.src='/curious-hearth/'+registration.fallback;await expectedImage.decode();
  const reference=document.createElement('canvas');reference.width=width;reference.height=height;const expectedContext=reference.getContext('2d')!;expectedContext.drawImage(expectedImage,0,0);
  const actual=context.getImageData(0,0,width,height).data,expected=expectedContext.getImageData(0,0,width,height).data;
  let opaque=0,rgb=0,alpha=0;
  for(let i=0;i<expected.length;i+=4){alpha+=Math.abs(actual[i+3]-expected[i+3]);if(expected[i+3]===255){opaque++;rgb+=Math.abs(actual[i]-expected[i])+Math.abs(actual[i+1]-expected[i+1])+Math.abs(actual[i+2]-expected[i+2]);}}
  const present=new Set(character.parts.keys());
  const expectedBytes=Object.entries<any>(registration.parts).filter(([name])=>present.has(name)).reduce((total,[,part])=>total+part.size[0]*part.size[1]*4,0)+registration.outline.size[0]*registration.outline.size[1]*4;
  return {opaquePixels:opaque,meanRgbError:rgb/(opaque*3),meanAlphaError:alpha/(width*height),resources:character.resourceStats,expectedBytes,images:present.size,requiredPresent:Object.keys(registration.parts).filter(name=>!registration.optionalParts.includes(name)).every(name=>present.has(name)),activeAnimations:character.shadowRoot.getAnimations().length,slot:character.getBoundingClientRect().width,assetSet:character.svg.dataset.assetSet};
 },registration);
 expect(observed.opaquePixels).toBeGreaterThan(0);
 // Independently composited 8-bit PNGs can differ by one rounding unit.
 expect(observed.meanRgbError).toBeLessThanOrEqual(1);expect(observed.meanAlphaError).toBeLessThanOrEqual(1);
 expect(observed.requiredPresent).toBe(true);expect(observed.resources.decodedRgbaBytes).toBe(observed.expectedBytes);expect(observed.resources.images).toBe(observed.images);
 expect(observed.activeAnimations).toBe(0);expect(observed.slot).toBe(registration.targetPoints);expect(observed.assetSet).toBe(registration.assetSet);
 if(process.env.PIP_CAPTURE_DIR){
  await writeFile(path.join(process.env.PIP_CAPTURE_DIR,'hearth-render-check.json'),JSON.stringify(observed,null,2));
  for(const [name,color] of [['light','#F6EAD4'],['dark','#142923']]){
   await page.evaluate(color=>{document.body.style.background=color;},color);
   await page.locator('pip-character').screenshot({path:path.join(process.env.PIP_CAPTURE_DIR,`hearth-on-${name}.png`)});
  }
 }
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
  if(message.kind==='snapshot'){await page.evaluate(state=>(window as any).pipReceive({kind:'state',payload:{state,workViews:[],claudeAllowed:false}}),initialState());initialized();}
  if(message.kind==='saveComposer'&&message.payload.text===request)saved();
 });
 try{
  await page.goto('/',{waitUntil:'domcontentloaded'});await started;
  const input=page.getByPlaceholder('What would you like a hand with?');await expect(input).toBeFocused();const before=await input.boundingBox();
  expect(await page.evaluate(()=>document.querySelector<any>('pip-character').assetsReady)).toBe(false);
  await input.pressSequentially(request);await stored;await expect(input).toHaveValue(request);expect(await input.boundingBox()).toEqual(before);
  release();expect(await page.evaluate(()=>document.querySelector<any>('pip-character').ready)).toBe(true);
  await expect(input).toHaveValue(request);expect(await input.boundingBox()).toEqual(before);
  const disposed=await page.evaluate(()=>{const character=document.querySelector<any>('pip-character');character.showState('working');const animations=character.shadowRoot.getAnimations();character.remove();return {owned:animations.length,cancelled:animations.every((animation:Animation)=>animation.playState==='idle')};});
  expect(disposed.owned).toBeGreaterThan(0);expect(disposed.cancelled).toBe(true);
 }finally{release();}
});

// Intent (ELF-32, borrowed motion methods): parts trail the hero by 60-150 ms, phased poses flow
// with their own easing, an interrupted move starts near the old speed, and a quick repeat
// summon plays the ~300 ms short arrival. Animations are frozen and sampled, never timed.
test('character motion follows roles, flows through poses, carries speed and shortens a repeat',async({page})=>{
 await componentPage(page,'<div class="motion-stage"><pip-character></pip-character></div>',`import '/character.js';`);
 expect(await page.evaluate(()=>document.querySelector<any>('pip-character').ready)).toBe(true);
 const arrival=await page.evaluate(()=>{
  const c=document.querySelector<any>('pip-character');c.showState('arrival');
  const all=c.shadowRoot.getAnimations() as Animation[];for(const a of all)a.pause();
  const timing=(a:Animation)=>a.effect!.getTiming();
  const hero=all.find(a=>(a.effect as KeyframeEffect).target===c.hero)!;
  const trailing=all.filter(a=>a!==hero&&Number(timing(a).delay)>0);
  const phased=trailing.filter(a=>(a.effect as KeyframeEffect).getKeyframes().length>2);
  return {heroDelay:timing(hero).delay,heroDuration:timing(hero).duration,
   delays:trailing.map(a=>timing(a).delay as number),
   phasedFlow:phased.every(a=>(a.effect as KeyframeEffect).getKeyframes().slice(0,-1).every(k=>k.easing!=='linear')&&timing(a).easing==='linear'),
   phased:phased.length,
   lastEnd:Math.max(...all.map(a=>a.effect!.getComputedTiming().endTime as number))};
 });
 expect(arrival.heroDelay).toBe(0);expect(arrival.heroDuration).toBe(1200);
 expect(arrival.delays.length).toBeGreaterThan(0);
 for(const delay of arrival.delays){expect(delay).toBeGreaterThanOrEqual(60);expect(delay).toBeLessThanOrEqual(150);}
 expect(arrival.phased).toBeGreaterThan(0);expect(arrival.phasedFlow).toBe(true);
 expect(arrival.lastEnd).toBeGreaterThan(1200);
 // Interrupt mid-flight: progress over the first 20 ms stays near average speed (a fresh curve is about 3.2x).
 const slope=await page.evaluate(()=>{
  const c=document.querySelector<any>('pip-character');
  c.showState('working');for(const a of c.shadowRoot.getAnimations())a.currentTime=300;
  c.showState('approval');
  const head=c.headDriver.getAnimations()[0] as Animation;head.pause();head.currentTime=Number(head.effect!.getTiming().delay)+20;
  const duration=Number(head.effect!.getTiming().duration),progress=Number(head.effect!.getComputedTiming().progress);
  return progress/(20/duration);
 });
 expect(slope).toBeGreaterThan(0);expect(slope).toBeLessThan(1.5);
 const fresh=await page.evaluate(()=>{
  const c=document.querySelector<any>('pip-character');c.cancelMotion();c.showState('listening');
  const head=c.headDriver.getAnimations()[0] as Animation;head.pause();head.currentTime=Number(head.effect!.getTiming().delay)+20;
  return Number(head.effect!.getComputedTiming().progress)/(20/Number(head.effect!.getTiming().duration));
 });
 expect(fresh).toBeGreaterThan(slope);
 const short=await page.evaluate(()=>{
  const c=document.querySelector<any>('pip-character');c.cancelMotion();c.showState('arrival',{short:true});
  return c.shadowRoot.getAnimations().map((a:Animation)=>a.effect!.getTiming().duration);
 });
 expect(short.length).toBeGreaterThan(0);expect(new Set(short)).toEqual(new Set([300]));
});
