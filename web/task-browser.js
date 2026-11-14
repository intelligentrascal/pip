const browserNode=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
export class PipTaskBrowser extends HTMLElement {
 constructor(){super();this.attachShadow({mode:'open'});this.pending=new Set();this.workId=null;this.current=null;}
 connectedCallback(){if(!this.built)this.build();this.poll();}
 disconnectedCallback(){clearTimeout(this.timer);this.image?.removeAttribute('src');this.pending.clear();}
 build(){
  this.built=true;const css=browserNode('link');css.rel='stylesheet';css.href=new URL('./task-browser.css',import.meta.url).href;
  this.heading=browserNode('h2','Task browser');this.summary=browserNode('p');this.summary.setAttribute('role','status');
  const header=browserNode('div');header.className='heading';header.append(this.heading,this.summary);
  this.site=browserNode('p');this.site.className='site';this.origin=browserNode('span');this.origin.className='origin';this.pageTitle=browserNode('span');this.pageTitle.className='title';this.site.append(this.origin,this.pageTitle);this.activity=browserNode('p');this.activity.className='activity';
  this.image=browserNode('img');this.image.alt='Live view of this task’s current browser page, not saved';this.image.hidden=true;
  this.private=browserNode('p','You drive in the separate task browser window. This view is private: Pip cannot inspect, capture or enter anything. Return control only when ready to share the reviewed page again.');this.private.hidden=true;
  this.actions=browserNode('div');this.actions.className='actions';
  const action=(name,op)=>{const b=browserNode('button',name);b.type='button';b.onclick=()=>this.request(op);this.actions.append(b);return b;};
  this.take=action('Take over','takeover');this.handback=action('Return control','return');this.refresh=action('Refresh view','watch');this.stop=action('Stop browser','close');
  const back=browserNode('button','Back');back.type='button';back.onclick=()=>this.dispatchEvent(new CustomEvent('browser-back',{bubbles:true,composed:true}));this.actions.append(back);
  this.error=browserNode('p');this.error.setAttribute('role','alert');
  this.shadowRoot.append(css,header,this.site,this.activity,this.image,this.actions,this.private,this.error);
 }
 open(workId){if(!this.built)this.build();this.pending.clear();this.workId=workId;this.current=null;this.image.removeAttribute('src');this.image.hidden=true;this.error.textContent='';this.request('state');}
 request(op){if(!this.workId||this.pending.size&&['watch','state'].includes(op))return;if(!['watch','state'].includes(op))clearTimeout(this.timer);this.dispatchEvent(new CustomEvent('browser-command',{detail:{workId:this.workId,op},bubbles:true,composed:true}));}
 waiting(id){this.pending.add(id);}
 accept(message){
  if(!this.pending.delete(message.id))return;
  if(message.kind==='error'){this.error.textContent=message.payload.message;this.image.hidden=true;this.image.removeAttribute('src');clearTimeout(this.timer);return;}
  const {state,frame}=message.payload;
  if(state?.workId!==this.workId||this.current&&state.revision<this.current.revision)return;
  this.error.textContent='';this.update(state);
  if(frame&&state.driver==='pip'&&/^[A-Za-z0-9+/=]+$/.test(frame)&&frame.length<4000000){this.image.src='data:image/jpeg;base64,'+frame;this.image.hidden=false;}
  this.poll();
 }
 update(state){
  if(!this.built||state.workId!==this.workId||this.current&&state.revision<this.current.revision)return;
  if(this.current&&state.url!==this.current.url){this.image.hidden=true;this.image.removeAttribute('src');}
  this.current=state;this.heading.textContent='Task browser';
  this.summary.textContent=({'pip':'Pip is driving · Watch only','pausing':'Pausing Pip…','captain':'You are driving · Private','stopped':'Browser stopped'})[state.driver];
  this.origin.textContent=new URL(state.url).origin;this.pageTitle.textContent=state.title;this.site.title=`${state.title} · ${state.url}`;
  this.activity.textContent=state.activity;this.activity.title=state.activity;
  if(state.frameAt)this.image.title='Live browser view · not saved';
  this.take.hidden=state.driver!=='pip';this.handback.hidden=state.driver!=='captain';this.refresh.hidden=state.driver!=='pip';this.stop.disabled=state.driver==='stopped';this.private.hidden=state.driver!=='captain';
  if(state.driver!=='pip'){this.image.hidden=true;this.image.removeAttribute('src');}
  this.poll();
 }
 poll(){clearTimeout(this.timer);if(this.isConnected&&this.current?.driver==='pip')this.timer=setTimeout(()=>this.request('watch'),1200);}
}
customElements.define('pip-task-browser',PipTaskBrowser);
