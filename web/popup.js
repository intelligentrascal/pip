import './living-ink.js';
import './character.js';
// ELF-8 + ELF-10: web-only shell. Native placement, shortcut registration and
// permissions remain host-owned; no capability starts merely by constructing it.
export class PipPopup extends HTMLElement {
 constructor(){
  super();this.attachShadow({mode:'open'});this.expanded=false;this.workId=null;
  this.shadowRoot.innerHTML=`<link rel="stylesheet" href="${new URL('./popup.css',import.meta.url)}">
   <div class="presence" aria-hidden="true"><pip-character></pip-character><pip-living-ink></pip-living-ink></div>
   <main aria-label="Pip personal assistant"><header><h1>Pip</h1><span id="status" role="status" aria-live="polite">Ready</span><button id="tracker">Tracker</button><button id="close" aria-label="Hide Pip popup">Close</button></header>
   <section id="conversation" aria-label="Activity and results" inert><p id="boundary">The screen preview is not connected here. Nothing is captured or shared.</p><div id="result"></div><button id="stop" hidden>Stop work</button></section>
   <form><label for="composer">What would you like a hand with?</label><div class="input"><textarea id="composer" rows="1" maxlength="12000" placeholder="What would you like a hand with?"></textarea><button id="talk" type="button" aria-label="Start dictation">Talk</button><button id="ask" type="submit" aria-label="Ask Pip">↑</button></div></form>
   <footer><button id="settings">Settings</button><span>⌘⇧E to summon</span><button id="feedback">Feedback</button></footer></main>`;
  this.composer=this.shadowRoot.querySelector('#composer');
  this.ink=this.shadowRoot.querySelector('pip-living-ink');this.character=this.shadowRoot.querySelector('pip-character');
  const emit=(kind,detail={})=>this.dispatchEvent(new CustomEvent(kind,{detail,bubbles:true,composed:true}));
  this.composer.oninput=()=>{if(this.composer.value)this.expand();emit('pip-composer',{text:this.composer.value});};
  this.shadowRoot.querySelector('form').onsubmit=event=>{event.preventDefault();if(this.composer.value.trim())emit('pip-request',{request:this.composer.value});};
  this.composer.onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();this.shadowRoot.querySelector('form').requestSubmit();}};
  this.shadowRoot.querySelector('#close').onclick=()=>this.hide();
  for(const name of ['tracker','feedback','settings'])this.shadowRoot.querySelector('#'+name).onclick=()=>emit('pip-'+name);
  this.shadowRoot.querySelector('#stop').onclick=()=>emit('pip-stop',{workId:this.workId});
  this.shadowRoot.querySelector('#talk').onclick=()=>{
   this.expand();this.shadowRoot.querySelector('#boundary').textContent='On-device dictation is not connected here. Typing remains available.';
   emit('pip-dictation-request');
  };
  this.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();this.hide();}};
 }
 connectedCallback(){this.summon();}
 expand(){this.expanded=true;this.setAttribute('expanded','');this.shadowRoot.querySelector('#conversation').inert=false;}
 summon(){this.hidden=false;this.composer.focus();this.character.showState(this.lastScene||'arrival',{verified:this.lastVerified===true});}
 hide(){this.hidden=true;this.character.conceal();this.dispatchEvent(new CustomEvent('pip-hide',{bubbles:true,composed:true}));}
 setDraft(text){if(typeof text!=='string'||text.length>12000)throw Error('Invalid composer draft');this.composer.value=text;if(text)this.expand();}
 showWork({id,status,result='',verified=false}){
  const states={'Working':'working','Waiting on you':'approval','Blocked':'blocked','Held/Unknown':'unknown','Done':'done'};
  if(!Object.hasOwn(states,status))throw Error('Unsupported popup work state');
  if(typeof id!=='string'||!id||id.length>100||typeof result!=='string'||result.length>30000)throw Error('Invalid popup work payload');
  const state=states[status];
  if(status==='Done'&&verified!==true)throw Error('Unverified work cannot show completion');
  this.workId=id;this.shadowRoot.querySelector('#status').textContent=status;
  this.shadowRoot.querySelector('#result').textContent=result;
  this.shadowRoot.querySelector('#stop').hidden=status!=='Working';
  this.lastScene=state;this.lastVerified=verified;this.character.showState(state,{verified,background:this.hidden});
  this.ink.showState(state,{verified,background:this.hidden});
  // Background state never reopens or focuses the popup.
  if(!this.hidden)this.expand();
 }
}
customElements.define('pip-popup',PipPopup);
