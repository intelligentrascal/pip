// Captain-selected Curious Hearth. Registration is data-only; the app owns
// meaningful state, verified outcomes and any future real dictation state.
// Motion roles (borrowed method: easing by role, follow-through by delay). Settle is the hero's
// ease-out; limbs lead softly; ears, scarf and charms trail by 60-150 ms. Phased parts use linear
// animation easing with a per-keyframe ease-in-out, so poses flow instead of turning at a corner.
const roles={settle:{ease:'cubic-bezier(.22,.7,.24,1)',delay:0},limb:{ease:'cubic-bezier(.3,.5,.25,1)',delay:60},hand:{ease:'cubic-bezier(.3,.5,.25,1)',delay:100},trail:{ease:'cubic-bezier(.25,.6,.3,1)',delay:150}};
const flowEase='cubic-bezier(.4,0,.3,1)';
// An interrupted curve starts at about the old average speed (initial slope 1) instead of 3.2 times it.
const carryEase='cubic-bezier(.3,.3,.24,1)',shortArrival=300;
const characterDurations={rest:1,arrival:1200,intent:900,working:1800,approval:900,blocked:900,unknown:900,done:1400,tracker:720,listening:450,thinking:900};
export class PipCharacter extends HTMLElement {
 constructor(){
  super();this.attachShadow({mode:'open'});this.scene='arrival';this.animations=new Set();this.lastOptions={};this.concealed=false;this.assetsReady=false;
  const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./character.css',import.meta.url);
  const source=document.getElementById('pip-character-rig');
  if(!source)throw Error('The selected character registration is not bundled');
  this.svg=source.content.querySelector('svg').cloneNode(true);
  this.hero=this.svg.querySelector('[data-part=hero]');this.outline=this.svg.querySelector('[data-outline]');
  this.parts=new Map([...this.svg.querySelectorAll('[data-part]')].map(node=>[node.dataset.part,node]));
  for(const node of this.svg.querySelectorAll('[data-pivot]')){const [x,y]=node.dataset.pivot.split(' ');node.style.transformOrigin=`${x}px ${y}px`;}
  this.fallback=document.createElement('img');this.fallback.className='fallback';this.fallback.alt='';this.fallback.hidden=true;
  this.shadowRoot.append(link,this.svg,this.fallback);this.conceal();this.concealed=false;
  this.motion=matchMedia('(prefers-reduced-motion: reduce)');this.onMotion=()=>{if(this.motion.matches)this.cut();};
  // Decode asynchronously: art readiness must never gate the composer or native focus.
  this.ready=Promise.all([...this.svg.querySelectorAll('image')].map(node=>new Promise((resolve,reject)=>{
   const image=new Image();image.onload=()=>image.decode().then(()=>resolve({width:image.naturalWidth,height:image.naturalHeight}),reject);image.onerror=reject;image.src=new URL(node.getAttribute('href'),document.baseURI);
  }))).then(images=>{
   this.resourceStats={images:images.length,decodedRgbaBytes:images.reduce((total,image)=>total+image.width*image.height*4,0)};
   this.assetsReady=true;this.dataset.artStatus='ready';
   if(this.isConnected&&!this.concealed)this.showState(this.scene,{...this.lastOptions,background:this.lastOptions.background||!['arrival','intent'].includes(this.scene)});
   return true;
  }).catch(()=>{
   this.dataset.artStatus='fallback';this.svg.style.visibility='hidden';this.fallback.src=new URL(this.svg.dataset.fallback,document.baseURI);this.fallback.hidden=this.concealed;
   return false;
  });
 }
 connectedCallback(){this.motion.addEventListener('change',this.onMotion);this.showState('arrival',{background:document.hidden});}
 disconnectedCallback(){this.motion.removeEventListener('change',this.onMotion);this.concealed=true;this.cancelMotion();}
 cancelMotion(){for(const animation of this.animations)animation.cancel();this.animations.clear();}
 cut(){for(const animation of this.animations)animation.finish();this.animations.clear();}
 conceal(){
  this.concealed=true;if(this.fallback)this.fallback.hidden=true;this.cancelMotion();
  this.hero.style.opacity='0';this.hero.style.clipPath='inset(0% 0% 100% 0%)';this.outline.style.opacity='0';this.outline.style.clipPath='inset(0% 0% 100% 0%)';
 }
 group(name){return [...this.svg.querySelectorAll(`[data-group="${name}"]`)];}
 get headDriver(){return this.group('head')[0];}
 // Batch rendered-pose reads before writes. Duplicated logical-parent wrappers
 // share one clock but keep the supplied global paint order, including the lantern.
 retarget(plans,duration,still){
  const interrupted=this.animations.size>0;
  for(const plan of plans){const computed=getComputedStyle(plan.element);plan.from=Object.fromEntries(Object.keys(plan.target).map(property=>[property,computed[property]]));}
  this.cancelMotion();
  const start=document.timeline.currentTime;
  for(const {element,target,phases,from,role='settle'} of plans){
   Object.assign(element.style,target);
   if(!still&&(phases.length||Object.keys(target).some(key=>from[key]!==target[key]))){
    const {ease,delay}=roles[role],flow=phases.length>0&&role!=='settle',wait=Math.min(delay,duration/4);
    const frames=flow?[from,...phases,target].map((frame,index,all)=>index<all.length-1?{...frame,easing:flowEase}:frame):[from,...phases,target];
    const animation=element.animate(frames,{duration,delay:wait,fill:'backwards',easing:flow?'linear':interrupted?carryEase:ease,iterations:1});
    this.animations.add(animation);animation.finished.then(()=>this.animations.delete(animation),()=>this.animations.delete(animation));
    if(start!==null)animation.startTime=start;
   }
  }
 }
 showState(scene,{verified=false,background=false,short=false}={}){
  if(!Object.hasOwn(characterDurations,scene))throw Error('Unknown character state');
  if(scene==='done'&&verified!==true)throw Error('A verified outcome is required');
  this.scene=scene;this.dataset.state=scene;this.lastOptions={verified,background};this.concealed=false;
  if(!this.assetsReady){if(this.dataset.artStatus==='fallback')this.fallback.hidden=false;return;}
  const still=background||this.motion.matches||parseFloat(getComputedStyle(this).getPropertyValue('--pip-motion-duration')||'1')===0;
  const mouth=scene==='blocked'?'mouth-concern':scene==='unknown'?'mouth-neutral':'mouth-smile';
  const chosen=this.parts.get(mouth)||this.parts.get('mouth-neutral')||this.parts.get('mouth-smile');
  for(const [name,part] of this.parts)if(name.startsWith('mouth-'))part.style.opacity=part===chosen?'1':'0';
  const plans=[],add=(element,target,phases=[],role='settle')=>{if(element)plans.push({element,target,phases,role});};
  const rotation=value=>value?`rotate(${value}deg)`:'none';
  const flourish=['arrival','intent','working','done'].includes(scene),enter=['arrival','intent'].includes(scene);
  add(this.hero,{opacity:'1',clipPath:'inset(0% 0% 0% 0%)',transform:'none'},enter?[
   {opacity:'0',clipPath:'inset(0% 0% 100% 0%)',transform:'translate(0px, 28px)',offset:.2},
   {opacity:'1',clipPath:'inset(0% 0% 65% 0%)',transform:'translate(0px, -3px)',offset:.52}
  ]:[]);
  add(this.outline,{opacity:'0',clipPath:'inset(0% 0% 0% 0%)'},enter?[
   {opacity:'1',clipPath:'inset(0% 0% 100% 0%)',offset:.02},
   {opacity:'1',clipPath:'inset(0% 0% 0% 0%)',offset:.35},{opacity:'0',offset:.78}
  ]:[]);
  const head=scene==='listening'?-4:scene==='thinking'?-3:scene==='approval'?-2:['blocked','unknown'].includes(scene)?2:0;
  for(const part of this.group('head'))add(part,{transform:rotation(head)},flourish?[{transform:rotation(-2),offset:.38},{transform:rotation(1),offset:.78}]:[],'limb');
  for(const part of this.group('left-arm'))add(part,{transform:rotation(scene==='approval'?4:0)},flourish?[{transform:rotation(scene==='working'?7:4),offset:.4},{transform:rotation(-1),offset:.8}]:[],'limb');
  for(const part of this.group('right-arm'))add(part,{transform:'none'});
  for(const [name,part] of this.parts){
   if(name==='hero')continue;
   let final=0,phases=[],role='trail';
   if(name==='hand-left'){role='hand';final=scene==='approval'?-3:0;if(flourish)phases=[{transform:rotation(-4),offset:.42},{transform:rotation(1),offset:.82}];}
   if(name==='ear-left'){final=scene==='listening'?-5:scene==='approval'?-2:['blocked','unknown'].includes(scene)?2:0;if(flourish)phases=[{transform:rotation(-2),offset:.48}];}
   if(name==='ear-right'){final=['blocked','unknown'].includes(scene)?-2:0;if(flourish)phases=[{transform:rotation(2),offset:.55}];}
   if(name==='scarf-tail'&&['arrival','intent','working'].includes(scene))phases=[{transform:rotation(2),offset:.52},{transform:rotation(-1),offset:.86}];
   if(name.startsWith('charm-')&&flourish){const index=Number(name.slice(-1))-1,y=scene==='done'?-18:[-28,-18,-11][index];phases=[{transform:`translate(0px, ${y}px)`,offset:.4+index*.06}];}
   add(part,{transform:rotation(final)},phases,role);
  }
  this.retarget(plans,short&&scene==='arrival'?shortArrival:characterDurations[scene],still);
 }
}
customElements.define('pip-character',PipCharacter);
