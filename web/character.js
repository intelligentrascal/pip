// Pip drawn from his 26 painted layers (assets/curious-hearth). Idle life is CSS only, so a waiting Pip asks for no script frames.
// One animation-frame loop runs only while the gaze is still moving, the scrolls circle or a moment is playing.
const SCENES={rest:'rest',arrival:'rest',intent:'rest',tracker:'rest',done:'rest',working:'working',thinking:'working',approval:'paused',blocked:'problem',unknown:'problem',listening:'talking'};
// Head tilt and ear lift by pose (degrees). Left ear takes ear, right ear takes -ear.
const HEAD={working:-3,paused:-2,problem:3,talking:-4},EAR={problem:-12,talking:6};
const REST_MS=2500;
export class PipCharacter extends HTMLElement {
 constructor(){
  super();this.attachShadow({mode:'open'});this.scene='rest';this.pose='rest';this.assetsReady=false;this.lastOptions={};
  const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./character.css',import.meta.url);
  const source=document.getElementById('pip-character-rig');
  if(!source)throw Error('The selected character registration is not bundled');
  this.svg=source.content.querySelector('svg').cloneNode(true);
  this.hero=this.svg.querySelector('[data-part=hero]');
  this.parts=new Map([...this.svg.querySelectorAll('[data-part]')].map(node=>[node.dataset.part,node]));
  for(const node of this.svg.querySelectorAll('[data-pivot]')){const [x,y]=node.dataset.pivot.split(' ');node.style.transformOrigin=`${x}px ${y}px`;}
  for(const node of this.svg.querySelectorAll('[data-role]:not([data-pivot])'))node.style.transformOrigin='0px 0px';
  this.irises=[...this.svg.querySelectorAll('[data-role=iris]')];
  this.fallback=document.createElement('img');this.fallback.className='fallback';this.fallback.alt='';this.fallback.hidden=true;
  const shadow=document.createElement('div');shadow.className='shadow';
  const ring=document.createElementNS('http://www.w3.org/2000/svg','svg');ring.setAttribute('class','ring');ring.setAttribute('viewBox','-100 -100 200 200');ring.setAttribute('aria-hidden','true');
  ring.innerHTML='<g><circle r="96" pathLength="1"/><circle r="79" pathLength="1"/><circle class="tick" r="87.5"/><path pathLength="1" d="M0-79L46 64-75-24H75L-46 64Z"/><circle r="30" pathLength="1"/></g>';
  const rays=document.createElement('div');rays.className='rays';
  this.shadowRoot.append(link,shadow,ring,rays,this.svg,this.fallback);
  this.motion=matchMedia('(prefers-reduced-motion: reduce)');
  this.onMotion=()=>this.sync();
  this.g={ex:0,ey:0,hx:0,hy:0,h2:0,cx:0,cy:0,oa:0};this.pointerAt=null;this.pointerTime=-1e9;this.focus=null;this.raf=0;this.last=0;this.jump=true;this.timers=new Set();this.suspended=false;this.frames=0;
  // Decode asynchronously: art readiness must never gate the composer or native focus.
  this.ready=Promise.all([...new Set([...this.svg.querySelectorAll('image')].map(node=>node.getAttribute('href')))].map(href=>new Promise((resolve,reject)=>{
   const image=new Image();image.onload=()=>image.decode().then(()=>resolve({width:image.naturalWidth,height:image.naturalHeight}),reject);image.onerror=reject;image.src=new URL(href,document.baseURI);
  }))).then(images=>{
   this.resourceStats={images:images.length,decodedRgbaBytes:images.reduce((total,image)=>total+image.width*image.height*4,0)};
   this.assetsReady=true;this.dataset.artStatus='ready';this.sync();
   return true;
  }).catch(()=>{
   this.dataset.artStatus='fallback';this.svg.style.visibility='hidden';this.fallback.src=new URL(this.svg.dataset.fallback,document.baseURI);this.fallback.hidden=false;
   return false;
  });
 }
 connectedCallback(){this.motion.addEventListener('change',this.onMotion);this.showState(this.scene);}
 disconnectedCallback(){this.motion.removeEventListener('change',this.onMotion);this.stopLoop();for(const timer of this.timers)clearTimeout(timer);this.timers.clear();}
 later(fn,ms){const timer=setTimeout(()=>{this.timers.delete(timer);fn();},ms);this.timers.add(timer);return timer;}
 get reduced(){return this.motion.matches||this.hasAttribute('data-reduce-app');}
 // The app turns Reduce Motion on or off (system setting or the page's own flag): still poses, no loops, no following, no moments.
 setReduced(on){this.toggleAttribute('data-reduce-app',on);this.sync();}
 sync(){
  this.toggleAttribute('data-reduce',this.reduced);
  if(this.reduced){this.clearMoments();this.jump=true;}
  this.applyPose();this.wake();
 }
 clearMoments(){for(const name of ['data-hop','data-reveal','data-rays','data-ring','data-bloom','data-sent','data-blinking'])this.removeAttribute(name);}
 // Whether a hidden window runs nothing: animations pause and the frame loop stops.
 setHidden(on){this.suspended=on;this.toggleAttribute('data-hidden',on);if(on)this.stopLoop();else{this.jump=true;this.wake();}}
 showState(scene,{verified=false,background=false}={}){
  if(!Object.hasOwn(SCENES,scene))throw Error('Unknown character state');
  if(scene==='done'&&verified!==true)throw Error('A verified outcome is required');
  this.scene=scene;this.dataset.state=scene;this.lastOptions={verified,background};
  this.pose=SCENES[scene];this.applyPose();this.wake();
 }
 applyPose(){
  const pose=this.pose;this.dataset.pose=pose;
  this.dataset.mouth=pose==='problem'?(this.scene==='unknown'?'neutral':'concern'):'smile';
  const mouth=this.dataset.mouth;
  for(const [name,node] of this.parts)if(name.startsWith('mouth-')){
   const available=this.parts.has('mouth-'+mouth);
   node.style.opacity=name==='mouth-'+(available?mouth:'smile')?'1':'0';
  }
  this.write();
 }
 // Pointer in page coordinates. null: the pointer is not on this screen.
 pointer(x,y){
  if(x==null){this.pointerAt=null;}else{this.pointerAt=[x,y];this.pointerTime=performance.now();}
  clearTimeout(this.restTimer);if(this.pointerAt)this.restTimer=setTimeout(()=>this.wake(),REST_MS+30);
  this.wake();
 }
 // Provides where to look when the pointer is still: a function returning page coordinates or null.
 setFocus(provider){this.focus=provider;this.wake();}
 // Art coordinates (1024 grid) to page coordinates.
 anchor(x,y){const box=this.getBoundingClientRect(),k=box.width/1024;return [box.left+x*k,box.top+y*k];}
 aim(now){
  if(this.reduced||this.suspended)return [0,0];
  const face=this.anchor(625,300);let target=null;
  if(this.pointerAt&&now-this.pointerTime<REST_MS)target=this.pointerAt;
  else if(this.focus)target=this.focus();
  if(!target)return [0,0];
  const dx=target[0]-face[0],dy=target[1]-face[1],d=Math.hypot(dx,dy);
  return d?[dx/(d+80),dy/(d+80)]:[0,0];
 }
 get working(){return !this.reduced&&!this.suspended&&this.pose==='working';}
 wake(){if(!this.raf&&!this.suspended&&this.isConnected)this.raf=requestAnimationFrame(t=>this.tick(t));}
 stopLoop(){if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;this.last=0;}
 write(){
  const g=this.g,ear=EAR[this.pose]||0,lag=(g.hx-g.h2)*30,style=this.style;
  const values={'--ix':`${(g.ex*11).toFixed(2)}px`,'--iy':`${(g.ey*8).toFixed(2)}px`,'--hx':`${(g.hx*14).toFixed(2)}px`,'--hy':`${(g.hy*9).toFixed(2)}px`,'--hr':`${((HEAD[this.pose]||0)+g.hx*6).toFixed(2)}deg`,'--bl':`${(g.h2*1.5).toFixed(2)}deg`,'--e1':`${(ear-lag).toFixed(2)}deg`,'--e2':`${(-ear-lag).toFixed(2)}deg`,'--cx':`${(g.cx*40).toFixed(2)}px`,'--cy':`${(g.cy*28).toFixed(2)}px`,'--oa':`${g.oa.toFixed(2)}deg`};
  for(const key in values)style.setProperty(key,values[key]);
 }
 tick(t){
  this.raf=0;if(this.suspended||!this.isConnected)return;
  const dt=Math.min(50,t-(this.last||t)),g=this.g,reduced=this.reduced,now=reduced||this.jump,G=this.aim(performance.now());
  this.last=t;this.jump=false;this.frames++;
  let a=now?1:1-Math.exp(-dt/70);g.ex+=(G[0]-g.ex)*a;g.ey+=(G[1]-g.ey)*a;
  a=now?1:1-Math.exp(-dt/240);g.hx+=(G[0]-g.hx)*a;g.hy+=(G[1]-g.hy)*a;
  a=now?1:1-Math.exp(-dt/520);g.h2+=(g.hx-g.h2)*a;g.cx+=(G[0]-g.cx)*a;g.cy+=(G[1]-g.cy)*a;
  // Scrolls circle at 150 degrees a second while working, then finish the lap.
  const turned=g.oa%360;
  if(this.working)g.oa+=dt*.15;else if(turned)g.oa=360-turned<1||reduced?0:g.oa+Math.min(360-turned,dt*(.04+.3*(360-turned)/360));
  this.write();
  if(this.working||g.oa%360||Math.abs(G[0]-g.cx)+Math.abs(G[1]-g.cy)+Math.abs(g.hx-g.h2)+Math.abs(G[0]-g.hx)>.003)this.wake();else this.last=0;
 }
 // A small, immediate reaction (a key pressed): the eyes and head dip, then settle by themselves.
 nudge(x,y){if(this.reduced||this.suspended)return;this.g.ex+=x;this.g.ey+=y*2;this.g.hx+=x/2;this.g.hy+=y/2;this.write();this.wake();}
 // Moments. Each is one pass and ends by itself.
 hop(){if(this.reduced)return;this.removeAttribute('data-hop');void this.offsetWidth;this.setAttribute('data-hop','');this.later(()=>this.removeAttribute('data-hop'),520);}
 blink(ms=170){if(this.reduced)return;this.setAttribute('data-blinking','');this.later(()=>this.removeAttribute('data-blinking'),ms);}
 // Revealed from the feet up out of white light; the short form takes 0.3 s.
 reveal({short=false}={}){
  this.concealed=false;this.removeAttribute('data-concealed');if(this.fallback)this.fallback.hidden=this.dataset.artStatus!=='fallback';
  if(this.reduced)return;
  this.setAttribute('data-reveal',short?'short':'full');
  this.later(()=>this.removeAttribute('data-reveal'),short?290:950);
 }
 rays({short=false}={}){if(this.reduced)return;this.removeAttribute('data-rays');void this.offsetWidth;this.setAttribute('data-rays',short?'short':'full');this.later(()=>this.removeAttribute('data-rays'),short?290:740);}
 // The circle of light on the ground. color: the pose decides it, so a paused ring is copper.
 ring(on,{fade=false}={}){if(this.reduced&&on)return;if(!on)this.removeAttribute('data-ring');else this.setAttribute('data-ring',fade?'fading':'');}
 bloom(on){this.toggleAttribute('data-bloom',on&&!this.reduced);}
 send(){if(this.reduced)return;this.setAttribute('data-sent','');this.later(()=>this.removeAttribute('data-sent'),1100);}
 conceal(){this.concealed=true;this.setAttribute('data-concealed','');if(this.fallback)this.fallback.hidden=true;this.clearMoments();}
 get headDriver(){return this.svg.querySelector('[data-role=head]');}
 // The Magic effects need to follow the lantern, the face and the held scroll.
 get anchors(){return {lantern:this.anchor(800,740),flame:this.anchor(800,690),feet:this.anchor(590,880),body:this.anchor(610,560),face:this.anchor(625,300),hand:this.anchor(370,466)};}
}
customElements.define('pip-character',PipCharacter);
