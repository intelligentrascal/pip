// Explicit local intake only. The embedding host persists and acknowledges saves.
// Conversation suggestions may seed a draft; they never dispatch this form.
export class PipFeedback extends HTMLElement {
 constructor(){super();this.attachShadow({mode:'open'});this.pending=null;}
 connectedCallback(){if(!this.shadowRoot.childNodes.length)this.render();}
 render(){
  this.shadowRoot.innerHTML=`<link rel="stylesheet" href="${new URL('./feedback.css',import.meta.url)}"><h2>Feedback about Pip</h2><p>Save a feature, bug or issue locally. Filing starts no implementation and attaches no diagnostics.</p><form>
  <label>Kind <select name="kind"><option value="feature">Feature request</option><option value="bug">Bug report</option><option value="issue">Issue</option></select></label>
  <label>Priority <select name="priority"><option value="normal">Normal</option><option value="low">Low</option><option value="high">High</option></select></label>
  <label>Title<input name="title" required maxlength="200"></label>
  <label>Your original words<textarea name="originalWords" required maxlength="12000"></textarea></label>
  <label>How to reproduce, if relevant<textarea name="reproduction" maxlength="12000"></textarea></label>
  <button type="submit">Save to backlog</button><button type="button" id="cancel">Cancel</button></form><p role="status" aria-live="polite"></p>`;
  this.shadowRoot.querySelector('form').onsubmit=event=>{
   event.preventDefault();if(this.pending&&!this.retryPending)return;
   const fields=Object.fromEntries(new FormData(event.target));
   this.pending??={id:crypto.randomUUID(),...fields};this.retryPending=false;
   for(const field of this.shadowRoot.querySelectorAll('input,textarea,select'))field.disabled=true;
   this.shadowRoot.querySelector('[type=submit]').disabled=true;
   this.dispatchEvent(new CustomEvent('feedback-save',{detail:{...this.pending},bubbles:true,composed:true}));
  };
  this.shadowRoot.querySelector('#cancel').onclick=()=>{
   if(this.pending){this.status('A local save is pending. Wait for its receipt before closing.');return;}
   this.dispatchEvent(new CustomEvent('feedback-cancel',{bubbles:true,composed:true}));
  };
 }
 status(message){this.shadowRoot.querySelector('[role=status]').textContent=message;}
 acknowledge(id){
  if(this.pending?.id!==id)throw Error('Feedback receipt does not match');
  this.status(`Saved ${id} to About Pip · Backlog. No implementation started.`);
  this.shadowRoot.querySelector('form').reset();this.pending=null;this.retryPending=false;
  for(const field of this.shadowRoot.querySelectorAll('input,textarea,select'))field.disabled=false;
  this.shadowRoot.querySelector('[type=submit]').textContent='Save to backlog';this.shadowRoot.querySelector('[type=submit]').disabled=false;
 }
 failed(message){this.status(message);this.retryPending=true;const button=this.shadowRoot.querySelector('[type=submit]');button.disabled=false;button.textContent='Check saved feedback';}
 seed(words){this.shadowRoot.querySelector('[name=originalWords]').value=words;}
}
customElements.define('pip-feedback',PipFeedback);
