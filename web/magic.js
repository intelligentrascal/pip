// Pip's effects layer: one see-through canvas over the page that passes every click through. Embers are additive light in dark mode and plain amber
// in light mode; paused effects are copper. Effects start at Pip and his lantern, mark a change and end. The loop runs only while something is drawn.
// Levels: calm draws nothing (Pip still moves); balanced draws around Pip but never inside the window's edge; rich adds the rest.
export const LEVELS=['calm','balanced','rich'];
export const DEFAULT_LEVEL='balanced';
const R=(a,b)=>a+Math.random()*(b-a);
const ART={face:[625,300],flame:[800,690],feet:[590,880],body:[610,560]};
export class Magic {
 constructor({canvas,character,win,emit=()=>{},reduced=()=>false}){
  this.canvas=canvas;this.ctx=canvas.getContext('2d');this.character=character;this.win=win;this.emit=emit;this.isReduced=reduced;
  this.level=DEFAULT_LEVEL;this.particles=[];this.sprites=new Map();this.flash=null;this.raf=0;this.last=0;this.ember=0;this.workingOn=false;this.paused=false;this.timers=new Set();this.frames=0;this.size=[0,0,1];
  canvas.hidden=true;
 }
 setLevel(level){
  if(!LEVELS.includes(level)||level===this.level)return;
  this.level=level;
  if(level==='calm')this.stop();
  else this.working(this.workingOn);
 }
 get on(){return this.level!=='calm'&&!this.isReduced()&&!this.character.suspended&&this.character.offsetWidth>0;}
 get rich(){return this.level==='rich';}
 later(fn,ms){const timer=setTimeout(()=>{this.timers.delete(timer);fn();},ms);this.timers.add(timer);return timer;}
 dark(){const a=document.documentElement.dataset.appearance;return a?a==='dark':matchMedia('(prefers-color-scheme: dark)').matches;}
 color(){return getComputedStyle(document.documentElement).getPropertyValue(this.paused?'--wa':'--ac').trim()||'#f3b758';}
 sprite(color){
  const dark=this.dark(),key=color+dark;let s=this.sprites.get(key);
  if(!s){s=document.createElement('canvas');s.width=s.height=32;const x=s.getContext('2d'),g=x.createRadialGradient(16,16,0,16,16,16);g.addColorStop(0,dark?'#fff':color);g.addColorStop(.3,color);g.addColorStop(1,color+'00');x.fillStyle=g;x.fillRect(0,0,32,32);this.sprites.set(key,s);}
  return s;
 }
 at(name,x,y){return this.character.anchor(x??ART[name][0],y??ART[name][1]);}
 add(p){p.m=p.l;p.c=p.c||this.color();this.particles.push(p);this.wake();}
 // Embers that travel to a target along a curve, optionally spiralling in.
 home(from,to,n,life,delay,size,swirl=false){
  for(let i=0;i<n;i++){const s=from.call?from(i):from,e=to.call?to(i):to;
   this.add({sx:s[0],sy:s[1],x:s[0],y:s[1],tx:e[0],ty:e[1],qx:(s[0]+e[0])/2+R(-40,40),qy:Math.min(s[1],e[1])-R(10,70),r0:swirl?R(60,105):0,a0:i*.7,l:life*R(.8,1.2),d:R(0,delay),z:size});}
 }
 burst(c,n,speed,life,size,gravity,up){
  for(let i=0;i<n;i++){const a=R(0,6.283),s=speed*R(.25,1);this.add({x:c[0],y:c[1],vx:Math.cos(a)*s,vy:Math.sin(a)*s-up,l:life*R(.5,1.1),z:size*R(.7,1.3),g:gravity});}
 }
 glow(c,radius,ms){this.flash={x:c[0],y:c[1],r:radius,t:0,c:this.color(),d:ms};this.wake();}
 wake(){
  if(this.raf||!this.on)return;
  this.canvas.hidden=false;this.raf=requestAnimationFrame(t=>this.tick(t));
 }
 stop(){
  if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;this.last=0;this.particles=[];this.flash=null;this.ember=0;
  if(this.canvas.width){this.ctx.setTransform(1,0,0,1,0,0);this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);}
  this.canvas.hidden=true;
 }
 // Reduce Motion or a hidden window: nothing runs and nothing is left drawn.
 halt(){for(const timer of this.timers)clearTimeout(timer);this.timers.clear();this.stop();this.character.ring(false);this.character.bloom(false);this.undim();}
 undim(){if(this.dimmed){this.dimmed=false;this.emit('dim',{on:false});}}
 fit(){
  const d=Math.min(2,devicePixelRatio||1),w=document.documentElement.clientWidth,h=document.documentElement.clientHeight;
  if(this.size[0]!==w||this.size[1]!==h||this.size[2]!==d){this.size=[w,h,d];this.canvas.width=Math.round(w*d);this.canvas.height=Math.round(h*d);}
  return d;
 }
 tick(t){
  this.raf=0;if(!this.on){this.stop();return;}
  const ctx=this.ctx,dt=Math.min(50,t-(this.last||t)),d=this.fit(),w=this.size[0],h=this.size[1],P=this.particles;this.last=t;this.frames++;
  ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,w,h);
  if(this.workingOn&&!this.paused){
   this.ember+=dt*(this.rich?.022:.011);
   while(this.ember>1){this.ember--;const s=this.at('flame',R(785,815),690);this.add({x:s[0],y:s[1],vx:R(-9,9),vy:R(-46,-24),l:R(800,1500),z:R(1.4,2.4),g:-14});}
  }
  ctx.globalCompositeOperation=this.dark()?'lighter':'source-over';
  for(let i=P.length;i--;){
   const p=P[i];
   if(p.d>0){p.d-=dt;continue;}
   p.l-=dt;if(p.l<=0){P.splice(i,1);continue;}
   const u=1-p.l/p.m,e=u*u*(3-2*u),s=1-e;p.px=p.x;p.py=p.y;
   if(p.r0){const a=p.a0+u*5;p.x=p.sx+(p.tx-p.sx)*e+Math.cos(a)*p.r0*s;p.y=p.sy+(p.ty-p.sy)*e+Math.sin(a)*p.r0*s*.3;}
   else if(p.tx!=null){p.x=s*s*p.sx+2*s*e*p.qx+e*e*p.tx;p.y=s*s*p.sy+2*s*e*p.qy+e*e*p.ty;}
   else{p.vx=p.vx*(1-dt*.0015)+R(-1,1)*dt*.3;p.vy=p.vy*(1-dt*.0015)+p.g*dt/1e3;p.x+=p.vx*dt/1e3;p.y+=p.vy*dt/1e3;}
   const alpha=Math.min(1,u*8,(1-u)*2.5),size=p.z*(1.15-u*.4),image=this.sprite(p.c);
   for(let r=0;r<3;r++){ctx.globalAlpha=alpha/(1+r*1.4);ctx.drawImage(image,p.x-(p.x-p.px)*r*1.6-size*2,p.y-(p.y-p.py)*r*1.6-size*2,size*4,size*4);}
  }
  const f=this.flash;
  if(f){f.t+=dt;const u=f.t/f.d;if(u>=1)this.flash=null;else{ctx.globalAlpha=(1-u)*(1-u)*.9;const r=f.r*(.25+.75*u),g=ctx.createRadialGradient(f.x,f.y,0,f.x,f.y,r);g.addColorStop(0,this.dark()?'#fff':f.c);g.addColorStop(.35,f.c);g.addColorStop(1,f.c+'00');ctx.fillStyle=g;ctx.fillRect(f.x-r,f.y-r,r*2,r*2);}}
  ctx.globalAlpha=1;
  // Balanced and Calm keep the text clear: no effect pixel inside the window's edge.
  if(!this.rich){const r=this.win.getBoundingClientRect();ctx.clearRect(r.left,r.top,r.width,r.height);}
  if(P.length||this.flash||(this.workingOn&&!this.paused))this.wake();else{this.last=0;this.canvas.hidden=true;}
 }
 /* Moments, each on its live event */
 // Called. The window does not wait: it is fading in and taking typing while this plays.
 summon({short=false}={}){
  const c=this.character;this.halt();
  if(this.isReduced()){c.reveal();return;}
  if(this.level==='calm'){c.bloom(true);c.reveal({short});this.later(()=>c.bloom(false),short?140:380);return;}
  const full=!short,rich=this.rich;
  c.bloom(true);this.later(()=>c.bloom(false),short?140:380);
  if(full){
   c.conceal();c.ring(true);
   if(rich){this.dimmed=true;this.emit('dim',{on:true});}
   const feet=this.at('feet'),body=this.at('body');
   this.home(feet,()=>[body[0]+R(-6,6),body[1]+R(-30,30)],rich?70:44,400,330,1.9,true);
  }
  else c.conceal();
  this.later(()=>{
   const b=this.at('body');
   c.reveal({short});c.rays({short});this.glow(b,full?150:70,short?270:300);
   this.burst(b,full?(rich?110:64):16,full?230:120,full?840:240,2.1,170,70);
   this.undim();
   if(full){this.later(()=>c.ring(true,{fade:true}),480);this.later(()=>c.ring(false),960);}
  },full?520:0);
 }
 // Leaving mirrors arriving. Returns how long the window waits before it goes.
 hide(){
  const c=this.character;
  if(this.isReduced())return 0;
  if(!this.on)return 160;
  this.working(false);
  const lantern=this.at('flame');
  this.home(()=>this.at(null,R(470,740),R(160,860)),lantern,34,300,90,1.8);
  this.later(()=>this.glow(lantern,46,150),300);
  return 450;
 }
 // Working: scrolls circle (the character does that); embers rise from the lantern at 11 a second, 22 in rich.
 working(on){this.workingOn=on;if(on)this.wake();}
 step(){if(this.on)this.burst(this.at('flame'),4,46,700,1.7,-30,26);}
 // A part arrives: embers fly from the lantern to the window's edge beside it. Rich sends 14 across the window and dusts gold from its top edge.
 part(el){
  if(!el)return;
  el.classList.remove('sw');void el.offsetWidth;el.classList.add('sw');
  if(!this.on)return;
  const w=this.win.getBoundingClientRect(),e=el.getBoundingClientRect(),rich=this.rich;
  const x=rich?e.left+14:w.right+4,y=Math.max(w.top+16,Math.min(w.bottom-16,e.top+e.height/2));
  this.home(this.at('flame'),()=>[x+R(-3,3),y+R(-12,12)],rich?14:6,460,160,1.8);
  if(rich)this.later(()=>{for(let i=0;i<16;i++)this.add({x:e.left+R(0,e.width),y:e.top+R(-2,6),vx:R(-8,8),vy:R(4,26),l:R(500,1000),z:R(1,1.8),g:30});},480);
 }
 // Paused: a copper circle that stays, one scroll held out, embers to the panel in copper.
 pause(on,panel){
  this.paused=on;const c=this.character;
  if(!on){if(c.hasAttribute('data-ring'))c.ring(false);return;}
  if(!this.on)return;
  c.ring(true);
  if(panel){const e=panel.getBoundingClientRect(),w=this.win.getBoundingClientRect();this.home(this.at('flame'),()=>[w.right+4+R(-3,3),Math.max(w.top+16,Math.min(w.bottom-16,e.top+e.height/2))+R(-12,12)],this.rich?14:6,460,160,1.8);}
 }
 // Yes: the held scroll flies away, Pip hops, embers burst from the lantern and fall.
 yes(){
  const c=this.character;this.paused=false;c.send();c.hop();c.ring(false);
  if(this.on)this.burst(this.at('flame'),this.rich?60:30,150,1300,2,150,170);
 }
 // Pressing Pip: hop, blink and, above Calm, eight embers.
 poke(){
  const c=this.character;if(this.isReduced())return;
  c.hop();c.blink();
  if(this.on)this.burst(this.at('flame',800,700),8,60,600,1.6,-20,30);
 }
}

window.PipMagic = Magic;
window.PipMagicLevels = LEVELS;
