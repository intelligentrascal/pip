// ELF-8 reviewable dictation: transient text, explicit start, separate Ask.
// Native events are session-bound. No browser microphone or speech service exists.
window.PipDictation = class {
 constructor({emit, reveal, changed, level}) {
  this.level=level;this.emit=emit;this.reveal=reveal;this.changed=changed;this.session=null;this.state='idle';
  this.root=document.getElementById('dictation');this.text=document.getElementById('transcript');
  this.message=document.getElementById('dictation-status');this.talk=document.getElementById('talk');
  this.stop=document.getElementById('dictation-stop');this.use=document.getElementById('dictation-use');
  this.cancelButton=document.getElementById('dictation-cancel');
  this.talk.onclick=()=>this.start();this.stop.onclick=()=>{if(this.state==='capturing'){this.state='stopping';this.stop.disabled=true;this.emit('dictation.stop',{session:this.session});}};
  this.cancelButton.onclick=()=>{this.cancel();document.getElementById('composer').focus();};this.use.onclick=()=>this.accept();
 }
 get pending(){return this.session!==null;}
 start(){
  if(this.pending)return;
  this.reveal();this.session=crypto.randomUUID();this.state='starting';this.text.value='';
  this.root.hidden=false;this.message.textContent='Checking existing access for on-device dictation. Nothing is sent.';
  this.draw();
  if(!window.webkit?.messageHandlers?.pip&&!window.pipTestBridge){
   this.receive({session:this.session,state:'unavailable',message:'On-device dictation needs the native Pip app. Keep typing; no microphone was started.'});return;
  }
  const id=this.session;
  this.timer=setTimeout(()=>{
   if(this.session!==id||this.state!=='starting')return;
   this.emit('dictation.cancel',{session:id});
   this.receive({session:id,state:'unavailable',message:'The native dictation connection did not respond. Pip requested a stop but could not confirm capture status. Keep typing.'});
  },5000);
  this.emit('dictation.start',{session:this.session});this.changed();
 }
 receive(payload){
  // Measured input level from native capture; it carries no text and changes no state.
  if(payload?.state==='level'){if(this.session&&payload.session===this.session&&this.state==='capturing'&&Number.isFinite(payload.level))this.level?.(payload.level);return;}
  if(!this.session||payload?.session!==this.session||!['capturing','review','unavailable'].includes(payload.state))return;
  if(this.state==='stopping'&&payload.state==='capturing')return;
  // A late partial must never replace an editable review.
  if(this.state==='review')return;
  clearTimeout(this.timer);
  this.state=payload.state;
  this.message.textContent=String(payload.message??'').slice(0,600);
  if(typeof payload.text==='string')this.text.value=payload.text.slice(0,12000);
  if(this.state!=='capturing')this.level?.(0);
  if(this.state==='unavailable'){this.session=null;this.text.value='';}
  this.draw();this.changed();
 }
 draw(){
  const review=this.state==='review',capturing=this.state==='capturing';
  this.talk.disabled=this.pending;
  this.text.hidden=!review&&!capturing;this.text.readOnly=!review;
  document.getElementById('transcript-label').hidden=this.text.hidden;
  this.stop.hidden=!capturing&&this.state!=='stopping';this.stop.disabled=!capturing;
  this.use.hidden=!review;this.cancelButton.textContent=this.pending?'Cancel dictation':'Close dictation';
 }
 accept(){
  if(this.state!=='review')return;
  const composer=document.getElementById('composer'),text=this.text.value.trim();
  if(!text){this.message.textContent='There is no transcript to add. Keep typing or cancel.';return;}
  const combined=composer.value+(composer.value?'\n':'')+text;
  if(combined.length>composer.maxLength){this.message.textContent='The combined draft is too long. Shorten the transcript before adding it.';return;}
  this.cancel();composer.value=combined;composer.dispatchEvent(new Event('input',{bubbles:true}));composer.focus();
  document.getElementById('status').textContent='Transcript added to the composer. Review it, then choose Ask. Nothing was sent.';
 }
 cancel({notify=true}={}){
  const wasOpen=!this.root.hidden;
  if(notify&&this.session)this.emit('dictation.cancel',{session:this.session});
  clearTimeout(this.timer);
  this.session=null;this.state='idle';this.text.value='';this.message.textContent='';this.root.hidden=true;this.talk.disabled=false;
  if(wasOpen)document.getElementById('status').textContent='Dictation closed. Your typed draft is unchanged. Nothing was sent.';
  this.changed();
 }
};
