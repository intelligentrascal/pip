import './projects.js';
import './living-ink.js';
import './character.js';
import './tracker.js';
import './feedback.js';
import './dictation.js';
import './task-browser.js';
import './emberweave.js';
import './providers.js';
const $ = id => document.getElementById(id);
let state={composer:'',works:[],memory:[],proposals:[]};
let selectedProject=null;
let selected=null, view='work', providers=[], allowFor=null, initialized=false;
let intentRevealed=false, nativeShortcut='e', workViews=[];
const browserDraft={goal:'',pages:''};
const trackerView=document.createElement('pip-tracker'),feedbackView=document.createElement('pip-feedback');
const trackerQueries=new Map();
const browserView=document.createElement('pip-task-browser'),browserStates=new Map();
browserView.addEventListener('browser-command',event=>browserView.waiting(emit('browser',event.detail)));
browserView.addEventListener('browser-back',()=>show('work'));
// A summon within this long of the previous one plays the short (~300 ms) arrival.
const QUICK_REPEAT_MS=10000;let lastSummonAt=-Infinity;
let feedbackComposerRequest=null, lastMotionKey='', lastWorkLeaf=null;
const emit=(kind,payload={})=>{
 const message={version:1,id:crypto.randomUUID(),kind,payload};
 if(window.webkit?.messageHandlers?.pip) window.webkit.messageHandlers.pip.postMessage(message);
 else if(window.pipTestBridge) window.pipTestBridge(message);
 return message.id;
};
const node=(tag,content,cls)=>{const e=document.createElement(tag);if(content!==undefined)e.textContent=content;if(cls)e.className=cls;return e;};
const button=(label,action,cls='')=>{const b=node('button',label,cls);b.type='button';b.onclick=action;return b;};
const notice=message=>{$('status').textContent=message;};
const reveal=()=>{intentRevealed=true;document.body.classList.add('expanded');$('conversation').inert=false;};
const magic=new window.PipEmberweave({surface:$('surface'),panel:document.querySelector('.panel'),pip:$('apparition'),canvas:$('ew-fx'),props:$('ew-props'),roll:$('ew-roll'),conversation:$('conversation'),composer:$('composer'),talk:$('talk'),trackerButton:$('tracker')});
let lastScene='arrival';
const dictation=new window.PipDictation({emit,reveal,changed:()=>{resize();listen();},level:value=>magic.setLevel(value)});
// Listening is Pip's ear-led pose only while native capture is really running; nothing animates for an unavailable Talk.
let listeningNow=false;
function listen(){
 const on=dictation.state==='capturing'||dictation.state==='stopping';
 if(on===listeningNow)return;listeningNow=on;
 if(on){$('character').showState('listening');magic.play('listening',{background:document.hidden});}
 else{$('character').showState(lastScene==='thinking'?'arrival':lastScene,{verified:lastScene==='done',background:true});magic.settle(lastScene);}
}
const providerName=()=>providers.find(p=>p.active)?.name??'Claude';
const show=(v)=>{view=v;reveal();render();};
function refreshTracker(detail){const id=emit('tracker',detail);trackerQueries.set(id,detail);}
trackerView.addEventListener('tracker-query',event=>refreshTracker(event.detail));
trackerView.addEventListener('tracker-feedback',()=>show('feedback'));
feedbackView.addEventListener('feedback-save',event=>emit('feedback.save',event.detail));
feedbackView.addEventListener('feedback-cancel',()=>show('work'));
function statusOf(work){return workViews.find(r=>r.id===work.id)?.status??(work.status==='Done'?'Waiting on you':work.status==='Could not finish'?'Blocked':work.status);}
function updateMotion({character=true,background=document.hidden,short=false}={}){
 const selectedWork=state.works.find(w=>w.id===selected)||state.works.at(-1);
 const p=state.proposals.find(p=>p.status==='proposed');
 const held=state.proposals.some(p=>p.status==='unknown'||p.status==='intent-recorded');
 const status=p?'Waiting on you':held?'Held/Unknown':selectedWork?statusOf(selectedWork):'Ready';
 $('workStatus').textContent=status;
 if(selectedWork&&['Queued','Working'].includes(status)&&lastWorkLeaf!==selectedWork.id){lastWorkLeaf=selectedWork.id;$('ink').newLeaf();}
 const scene=({'Queued':'thinking','Working':'working','Waiting on you':'approval','Held/Unknown':'unknown','Blocked':'blocked','Done':'done'})[status]??'arrival';
 const key=`${selectedWork?.id??''}:${status}:${selectedWork?.result?.text??''}`;
 if(key!==lastMotionKey){lastMotionKey=key;lastScene=scene;$('ink').showState(scene==='thinking'?'working':scene,{verified:status==='Done',background,short});if(character){$('character').showState(listeningNow?'listening':scene,{verified:status==='Done',background});if(scene==='arrival'){if(!magic.running)magic.settle('arrival');}else magic.play(listeningNow?'listening':scene,{background});}}
}
function resize(){queueMicrotask(()=>{const panel=document.querySelector('.panel'),conversation=$('conversation');const content=intentRevealed?Math.min(310,($('dictation').hidden?0:$('dictation').scrollHeight)+$('result').scrollHeight+$('recent').scrollHeight+24):0;emit('resize',{height:panel.scrollHeight-conversation.clientHeight+content+150});});}
function proposal(a){emit('propose',{action:a});view='work';}
function renderProposal(p,root) {
 root.append(node('div','Needs your approval','label'),node('h2',({ 'project.save':'Save this project context?','project.forget':'Forget this project?','work.continue':'Continue this saved work?','memory.save':'Save this fact?', 'memory.edit':'Update this fact?', 'memory.forget':'Forget this fact?', 'clipboard.copy':'Copy this draft?', 'note.save':'Save this note?', 'url.open':'Open this link?', 'app.open':'Open this app?' })[p.action.type]||'Review this action'));
 const a=p.action; let description=a.text||a.url||a.bundleId||'';
 if(a.type==='project.save')description=`Project: ${a.title}\nSummary: ${a.summary}\nSource: ${a.provenance}\nReferences: ${a.pins.map(p=>`${p.title} · ${p.reference} · checked ${p.checkedAt}`).join('\n')||'None'}\nLinked work: ${a.workIds.map(id=>state.works.find(w=>w.id===id)?.request??id).join('\n')||'None'}\n\nOnly choosing this context for a request shares it with ${providerName()}. References grant no access.`;
 if(a.type==='project.forget')description='Remove '+(state.projects??[]).find(p=>p.id===a.projectId)?.title+' from future context. Local approval history remains; this cannot withdraw information already shared.';
 if(a.type==='work.continue'){const w=state.works.find(w=>w.id===a.workId),p=state.projects?.find(p=>p.id===w?.projectContext?.id);description=`Request: ${w?.request}\nRecorded inference episodes: ${a.attempts}\nProject: ${p?`${p.title} · revision ${p.revision}\n${p.summary}\nSource: ${p.provenance}\nReferences: ${p.pins.map(pin=>`${pin.title} · ${pin.reference} · checked ${pin.checkedAt}`).join('\n')||'None'}`:'No project context'}\n\nRecheck needed sources. Continue does not reuse a previous action approval.`;}

 if(a.memoryId){const m=state.memory.find(m=>m.id===a.memoryId);description=(a.type==='memory.edit'?`Current: ${m?.text}\nNew: ${a.text}`:m?.text)||'';}
 const target=a.type.startsWith('project.')||a.type==='work.continue'?'Project continuity · this Mac':a.type.startsWith('memory.')?'Personal memory · this Mac':a.type==='note.save'?'Choose a destination after approval. Existing files will not be overwritten.':a.type==='clipboard.copy'?'Mac clipboard':a.type==='url.open'?'Default web browser':'Installed application';
 root.append(node('div',description+'\n\n'+target,'details'));
 const actions=node('div',undefined,'actions');
 actions.append(button('Edit',()=>{emit('cancel',{id:p.id}); if(a.type.startsWith('project.'))show('projects');else if(a.type==='memory.save'||a.type==='memory.edit')editMemory(a);else { $('composer').value=a.text||a.url||a.bundleId||'';emit('saveComposer',{text:$('composer').value});$('composer').focus();}}),button('Cancel',()=>emit('cancel',{id:p.id}),'secondary'),button(({ 'project.save':'Save project context','project.forget':'Forget project','work.continue':'Continue work','memory.save':'Save fact','memory.edit':'Update fact','memory.forget':'Forget fact','clipboard.copy':'Copy draft','url.open':'Open link','note.save':'Choose destination','app.open':'Open app'})[a.type],event=>{
  event?.preventDefault?.(); emit('approve',{id:p.id,revision:p.revision,digest:p.digest});
  for(const b of actions.querySelectorAll('button'))b.disabled=true;
 },'primary'));
 root.append(actions,node('p','Nothing changes until you choose the named action.','label'));
}
function editMemory(action) {
 view='remember';render();$('fact').value=action.text||'';
 $('saveFact').onclick=()=>proposal(action.type==='memory.edit'?{type:'memory.edit',memoryId:action.memoryId,revision:action.revision,text:$('fact').value}:{type:'memory.save',text:$('fact').value,source:'Explicit Remember form'});
 $('fact').focus();
}
function render() {
 const root=$('result');
 if(view==='browser-scope'&&root.querySelector('#browserGoal')){updateMotion();resize();return;}
 const preserving=(view==='tracker'&&root.contains(trackerView))||(view==='feedback'&&root.contains(feedbackView))||(view==='projects'&&!!root.querySelector('#project-title'))||(view==='browser'&&root.contains(browserView));
 if(!preserving)root.replaceChildren();
 const p=[...state.proposals].reverse().find(p=>p.status==='proposed');
 if(view==='tracker'){
  if(!preserving)root.append(button('Back',()=>show('work')),trackerView);
  trackerView.request();
 } else if(view==='browser'){
  if(!preserving)root.append(browserView);
 } else if(view==='browser-scope'){
  root.append(node('h2','Start a browser task'),node('p',`Review the exact public HTTPS pages Pip may read for this task. Their relevant text may go to ${providerName()}. Your personal browser stays separate.`));
  const goalLabel=node('label','What should Pip do?');goalLabel.htmlFor='browserGoal';const goal=node('textarea');goal.id='browserGoal';goal.maxLength=12000;goal.value=browserDraft.goal;goal.oninput=()=>{browserDraft.goal=goal.value;};
  const pagesLabel=node('label','Reviewed page addresses, one per line');pagesLabel.htmlFor='browserPages';const pages=node('textarea');pages.id='browserPages';pages.maxLength=32000;pages.value=browserDraft.pages;pages.oninput=()=>{browserDraft.pages=pages.value;};
  root.append(goalLabel,goal,pagesLabel,pages,node('p','Public reading only: no form entry, uploads, downloads or submissions by Pip. New pages need a new reviewed task. Taking over opens the private task browser; Stop discards its session.','label'));
  root.append(button('Start reviewed browser task',()=>{
   if(!goal.value.trim()||!pages.value.trim()){notice('Enter the task and its reviewed pages.');return;}
   selected=emit('submit',{request:goal.value,browserPages:pages.value.split(/\n/).map(s=>s.trim()).filter(Boolean)});
   browserView.open(selected);show('browser');
  }),button('Cancel',()=>show('work'),'secondary'));
 } else if(view==='feedback'){
  if(!preserving)root.append(feedbackView);
 } else if(view==='projects'){
  if(!preserving)window.pipRenderProjects(root,{state,node,button,proposal,back:()=>show('settings'),openWork:id=>{selected=id;show('work');},useProject:p=>{selectedProject={id:p.id,revision:p.revision};show('work');notice('Next request will use approved project: '+p.title+'. References are historical, not access grants.');$('composer').focus();}});
 } else if(view==='settings'){
  root.append(node('h2','Pip settings'),node('p',providers.find(p=>p.active&&p.allowed&&p.connected)?`${providerName()} is allowed and connected.`:`${providerName()} is not ready. Review its Allow screen below.`,'notice'),node('p','The shortcut always uses Command+Shift, preserving other apps’ Command+E. Occupied shortcuts keep the menu-bar fallback.'),node('p','Calendar and Reminders: not connected. No native data has been read or changed.'),node('p','Startup: manual. No login item installed. Pip stores your work on this Mac. When you use an allowed provider, Pip sends your request and approved context to that provider.'));
  const shortcutLabel=node('label','Summon shortcut: Command+Shift+');shortcutLabel.htmlFor='shortcutKey';
  const keySelect=node('select');keySelect.id='shortcutKey';for(const key of 'abcdefghijklmnopqrstuvwxyz'){const option=node('option',key.toUpperCase());option.value=key;keySelect.append(option);}keySelect.value=nativeShortcut;
  window.pipRenderProviders(root,{providers,node,button,emit,showAllow:id=>{allowFor=id;show('provider-allow');}});
  root.append(shortcutLabel,keySelect,button('Set shortcut',()=>emit('configureShortcut',{letter:keySelect.value})));
  const actions=node('div',undefined,'actions');actions.append(button('Projects',()=>show('projects'),'secondary'),button('Remembered facts',()=>show('memory'),'secondary'),button('Calendar & Reminders',()=>show('permission'),'secondary'),button('Back',()=>show('work')));root.append(actions);
 } else if(view==='provider-allow'){
  const provider=providers.find(p=>p.id===allowFor);
  if(provider)window.pipRenderAllow(root,{provider,node,button,emit,back:()=>show('settings')});else show('settings');
 } else if(view==='permission') {
  root.append(node('div','Calendar & Reminders','label'),node('h2','Your draft can stay here'),node('p','Native Calendar and Reminders are not connected in this build. I haven’t read or changed any events or reminders.','notice'),node('p','You can ask Pip to draft a plan once a provider is connected. A draft is not a scheduled event or alarm.'));
  root.append(button('Keep draft',()=>show('work'),'secondary'));
 } else if(view==='remember') {
  root.append(node('h2','What would you like me to remember?'));
  const label=node('label','Exact fact');label.htmlFor='fact';const field=node('textarea');field.id='fact';field.maxLength=30000;
  const save=button('Review save',()=>proposal({type:'memory.save',text:field.value,source:'Explicit Remember form'}),'primary');save.id='saveFact';
  root.append(label,field,save,button('Remembered facts',()=>show('memory')));
 } else if(view==='memory') {
  root.append(node('h2','Things you asked me to keep'));
  const memory=state.memory.filter(m=>m.active);
  if(!memory.length)root.append(node('p','No remembered facts yet. Pip saves personal facts only after your approval.'));
  for(const m of memory){
   const row=node('div',undefined,'memory');row.append(node('p',m.text),node('small',`Source: ${m.source}\nRevision ${m.revision} · ${new Date(m.updatedAt).toLocaleString()}`));
   const actions=node('div',undefined,'actions');actions.append(button('Edit',()=>editMemory({type:'memory.edit',memoryId:m.id,revision:m.revision,text:m.text})),button('Forget this fact',()=>proposal({type:'memory.forget',memoryId:m.id,revision:m.revision}),'secondary'));row.append(actions);root.append(row);
  }
  root.append(button('Remember a fact',()=>show('remember'),'secondary'),button('Back',()=>show('work')));
 } else if(p)renderProposal(p,root);
 else {
  const w=state.works.find(w=>w.id===selected)||state.works.at(-1);
  if(w){
   if(browserStates.has(w.id))root.append(button('Watch browser',()=>{browserView.open(w.id);show('browser');}));
   root.append(node('div',statusOf(w),'label'),node('p',w.request,'label'));
   if(['Queued','Working'].includes(w.status)) {root.append(node('h2',w.status==='Queued'?'Queued for Pip':'Looking into it…'),button('Stop work',()=>emit('stop'),'secondary'));}
   if(w.error)root.append(node('p',w.error,'notice'));
   if(w.status==='Interrupted')root.append(button('Stop work',()=>emit('stop'),'secondary'));
   if(w.usage)root.append(node('small',`${w.usage.attempts} inference episodes · ${w.usage.activeMilliseconds} ms recorded active time. Interrupted time may be incomplete.`));
   if(w.status==='Interrupted'&&!w.needsScreenContext)root.append(button('Review continuation',()=>proposal({type:'work.continue',workId:w.id,attempts:w.usage?.attempts??0,projectRevision:w.projectContext?(state.projects??[]).find(p=>p.id===w.projectContext.id&&p.active)?.revision??0:0})));
   if(w.needsScreenContext)root.append(node('p','A fresh reviewed window is required before continuation. Saved references cannot restore it.'));
   if(w.result){
    const r=w.result; root.append(node('h2',r.title));
    if(r.kind==='draft'){
     const draft=node('textarea',r.text,'draft');draft.setAttribute('aria-label','Editable writing draft');draft.maxLength=30000;draft.oninput=()=>{r.text=draft.value;emit('saveDraft',{id:w.id,text:draft.value});};root.append(draft);
     const actions=node('div',undefined,'actions');actions.append(button('Make it shorter',()=>{$('composer').value='Make this draft shorter:\n'+draft.value;$('composer').focus();emit('saveComposer',{text:$('composer').value});}),button('Save note',()=>proposal({type:'note.save',text:draft.value}),'secondary'),button('Copy draft',()=>proposal({type:'clipboard.copy',text:draft.value}),'primary'));root.append(actions,node('p','Draft ready. I haven’t sent it.','label'));
    } else root.append(node('p',r.text));
    const sources=node('div',undefined,'sources');
    for(const s of r.sources) {
     const b=button(s.title+' · '+new URL(s.url).hostname,()=>proposal({type:'url.open',url:s.url}));b.title=`${s.url}\nRetrieved ${s.fetchedAt}`;sources.append(b);
    }root.append(sources,node('p',r.model,'label'));if(r.backup)root.append(node('p',`Answered by ${r.backup.provider}, your backup, because ${r.backup.replaced} could not answer: ${r.backup.reason}.`,'notice'));
   }
  }
  for(const held of state.proposals.filter(p=>p.status==='unknown'))root.append(node('p',held.receipt+'\n'+JSON.stringify(held.action),'notice'));
 }
 if(root.childNodes.length>0||intentRevealed)reveal();
 updateMotion();
 const recent=$('recent');recent.replaceChildren();
 for(const w of state.works.slice(-8).reverse())recent.append(button(statusOf(w)+' · '+w.request,()=>{selected=w.id;show('work');}));
 if(p&&view!=='work')notice('A saved action needs your approval.');
 // Layout notifications must also run while the panel is hidden; WebKit suspends animation frames there.
 resize();
}
window.pipReceive=message=>{
 if(!message||typeof message!=='object')return;
 if(message.kind==='browserState'){browserStates.set(message.payload.workId,message.payload);browserView.update(message.payload);if(view==='work')render();return;}
 if(message.kind==='browserResult'){browserView.accept(message);resize();return;}
 if(message.kind==='error')browserView.accept(message);
 if(message.kind==='state') {
  const next=message.payload.state;
  const receipt=initialized?[...next.proposals].reverse().find(p=>['succeeded','failed-known'].includes(p.status)&&!state.proposals.some(old=>old.id===p.id&&old.status===p.status&&old.receipt===p.receipt)):null;
  state=next;providers=message.payload.providers?.providers??[];window.pipProviderName=providerName();workViews=message.payload.workViews??[];
  if(!initialized){$('composer').value=state.composer;initialized=true;}
  render();if(receipt&&!state.proposals.some(p=>p.status==='proposed'))notice(receipt.receipt);
 } else if(message.kind==='trackerResult'){
  const query=trackerQueries.get(message.id);trackerQueries.delete(message.id);if(query)trackerView.setRecords(query.view,message.payload,query.revision);
 } else if(message.kind==='feedbackSaved'){
  if(feedbackView.pending?.id===message.payload.id)feedbackView.acknowledge(message.payload.id);
  if(feedbackComposerRequest?.id===message.payload.id){if($('composer').value===feedbackComposerRequest.request){$('composer').value='';emit('saveComposer',{text:''});}feedbackComposerRequest=null;}
  notice(`Saved ${message.payload.id} to About Pip · Backlog. No implementation started.`);
  trackerView.openRecord('about',message.payload.id);show('tracker');
  const inkBox=$('ink').getBoundingClientRect(),target=$('tracker').getBoundingClientRect();
  $('ink').showState('tracker',{filingTarget:{x:target.x+target.width/2-inkBox.x-56,y:target.y+target.height/2-inkBox.y-56}});
  $('character').showState('tracker');magic.play('tracker',{background:document.hidden});
 } else if(message.kind==='nativeStatus'){
  $('shortcut').textContent=message.payload.hotkey;nativeShortcut=message.payload.letter??'e';
  document.body.classList.toggle('reduced-motion',!!message.payload.reducedMotion);
  for(const element of [$('ink'),$('character')])element.style.setProperty('--pip-motion-duration',message.payload.reducedMotion?'0':'1');
  magic.forcedReduced=!!message.payload.reducedMotion;if(message.payload.reducedMotion){$('ink').finishMotion();$('character').cut();magic.settle(lastScene);}
 } else if(message.kind==='summon'){
  const now=performance.now(),short=now-lastSummonAt<QUICK_REPEAT_MS;lastSummonAt=now;
  $('composer').focus();$('character').conceal();$('ink').conceal();$('character').showState('arrival',{short});lastMotionKey='';updateMotion({character:false,background:false,short});magic.summon(lastScene,{short});
 } else if(message.kind==='dictation'){dictation.receive(message.payload);}
 else if(message.kind==='dictationCancelled'){if(message.payload.session===dictation.session)dictation.cancel({notify:false});}
 else if(message.kind==='popupHidden'){dictation.cancel({notify:false});$('character').conceal();$('ink').conceal();magic.conceal();}
 else if(message.kind==='settings')show('settings');
 else if(['error','disconnected'].includes(message.kind)){notice(message.payload.message);if(feedbackView.pending)feedbackView.failed(message.payload.message);if(message.kind==='disconnected'){view='work';$('result').replaceChildren(node('p',message.payload.message,'notice'));}}
};
$('ask').onsubmit=e=>{e.preventDefault();if(dictation.pending){notice('Stop and review dictation, or cancel it, before Ask. Nothing was sent.');return;}const rawRequest=$('composer').value,request=rawRequest.trim();if(!request)return;
 if(feedbackComposerRequest){notice('A local feedback save is awaiting its receipt. Your input is retained.');return;}
 const feedback=request.match(/^(?:log|save) (?:a )?(bug|feature request|issue)(?: about pip)?:\s*([\s\S]+)$/i);
 if(feedback){const id=crypto.randomUUID();feedbackComposerRequest={id,request:$('composer').value};emit('feedback.save',{id,originalWords:rawRequest,title:feedback[2].slice(0,200),kind:({'bug':'bug','feature request':'feature','issue':'issue'})[feedback[1].toLowerCase()],priority:'normal'});return;}
 const current=state.works.find(w=>w.id===selected)||state.works.at(-1);
 const contextWorkId=view==='work'&&current?.result&&!state.proposals.some(p=>p.status==='proposed')?current.id:undefined;
 selected=emit('submit',{request:rawRequest,...(contextWorkId?{contextWorkId}:{}),...(selectedProject?{project:selectedProject}:{})});if(selectedProject)notice('Approved project context applies only to this request.');selectedProject=null;$('composer').value='';view='work';};
$('composer').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('ask').requestSubmit();}};
$('composer').oninput=()=>{if($('composer').value)reveal();emit('saveComposer',{text:$('composer').value});resize();};
$('settings').onclick=()=>show(view==='settings'?'work':'settings');// Close and Escape play the page rolling back into Pip's palm, then hide; a second request hides at once.
const requestHide=()=>{if(magic.hiding)magic.hideNow();else magic.hide(()=>emit('hide'));};
$('hide').onclick=requestHide;
$('browser').onclick=()=>show('browser-scope');
$('tracker').onclick=()=>show('tracker');$('feedback').onclick=()=>show('feedback');
document.addEventListener('visibilitychange',()=>{if(document.hidden)dictation.cancel();});
window.addEventListener('blur',()=>dictation.cancel());
for(const b of document.querySelectorAll('[data-prompt]'))b.onclick=()=>{$('composer').value=b.dataset.prompt;reveal();$('composer').focus();emit('saveComposer',{text:$('composer').value});};
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>show(b.dataset.view);
window.pipEscape=()=>{if(dictation.pending||!$('dictation').hidden){dictation.cancel();return true;}if(view!=='work'){show('work');return true;}return false;};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();if(!window.pipEscape())requestHide();}});
// In the native app the page stays folded until the host's summon message unrolls it from Pip's palm.
if(window.webkit?.messageHandlers?.pip)magic.conceal();
emit('snapshot');$('composer').focus();
