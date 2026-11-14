// ELF-10 accepted ink / edge / intent / task / dictation / right / authored.
export const acceptedMagic=Object.freeze({direction:'ink',presence:'edge',reveal:'intent',remnant:'task',voice:'dictation',edge:'right',energy:'authored'});
const durations={arrival:1200,working:1800,approval:900,blocked:900,unknown:900,done:1400,tracker:720};
export class LivingInk extends HTMLElement {
 constructor(){
  super();this.attachShadow({mode:'open'});this.current='arrival';
  this.shadowRoot.innerHTML=`<link rel="stylesheet" href="${new URL('./living-ink.css',import.meta.url)}"><svg viewBox="0 0 112 112" aria-hidden="true"><path class="margin" pathLength="1" d="M18 100V18q0-10 10-10h64"/><g class="leaf"><path class="paper" d="M31 28h58v68H31z"/><path class="writing" pathLength="1" d="M40 44h37 M40 54h30 M40 64h34"/></g><path class="quill" d="M52 81L83 24q12-7 5 9L52 81m15-25l8 1"/><path class="unknown" d="M76 77a9 9 0 1 0 9 9"/><circle class="seal" cx="85" cy="86" r="8"/></svg><div class="label" role="status" aria-live="polite"></div>`;
  this.motion=matchMedia('(prefers-reduced-motion: reduce)');
  this.onMotion=()=>{if(this.motion.matches)this.finishMotion();};
 }
 connectedCallback(){this.motion.addEventListener('change',this.onMotion);this.showState('arrival');}
 disconnectedCallback(){this.motion.removeEventListener('change',this.onMotion);this.finishMotion();}
 finishMotion(){for(const a of this.shadowRoot.getAnimations())a.finish();}
 conceal(){for(const a of this.shadowRoot.getAnimations())a.cancel();this.shadowRoot.querySelector('.margin').style.strokeDashoffset='1';this.shadowRoot.querySelector('.writing').style.strokeDashoffset='1';this.shadowRoot.querySelector('.leaf').style.opacity='0';}
 newLeaf(){const leaf=this.shadowRoot.querySelector('.leaf'),writing=this.shadowRoot.querySelector('.writing');for(const element of [leaf,writing])for(const animation of element.getAnimations())animation.cancel();leaf.style.opacity='0';writing.style.strokeDashoffset='1';}
 retarget(element,target,duration,phases,still){
  const computed=getComputedStyle(element),from={};for(const property of Object.keys(target))from[property]=computed[property];
  element.getAnimations().forEach(a=>a.cancel());Object.assign(element.style,target);
  if(!still)element.animate([from,...phases,target],{duration,easing:'cubic-bezier(.2,.7,.2,1)',iterations:1});
 }
 showState(state,{verified=false,background=false,filingTarget=null,short=false}={}){
  if(!Object.hasOwn(durations,state))throw Error('Unknown Living ink state');
  if(state==='done'&&!verified)throw Error('A verified outcome is required');
  this.current=state;this.dataset.state=state;
  const labels={arrival:'Ready',working:'Working',approval:'Needs approval',blocked:'Blocked',unknown:'Outcome unknown',done:'Verified result',tracker:'Saved to tracker'};
  this.shadowRoot.querySelector('.label').textContent=labels[state];
  const leaf=this.shadowRoot.querySelector('.leaf'),quill=this.shadowRoot.querySelector('.quill'),margin=this.shadowRoot.querySelector('.margin'),writing=this.shadowRoot.querySelector('.writing');
  const still=this.motion.matches||background||parseFloat(getComputedStyle(this).getPropertyValue('--pip-motion-duration')||'1')===0,duration=short&&state==='arrival'?300:durations[state];
  leaf.style.transformOrigin='56px 56px';quill.style.transformOrigin='52px 81px';
  const filing=state==='tracker'&&filingTarget&&Number.isFinite(filingTarget.x)&&Number.isFinite(filingTarget.y);
  this.retarget(leaf,{transform:filing?`translate(${filingTarget.x}px, ${filingTarget.y}px) scale(.15)`:state==='blocked'?'scaleY(.75)':'none',opacity:filing?'0':'1'},duration,[],still);
  const park='translate(14px, -5px) scale(.6) rotate(-12deg)';
  this.retarget(quill,{transform:park},duration,state==='working'?[
   {transform:'translate(-12px, -37px) scale(.6)',offset:.08},{transform:'translate(25px, -37px) scale(.6)',offset:.28},
   {transform:'translate(-12px, -27px) scale(.6)',offset:.36},{transform:'translate(18px, -27px) scale(.6)',offset:.57},
   {transform:'translate(-12px, -17px) scale(.6)',offset:.65},{transform:'translate(22px, -17px) scale(.6)',offset:.83}
  ]:[],still);
  this.retarget(margin,{strokeDashoffset:'0'},duration,[],still);
  this.retarget(writing,{strokeDashoffset:state==='arrival'?'1':'0'},duration,[],still);
  this.shadowRoot.querySelector('.unknown').style.visibility=state==='unknown'?'visible':'hidden';
 }
}
customElements.define('pip-living-ink',LivingInk);
