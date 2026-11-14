import './smoke-pixels.js';
// Emberweave: the parchment page unrolls from Pip's open palm and each state gets its own
// contextual effect. One event-owned clock drives DOM props, panel reveal and a bounded WebGL2
// particle pass; nothing runs once a finite event settles. Reduced motion cuts to still props.
// Task meaning, receipts and permissions stay with app.js and the native host.
const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v)),ease=v=>1-Math.pow(1-clamp(v),3),span=(v,a,b)=>clamp((v-a)/(b-a));
// ms: finite performance length. mode: GPU motion id. cap: fixed particle ceiling (bible budgets).
const EFFECTS=Object.freeze({
 arrival:{ms:1350,mode:0,cap:768},listening:{ms:450,mode:1,cap:128},thinking:{ms:1300,mode:2,cap:192},
 working:{ms:1650,mode:3,cap:256},approval:{ms:900,mode:4,cap:64},blocked:{ms:850,mode:5,cap:64},
 unknown:{ms:800,mode:6,cap:48},done:{ms:1150,mode:7,cap:192},tracker:{ms:1000,mode:8,cap:128},hide:{ms:650,mode:9,cap:256}
});
// A quick repeat summon plays a short version of the arrival (captain's choice, ELF-32).
const SHORT_ARRIVAL_MS=300;
const TINT={4:[.91,.75,.47],5:[.72,.74,.68],6:[.8,.72,.5],7:[.67,.84,.72]};
const VERT=`#version 300 es
precision highp float;
uniform vec2 res,P0,P1,P2,P3,Q;uniform vec4 aux;uniform float phase,energy,dpr;uniform int mode;
out float alpha;out float tone;
float h(float n){return fract(sin(n*127.1+311.7)*43758.5453);}
float ez(float n){return 1.-pow(1.-clamp(n,0.,1.),3.);}
float sp(float v,float a,float b){return clamp((v-a)/(b-a),0.,1.);}
vec2 bez(float u){float v=1.-u;return v*v*v*P0+3.*v*v*u*P1+3.*v*u*u*P2+u*u*u*P3;}
vec2 nrm(float u){vec2 d=bez(min(u+.01,1.))-bez(max(u-.01,0.));return normalize(vec2(-d.y,d.x)+1e-4);}
void main(){
 float id=float(gl_VertexID),r=h(id),z=h(id+31.),a=h(id+9.)*6.2831853;
 vec2 p=P0;float life=0.,t=phase;tone=r;
 if(mode==0){
  if(mod(id,3.)<1.){float u=clamp(t*1.7-z*.2,0.,1.);p=bez(u)+nrm(u)*sin(u*18.+a)*5.*sin(u*3.14159);life=sin(u*3.14159);}
  else{float g=1.-t,sp=a+g*3.9*(.5+z),rad=(14.+r*aux.z)*(.25+g)*energy;p=aux.xy+vec2(cos(sp)*rad*.63,sin(sp)*rad*.72-g*40.);life=sin(clamp((t-z*.17)/.83,0.,1.)*3.14159);}
 }else if(mode==1){
  float u=clamp(t*1.5-r*.5,0.,1.);p=bez(u)+nrm(u)*sin(u*20.+a)*3.;life=sin(u*3.14159)*.8;
 }else if(mode==2){
  float k=floor(r*3.);vec2 s=k<1.?P0:k<2.?P1:P2,e=k<1.?P1:k<2.?P2:P3;
  float c=ez(sp(t,.4+z*.1,1.));p=mix(s,e,c)+vec2(cos(a),sin(a))*(2.+r*9.)*(1.-c*.8);life=smoothstep(0.,.3,t)*(1.-smoothstep(.8,1.,t))*(.4+z*.6);
 }else if(mode==3){
  float head=ez(t),s=clamp(head-z*.12,0.,1.);
  p=s<.55?bez(s/.55):mix(P3,Q,(s-.55)/.45);p+=vec2(cos(a),sin(a))*r*2.;life=(1.-smoothstep(.75,1.,t))*(1.-z*.5);
 }else if(mode==4){
  float head=1.-pow(1.-t,4.),s=clamp(head-z*.1,0.,1.);p=bez(s)+vec2(cos(a),sin(a))*r*2.;life=(1.-smoothstep(.55,1.,t))*(1.-z*.6);
 }else if(mode==5){
  float s=clamp(ez(t/.6)-z*.1,0.,1.);p=bez(s);float f=max(0.,t-.6);p.y+=f*f*150.*z;p.x+=sin(id)*f*6.;life=(1.-smoothstep(.6,1.,t))*(1.-z*.5);
 }else if(mode==6){
  p=P0+vec2(cos(a)*r*14.,sin(a)*r*10.-t*26.*z);life=sin(clamp((t-z*.2)/.8,0.,1.)*3.14159)*.7;
 }else if(mode==7){
  float head=ez(t/.55);float s=clamp(head-z*.1,0.,1.);
  if(t<.55){p=bez(s);life=sin(s*3.14159);}
  else{float b=ez((t-.55)/.45);p=P3+vec2(cos(a),sin(a))*(10.+r*12.)*b;life=(1.-b)*.9;}
 }else if(mode==8){
  float head=ez(t),s=clamp(head-z*.15,0.,1.);p=bez(s)+nrm(s)*sin(s*14.+a)*3.;life=sin(s*3.14159);
 }else if(mode==9){
  float u=clamp(1.-ez(t/.75)+z*.1,0.,1.);p=bez(u)+vec2(cos(a),sin(a))*r*4.;life=sin(clamp(u,0.,1.)*3.14159)*(1.-smoothstep(.8,1.,t));
 }
 gl_Position=vec4(p/res*2.-1.,0.,1.);gl_Position.y*=-1.;
 gl_PointSize=(1.2+z*3.2)*2.*dpr;alpha=life*(.25+.75*z);
}`;
const FRAG=`#version 300 es
precision highp float;in float alpha;in float tone;uniform vec3 tint;out vec4 colour;
void main(){float d=length(gl_PointCoord-.5);float a=(1.-smoothstep(.08,.5,d))*alpha;vec3 c=mix(tint,vec3(1.,.94,.72),tone*.45);colour=vec4(c*a,a);}`;
const QV=`#version 300 es
precision highp float;out vec2 uv;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`;
const QF=`#version 300 es
precision highp float;in vec2 uv;out vec4 colour;uniform vec2 res,hand;uniform vec4 aux;uniform float phase,smoke,glow,hasAtlas;uniform sampler2D atlas;
float hs(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float nz(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hs(i),hs(i+vec2(1,0)),f.x),mix(hs(i+vec2(0,1)),hs(i+vec2(1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,v=0.;for(int i=0;i<4;i++){v+=a*nz(p);p=p*2.03+vec2(3.1,1.7);a*=.5;}return v;}
void main(){
 vec2 px=vec2(uv.x,1.-uv.y)*res;vec3 col=vec3(0.);float al=0.;
 if(smoke>0.){
  vec2 p=(px-aux.xy)/vec2(aux.z*.8,aux.z*.95);float t=phase,sw=atan(p.y,p.x)+t*2.4;
  vec2 w=vec2(sin(sw*2.3),cos(sw*2.1))*.22;float n=fbm((p+w)*4.2+vec2(t*1.9,-t*2.2));
  float body=exp(-dot(p,p)*1.6),dens=smoothstep(.29,.78,n)*body,edge=pow(max(0.,1.-abs(n-.55)*3.),7.)*body;
  float ev=sin(clamp(t,0.,1.)*3.14159);
  if(hasAtlas>.5){dens*=mix(.65,1.25,texture(atlas,fract(px/180.+vec2(t*.05,-t*.08))).r);}
  float s=dens*ev*.34*smoke;col+=mix(vec3(.67,.62,.43),vec3(.94,.78,.45),edge*.7)*s;al+=s;
 }
 float d=length(px-hand);float g=exp(-d*d/(2.*18.*18.))*glow;col+=vec3(1.,.82,.45)*g;al+=g*.8;
 colour=vec4(col,clamp(al,0.,1.));
}`;
class Gpu{
 constructor(canvas){
  this.canvas=canvas;this.draws=0;this.lost=false;this.ready=false;
  const gl=this.gl=canvas.getContext('webgl2',{alpha:true,antialias:false,premultipliedAlpha:true,powerPreference:'low-power'});
  if(!gl){canvas.dataset.renderer='unavailable';return;}
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.lost=true;canvas.dataset.renderer='lost';});
  try{
   const sh=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
   const prog=(v,f)=>{const p=gl.createProgram();gl.attachShader(p,sh(gl.VERTEX_SHADER,v));gl.attachShader(p,sh(gl.FRAGMENT_SHADER,f));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;};
   this.pts=prog(VERT,FRAG);this.quad=prog(QV,QF);this.vao=gl.createVertexArray();
   this.tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.tex);
   const smokePixels=window.PipSmokePixels,bytes=Uint8Array.from(atob(smokePixels.data),c=>c.charCodeAt(0));
   gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,smokePixels.width,smokePixels.height,0,gl.RED,gl.UNSIGNED_BYTE,bytes);
   for(const [k,v] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.REPEAT],[gl.TEXTURE_WRAP_T,gl.REPEAT]])gl.texParameteri(gl.TEXTURE_2D,k,v);
   gl.bindVertexArray(this.vao);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
   this.ready=true;canvas.dataset.renderer='webgl2';canvas.dataset.atlas='generated-r8-pack';
  }catch(error){canvas.dataset.renderer='error';canvas.dataset.error=String(error.message).slice(0,200);}
 }
 size(width,height,dpr){const w=Math.round(width*dpr),h=Math.round(height*dpr);if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}this.res=[width,height];this.dpr=dpr;}
 clear(){if(!this.ready||this.lost)return;const gl=this.gl;gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);}
 render(effect,phase,energy,a){
  if(!this.ready||this.lost)return;const gl=this.gl,u=(p,n)=>gl.getUniformLocation(p,n);
  this.clear();
  gl.useProgram(this.quad);
  gl.uniform2f(u(this.quad,'res'),...this.res);gl.uniform2f(u(this.quad,'hand'),...a.P0);gl.uniform4f(u(this.quad,'aux'),...a.aux);
  gl.uniform1f(u(this.quad,'phase'),phase);gl.uniform1f(u(this.quad,'smoke'),effect.mode===0?energy:0);gl.uniform1f(u(this.quad,'glow'),a.glow);gl.uniform1f(u(this.quad,'hasAtlas'),1);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.tex);gl.uniform1i(u(this.quad,'atlas'),0);gl.drawArrays(gl.TRIANGLES,0,3);
  gl.useProgram(this.pts);
  gl.uniform2f(u(this.pts,'res'),...this.res);for(const k of ['P0','P1','P2','P3','Q'])gl.uniform2f(u(this.pts,k),...a[k]);
  gl.uniform4f(u(this.pts,'aux'),...a.aux);gl.uniform1f(u(this.pts,'phase'),phase);gl.uniform1f(u(this.pts,'energy'),energy);gl.uniform1f(u(this.pts,'dpr'),this.dpr);
  gl.uniform1i(u(this.pts,'mode'),effect.mode);gl.uniform3f(u(this.pts,'tint'),...(TINT[effect.mode]??[.89,.68,.32]));
  gl.drawArrays(gl.POINTS,0,effect.cap);this.draws++;this.canvas.dataset.draws=String(this.draws);
 }
}
class Emberweave{
 constructor(dom){
  Object.assign(this,dom);this.scene='arrival';this.raf=0;this.energy=1;this.level=0;this.running=null;this.forcedReduced=false;this.concealed=false;this.after='arrival';
  this.gpu=new Gpu(this.canvas);this.motion=matchMedia('(prefers-reduced-motion: reduce)');
  this.motion.addEventListener('change',()=>{if(this.reduced)this.settle();});
  this.props.dataset.scene='arrival';this.surface.dataset.motion='still';
 }
 get reduced(){return this.forcedReduced||this.motion.matches;}
 rect(el){const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};}
 // Anchors are read once per performance from live layout, so a resize or taller result never strands an effect.
 layout(){
  const w=innerWidth,h=innerHeight,dpr=Math.min(2,devicePixelRatio||1);this.gpu.size(w,h,dpr);
  this.props.setAttribute('viewBox',`0 0 ${w} ${h}`);
  const pip=this.rect(this.pip),P=this.rect(this.panel),conv=this.rect(this.conversation),C=this.rect(this.composer);
  const R=conv.height>4?conv:{left:P.left+16,right:P.right-16,top:P.top+52,bottom:P.top+52+72,width:P.width-32,height:72};
  const hand=[pip.left+pip.width*.34,pip.top+pip.height*.44],ear=[pip.left+pip.width*.47,pip.top+pip.height*.2];
  const talk=this.rect(this.talk),tracker=this.rect(this.trackerButton),L={hand,ear,P,R,C,talk,tracker,pip};
  const gutter=P.right+12;
  L.rail={y:R.bottom+1,x0:R.left+14,x1:R.right-14};
  L.rest={x0:R.right-96,x1:R.right-16,y:R.bottom+1};
  L.fold={x0:R.left+10,x1:R.right-10,y:R.bottom+1};
  L.seal=[R.right-26,R.top+20];L.knot=[R.right-30,R.top+18];
  L.route=[hand,[gutter,hand[1]-70],[gutter,R.bottom+36],[L.rail.x1,L.rail.y]];
  this.L=L;return L;
 }
 anchors(scene){
  const L=this.L,e=EFFECTS[scene],hand=L.hand,r=[...L.route];
  const A={P0:hand,P1:r[1],P2:r[2],P3:r[3],Q:[L.rail.x0,L.rail.y],aux:[L.pip.left+L.pip.width*.5,L.pip.top+L.pip.height*.55,90,0],glow:0};
  switch(scene){
   case 'arrival':A.P1=[L.P.right+40,L.P.top+L.P.height*.6];A.P2=[L.P.left+L.P.width*.5,L.P.top-30];A.P3=[L.P.left+10,L.P.top+4];break;
   case 'listening':A.P0=[L.talk.left+L.talk.width/2,L.talk.top];A.P1=[L.talk.right+30,L.talk.top-50];A.P2=[L.P.right+10,L.ear[1]+60];A.P3=L.ear;break;
   case 'thinking':{const y=L.R.top-6,x=f=>L.R.left+L.R.width*f;A.P0=[x(.5),y];A.P1=[x(.68),y-3];A.P2=[x(.86),y];A.P3=[L.P.right+8,y];break;}
   case 'approval':A.P1=[L.P.right+14,L.hand[1]-40];A.P2=[L.rest.x1,L.rest.y+30];A.P3=[L.rest.x0+8,L.rest.y+3];break;
   case 'working':A.P2=[L.rail.x0+60,L.rail.y+40];A.P3=[L.rail.x0,L.rail.y];A.Q=[L.rail.x1,L.rail.y];break;
   case 'blocked':A.P1=[L.P.right+14,L.hand[1]-60];A.P2=[L.P.right+24,L.fold.y+2];A.P3=[L.fold.x1-96,L.fold.y+3];break;
   case 'unknown':A.P0=L.knot;break;
   case 'done':A.P0=[L.C.left+30,L.C.top-6];A.P1=[L.C.left+90,L.R.bottom];A.P2=[L.seal[0]-60,L.seal[1]+40];A.P3=L.seal;break;
   case 'tracker':A.P1=[L.P.right+40,L.hand[1]-90];A.P2=[L.tracker.left+30,L.tracker.bottom+60];A.P3=[L.tracker.left+L.tracker.width/2,L.tracker.top+L.tracker.height/2];break;
   case 'hide':A.P1=[L.P.right+30,L.P.top+L.P.height*.5];A.P2=[L.P.left+L.P.width*.6,L.P.top];A.P3=[L.P.left+8,L.P.top+4];break;
  }
  A.cap=e.cap;return A;
 }
 // The thread leaves the palm along the page's outer edge and lies along the fold; `tight` lifts it taut while the quill is still travelling.
 thread(tight){const L=this.L,r=L.P.right;return `M${L.hand[0]} ${L.hand[1]} C${r+14} ${L.hand[1]-90} ${r+14} ${L.fold.y+90-40*tight} ${r+8} ${L.fold.y+4} Q${r-30} ${L.fold.y+10-18*tight} ${L.fold.x1-96} ${L.fold.y+3}`;}
 // ---- props: literal still poses per state, so reduced motion and settled states stay distinct ----
 put(id,attrs){const n=this.props.querySelector('#'+id);for(const k in attrs)n.setAttribute(k,attrs[k]);return n;}
 quillAt(x,y,rot,opacity=1){this.put('ew-quill',{transform:`translate(${x} ${y}) rotate(${rot}) scale(1.8)`,opacity});}
 still(scene){
  const L=this.L,p=this.props;p.dataset.scene=scene;
  this.put('ew-rest-line',{x1:L.rest.x0,x2:L.rest.x1,y1:L.rest.y+3,y2:L.rest.y+3});
  this.put('ew-clip',{transform:`translate(${L.R.right-22} ${L.R.top-2})`});
  this.put('ew-fold-band',{points:`${L.fold.x0},${L.fold.y} ${L.fold.x1},${L.fold.y} ${L.fold.x1},${L.fold.y+4} ${L.fold.x0},${L.fold.y+4}`});
  this.put('ew-fold-flap',{points:`${L.fold.x1-40},${L.fold.y} ${L.fold.x1},${L.fold.y} ${L.fold.x1-4},${L.fold.y-13}`});
  this.put('ew-thread',{d:this.thread(0)});
  this.put('ew-knot',{transform:`translate(${L.knot[0]} ${L.knot[1]})`});
  this.put('ew-seal',{transform:`translate(${L.seal[0]} ${L.seal[1]})`});
  const mic=[L.talk.left+L.talk.width/2,L.talk.top-9];this.put('ew-mic',{transform:`translate(${mic[0]} ${mic[1]})`});
  this.put('ew-meter',{transform:`translate(${mic[0]-11} ${mic[1]-6})`});this.meter();
  const dots=this.props.querySelectorAll('#ew-islands circle'),y=L.R.top-6;
  [.5,.68,.86].forEach((f,i)=>{dots[i].setAttribute('cx',L.R.left+L.R.width*f);dots[i].setAttribute('cy',y);});
  this.put('ew-route',{d:`M${L.R.left+L.R.width*.5} ${y} L${L.R.left+L.R.width*.68} ${y} L${L.R.left+L.R.width*.86} ${y}`});
  this.put('ew-rail-line',{x1:L.rail.x0,x2:L.rail.x1,y1:L.rail.y+3,y2:L.rail.y+3});
  const parked={approval:[L.rest.x0+8,L.rest.y+3,52],blocked:[L.fold.x1-96,L.fold.y+3,52]}[scene];
  if(parked)this.quillAt(...parked);
  else if(scene==='working')this.quillAt(L.rail.x1-48,L.rail.y+3,52,.9);
  else this.quillAt(0,0,0,0);
  this.put('ew-writing',{d:`M${L.rail.x0} ${L.rail.y+3} L${scene==='working'?L.rail.x1-10:L.rail.x0} ${L.rail.y+3}`});
 }
 // ---- clock ----
 cancel(){cancelAnimationFrame(this.raf);this.raf=0;this.running=null;}
 settle(scene=this.scene){
  this.cancel();if(this.concealed)return;this.scene=scene;this.layout();this.still(scene);this.gpu.clear();
  this.unrolled(1);this.pipMask(1);this.surface.dataset.motion='still';
 }
 play(scene,{background=false,short=false}={}){
  if(this.concealed)return;
  const e=EFFECTS[scene];
  if(!e){this.scene=scene;this.layout();this.still(scene);return;}
  this.layout();this.scene=scene;
  if(this.reduced||background||document.hidden){this.settle(scene);return;}
  this.running={scene,start:performance.now(),ms:short&&scene==='arrival'?SHORT_ARRIVAL_MS:e.ms};this.surface.dataset.motion='playing';
  this.props.dataset.scene=scene;this.still(scene);
  if(scene==='arrival')this.panel.classList.add('revealing');
  this.tick(performance.now());
 }
 tick=now=>{
  const run=this.running;if(!run)return;
  const t=clamp((now-run.start)/run.ms);this.frame(run.scene,t);
  if(t>=1){const s=run.scene;this.running=null;this.raf=0;this.finish(s);}else this.raf=requestAnimationFrame(this.tick);
 };
 finish(scene){
  this.gpu.clear();this.surface.dataset.motion='still';
  if(scene==='hide'){const done=this.hideDone;this.conceal();done?.();return;}
  this.unrolled(1);this.pipMask(1);this.still(scene==='arrival'?this.after:scene);
 }
 frame(scene,t){
  const A=this.anchors(scene),e=EFFECTS[scene],L=this.L;A.glow=Math.sin(Math.PI*t)*(scene==='arrival'?1:.45);
  if(scene==='arrival'){
   const sheet=ease(span(t,.31,.94)),wide=ease(span(t,.27,.66));this.unrolled(sheet,wide);this.pipMask(ease(span(t,.08,.48)));
   A.aux=[A.aux[0],A.aux[1],90,0];
  }else if(scene==='hide'){
   const out=ease(span(t,0,.7));this.unrolled(1-out,1-out);this.pipMask(1-ease(span(t,.48,1)));A.aux=[A.aux[0],A.aux[1],90,0];
  }
  if(scene==='working'){
   const q=clamp(ease(t)/.55),wr=span(t,.5,.95);let x,y;
   if(q<1)[x,y]=bez(A,q);else{x=L.rail.x0+(L.rail.x1-L.rail.x0)*wr;y=L.rail.y+3-Math.abs(Math.sin(wr*18))*2;}
   this.quillAt(x,y,52,1);this.put('ew-writing',{d:`M${L.rail.x0} ${L.rail.y+3} L${q<1?L.rail.x0:x} ${L.rail.y+3}`});
  }
  if(scene==='approval'){const s=1-Math.pow(1-t,4),pt=bez(A,s);this.quillAt(pt[0],pt[1],52-30*(1-s),1);}
  if(scene==='blocked'){const s=ease(t/.6),pt=bez(A,s);this.quillAt(pt[0],pt[1],52,1);
   this.put('ew-thread',{d:this.thread(1-span(t,.6,1))});}
  if(scene==='done'){const s=ease(span(t,.45,.8));this.put('ew-seal',{transform:`translate(${L.seal[0]} ${L.seal[1]}) scale(${.7+.3*s})`,opacity:s});}
  if(scene==='tracker'){const s=ease(t),pt=bez(A,s);this.put('ew-slip',{transform:`translate(${pt[0]} ${pt[1]}) rotate(${-s*40}) scale(${1-.5*s})`,opacity:Math.sin(Math.PI*s)});}
  if(scene==='thinking'){const c=span(t,.4,1);this.put('ew-route',{'stroke-dashoffset':String(1-c)});}
  if(scene==='listening'){this.put('ew-mic',{opacity:ease(t)});}
  this.gpu.render(e,t,this.energy,A);
 }
 // The page unrolls from its lower right corner (Pip's palm): wide = leftward reach, up = upward reach.
 unrolled(up,wide=up){
  const p=this.panel,roll=this.roll;
  if(up>=1&&wide>=1){p.classList.remove('revealing');p.style.clipPath='';p.style.transform='';p.style.visibility='';roll.hidden=true;return;}
  const W=p.offsetWidth,H=p.offsetHeight,left=100-wide*100,top=100-up*100,wob=Math.sin(Math.PI*up)*3;
  p.classList.add('revealing');
  p.style.clipPath=`polygon(${left}% ${top+wob}%,${left+(100-left)*.25}% ${top}%,${left+(100-left)*.6}% ${top+wob*.8}%,100% ${top}%,100% 100%,${left}% 100%)`;
  p.style.transform=`perspective(850px) rotateX(${(1-up)*14}deg) rotateY(${(1-wide)*-6}deg)`;
  const box=p.getBoundingClientRect(),sr=this.surface.getBoundingClientRect();
  const rollW=W*wide;roll.hidden=up<=.002;roll.style.width=rollW+'px';roll.style.transform=`translate(${box.right-sr.left-rollW}px,${box.top-sr.top+H*(1-up)-7}px)`;
 }
 pipMask(v){
  const el=this.pip,m=v>=1?'none':`radial-gradient(ellipse ${25+v*85}% ${20+v*95}% at 58% 58%,#000 35%,transparent 95%)`;
  el.style.webkitMaskImage=m;el.style.maskImage=m;el.style.opacity=String(.15+.85*Math.min(1,v*1.6));if(v>=1)el.style.opacity='';
 }
 conceal(){
  this.cancel();this.gpu.clear();this.scene='arrival';this.concealed=true;this.hideDone=null;
  // Folded by clip, not visibility: the composer must stay focusable while the page is still unrolling.
  this.panel.classList.add('revealing');this.panel.style.clipPath='inset(100% 0 0 100%)';this.roll.hidden=true;
  this.pip.style.opacity='0';
 }
 summon(after='arrival',{short=false}={}){this.cancel();this.hideDone=null;this.concealed=false;this.after=after;this.play('arrival',{short});}
 get hiding(){return !!this.hideDone;}
 hide(done){
  if(this.concealed||this.reduced||document.hidden){done();return;}
  this.hideDone=done;
  this.play('hide');
 }
 // Bars follow only the measured input level from the native capture; a level of 0 draws flat bars.
 meter(){this.props.querySelectorAll('#ew-meter rect').forEach((b,i)=>{const v=this.level*(.45+.55*Math.abs(Math.sin(i*1.7)));b.setAttribute('height',String(2+14*v));b.setAttribute('y',String(-1-14*v));});}
 setLevel(v){this.level=clamp(v);if(this.scene==='listening')this.meter();}
 hideNow(){if(this.hideDone){this.cancel();this.finish('hide');}}
}
function bez(A,u){const v=1-u,m=(i)=>v*v*v*A.P0[i]+3*v*v*u*A.P1[i]+3*v*u*u*A.P2[i]+u*u*u*A.P3[i];return [m(0),m(1)];}
window.PipEmberweave=Emberweave;window.PipEmberweaveEffects=EFFECTS;
