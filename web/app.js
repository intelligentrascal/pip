import './dom.js';
import './markdown.js';
import './parts.js';
import './projects.js';
import './character.js';
import './magic.js';
import './tracker.js';
import './feedback.js';
import './dictation.js';
import './task-browser.js';
import './providers.js';
// Pip's one window, drawn in Lantern: a header, the conversation (or Chats, or a settings view), a paused-step panel, the message box and a bottom row.
// The host owns every fact; this page draws what it is sent and asks for changes. Nothing here runs a step, and no model text is ever run.
const { node, button, icon, iconButton, seconds, clock, hostOf } = window.pipDom;
const $ = id => document.getElementById(id);
let state = { composer: '', works: [], memory: [], proposals: [] }, replies = {}, liveMsg = null, workViews = [], providers = [];
let view = 'chat', chatId = null, selected = null, selectedProject = null, allowFor = null, initialized = false;
let magicLevel = 'balanced', permissions = [], permissionsAskedAt = '', nativeShortcut = 'e', hotkey = '⌘⇧E';
let flags = { visibleHeight: 0, most: 0, width: 0 }, explicitNew = false, followNewest = true, listening = false;
const browserDraft = { goal: '', pages: '' };
const trackerView = document.createElement('pip-tracker'), feedbackView = document.createElement('pip-feedback');
const trackerQueries = new Map();
const browserView = document.createElement('pip-task-browser'), browserStates = new Map();
browserView.addEventListener('browser-command', event => browserView.waiting(emit('browser', event.detail)));
browserView.addEventListener('browser-back', () => show('chat'));
// A call within this long of the previous one is the short arrival; a chat used within RESUME_MS reopens.
const QUICK_REPEAT_MS = 10000, RESUME_MS = 600000;
let lastSummonAt = -Infinity, feedbackComposerRequest = null, lastCharacter = '';
const stepsByWork = new Map(), forcedChat = new Map(), seenResults = new Set(), opened = new Set();
const emit = (kind, payload = {}) => {
 const message = { version: 1, id: crypto.randomUUID(), kind, payload };
 if (window.webkit?.messageHandlers?.pip) window.webkit.messageHandlers.pip.postMessage(message);
 else if (window.pipTestBridge) window.pipTestBridge(message);
 return message.id;
};
// A notice holds the status line for eight seconds; renders in between leave it alone.
let noticeTimer = 0, noticeOn = false;
const notice = message => { noticeOn = true; $('status').textContent = message; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { noticeOn = false; footer(); }, 8000); };
const providerName = () => providers.find(p => p.active)?.name ?? 'your model';
const show = v => { view = v; render(); };
const reveal = () => {};
const when = value => { const t = Date.parse(value); if (!t) return ''; const ago = Date.now() - t; if (ago < 60000) return 'now'; if (ago < 3600000) return Math.round(ago / 60000) + ' min'; const d = new Date(t); return ago < 86400000 ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { weekday: 'short' }); };
const stamp = w => Date.parse(w.updatedAt) || Date.parse(w.createdAt) || 0;
function statusOf(work) { return workViews.find(r => r.id === work.id)?.status ?? (work.status === 'Done' ? 'Waiting on you' : work.status === 'Could not finish' ? 'Blocked' : work.status); }
function refreshTracker(detail) { const id = emit('tracker', detail); trackerQueries.set(id, detail); }
trackerView.addEventListener('tracker-query', event => refreshTracker(event.detail));
trackerView.addEventListener('tracker-feedback', () => show('feedback'));
feedbackView.addEventListener('feedback-save', event => emit('feedback.save', event.detail));
feedbackView.addEventListener('feedback-cancel', () => show('chat'));

/* Chats: a chat is the works that share a thread. The host keeps one conversation; the page only groups what it shows. */
const chatKey = w => forcedChat.get(w.id) ?? w.threadId ?? w.id;
function chats() {
 const groups = new Map();
 for (const w of state.works) { if (w.status === 'Backlog') continue; const key = chatKey(w); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(w); }
 return [...groups].map(([id, works]) => ({ id, works, last: works.at(-1), title: (works[0].title || works[0].request).slice(0, 80) })).sort((a, b) => stamp(b.last) - stamp(a.last));
}
const currentChat = () => chatId ? chats().find(c => c.id === chatId) : undefined;
const pausedProposal = () => state.proposals.find(p => p.status === 'proposed' && p.action.type === 'step.pause');
const otherProposal = () => [...state.proposals].reverse().find(p => p.status === 'proposed' && p.action.type !== 'step.pause');
const workingWork = () => state.works.find(w => w.status === 'Working');
// The work this chat is doing right now: the one a typed message can steer. A message waiting its turn cannot be steered.
const steerTarget = () => currentChat()?.works.find(w => w.status === 'Working');
const busy = () => state.works.some(w => w.status === 'Queued' || w.status === 'Working');
function chatDot(chat) {
 if (state.proposals.some(p => p.status === 'proposed' && chat.works.some(w => w.id === p.workId))) return 'var(--wa)';
 if (chat.works.some(w => w.status === 'Working' || w.status === 'Queued')) return 'var(--ac)';
 if (['Could not finish', 'Interrupted'].includes(chat.last.status)) return 'var(--da)';
 return '';
}
function applySummonView() {
 const last = chats()[0], recent = last && (Date.now() - stamp(last.last) < RESUME_MS || chatDot(last) !== '' && chatDot(last) !== 'var(--da)');
 chatId = recent ? last.id : null; explicitNew = false; view = 'chat';
}
function scene() {
 if (listening) return 'talk';
 if (view === 'chats') return 'threads';
 if (pausedProposal()) return 'paused';
 const chat = currentChat();
 if (chat && chat.works.some(w => w.status === 'Working' || w.status === 'Queued')) return 'working';
 if (chat && ['Could not finish', 'Interrupted'].includes(chat.last.status)) return 'problem';
 return 'ready';
}

function proposal(a) { emit('propose', { action: a }); view = 'chat'; }
function renderProposal(p,root) {
 root.append(node('div','Needs your approval','label'),node('h2',({ 'project.save':'Save this project context?','project.forget':'Forget this project?','work.continue':'Continue this saved work?','memory.save':'Save this fact?', 'memory.edit':'Update this fact?', 'memory.forget':'Forget this fact?', 'clipboard.copy':'Copy this draft?', 'note.save':'Save this note?', 'url.open':'Open this link?', 'app.open':'Open this app?', 'step.pause':'Pip paused before a step you did not ask for' })[p.action.type]||'Review this action'));
 const a=p.action; let description=a.text||a.url||a.bundleId||'';
 if(a.type==='project.save')description=`Project: ${a.title}\nSummary: ${a.summary}\nSource: ${a.provenance}\nReferences: ${a.pins.map(p=>`${p.title} · ${p.reference} · checked ${p.checkedAt}`).join('\n')||'None'}\nLinked work: ${a.workIds.map(id=>state.works.find(w=>w.id===id)?.request??id).join('\n')||'None'}\n\nOnly choosing this context for a request shares it with ${providerName()}. References grant no access.`;
 if(a.type==='project.forget')description='Remove '+(state.projects??[]).find(p=>p.id===a.projectId)?.title+' from future context. Local approval history remains; this cannot withdraw information already shared.';
 if(a.type==='work.continue'){const w=state.works.find(w=>w.id===a.workId),p=state.projects?.find(p=>p.id===w?.projectContext?.id);description=`Request: ${w?.request}\nRecorded inference episodes: ${a.attempts}\nProject: ${p?`${p.title} · revision ${p.revision}\n${p.summary}\nSource: ${p.provenance}\nReferences: ${p.pins.map(pin=>`${pin.title} · ${pin.reference} · checked ${pin.checkedAt}`).join('\n')||'None'}`:'No project context'}\n\nRecheck needed sources. Continue does not reuse a previous action approval.`;}

 if(a.type==='step.pause')description=a.summary+'\n'+a.details;
 if(a.memoryId){const m=state.memory.find(m=>m.id===a.memoryId);description=(a.type==='memory.edit'?`Current: ${m?.text}\nNew: ${a.text}`:m?.text)||'';}
 const target=a.type.startsWith('project.')||a.type==='work.continue'?'Project continuity · this Mac':a.type.startsWith('memory.')?'Personal memory · this Mac':a.type==='note.save'?'Choose a destination after approval. Existing files will not be overwritten.':a.type==='clipboard.copy'?'Mac clipboard':a.type==='url.open'?'Default web browser':a.type==='step.pause'?'Allow runs it once. Cancel skips it.':'Installed application';
 root.append(node('div',description+'\n\n'+target,'details'));
 const actions=node('div',undefined,'actions');
 actions.append(button('Edit',()=>{emit('cancel',{id:p.id}); if(a.type.startsWith('project.'))show('projects');else if(a.type==='memory.save'||a.type==='memory.edit')editMemory(a);else { $('composer').value=a.text||a.url||a.bundleId||'';emit('saveComposer',{text:$('composer').value});$('composer').focus();}}),button('Cancel',()=>emit('cancel',{id:p.id}),'secondary'),button(({ 'project.save':'Save project context','project.forget':'Forget project','work.continue':'Continue work','memory.save':'Save fact','memory.edit':'Update fact','memory.forget':'Forget fact','clipboard.copy':'Copy draft','url.open':'Open link','note.save':'Choose destination','app.open':'Open app','step.pause':'Allow'})[a.type],event=>{
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

function renderSecondary(root, preserving) {
 if(view==='tracker'){
  if(!preserving)root.append(button('Back',()=>show('chat')),trackerView);
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
   chatId=selected;browserView.open(selected);show('browser');
  }),button('Cancel',()=>show('chat'),'secondary'));
 } else if(view==='feedback'){
  if(!preserving)root.append(feedbackView);
 } else if(view==='projects'){
  if(!preserving)window.pipRenderProjects(root,{state,node,button,proposal,back:()=>show('settings'),openWork:id=>{selected=id;chatId=chats().find(c=>c.works.some(w=>w.id===id))?.id??null;show('chat');},useProject:p=>{selectedProject={id:p.id,revision:p.revision};show('chat');notice('Next request will use approved project: '+p.title+'. References are historical, not access grants.');$('composer').focus();}});
 } else if(view==='settings'){
  root.append(node('h2','Pip settings'),node('p',providers.find(p=>p.active&&p.allowed&&p.connected)?`${providerName()} is allowed and connected.`:`${providerName()} is not ready. Review its Allow screen below.`,'notice'),node('p','The shortcut always uses Command+Shift, preserving other apps’ Command+E. Occupied shortcuts keep the menu-bar fallback.'),node('p','Calendar and Reminders: not connected. No native data has been read or changed.'),node('p','Startup: manual. No login item installed. Pip stores your work on this Mac. When you use an allowed provider, Pip sends your request and approved context to that provider.'));
  const shortcutLabel=node('label','Summon shortcut: Command+Shift+');shortcutLabel.htmlFor='shortcutKey';
  const keySelect=node('select');keySelect.id='shortcutKey';for(const key of 'abcdefghijklmnopqrstuvwxyz'){const option=node('option',key.toUpperCase());option.value=key;keySelect.append(option);}keySelect.value=nativeShortcut;
  window.pipRenderProviders(root,{providers,node,button,emit,showAllow:id=>{allowFor=id;show('provider-allow');}});
  root.append(shortcutLabel,keySelect,button('Set shortcut',()=>emit('configureShortcut',{letter:keySelect.value})));
  const magicLabel=node('label','Magic');magicLabel.htmlFor='magic';
  const magicSelect=node('select');magicSelect.id='magic';for(const [value,name] of [['calm','Calm'],['balanced','Balanced'],['rich','Rich']]){const option=node('option',name);option.value=value;magicSelect.append(option);}magicSelect.value=magicLevel;
  magicSelect.onchange=()=>setMagic(magicSelect.value,true);
  root.append(magicLabel,magicSelect,node('p','Calm: Pip moves, nothing else is drawn. Balanced: light and embers around Pip, never over your text. Rich: all of it, with the desktop dimmed as he arrives. Reduce Motion turns every effect off.','notice'));
  const actions=node('div',undefined,'actions');actions.append(button('Projects',()=>show('projects'),'secondary'),button('Remembered facts',()=>show('memory'),'secondary'),button('Calendar & Reminders',()=>show('permission'),'secondary'),button('Mac access',()=>{show('mac-access');emit('permissions.status');},'secondary'),button('Back',()=>show('chat')));root.append(actions);
 } else if(view==='provider-allow'){
  const provider=providers.find(p=>p.id===allowFor);
  if(provider)window.pipRenderAllow(root,{provider,node,button,emit,back:()=>show('settings')});else show('settings');
 } else if(view==='mac-access') {
  const asked=permissionsAskedAt?`Pip asked macOS on ${new Date(permissionsAskedAt).toLocaleString()}.`:'Pip has not asked macOS yet.';
  root.append(node('div','Mac access','label'),node('h2','What Pip may do on your Mac'),node('p',asked+' One setup asks macOS for all six permissions, in order, and never asks again. You can grant or revoke each one in System Settings.','notice'));
  if(!permissions.length)root.append(node('p','Pip is checking this Mac’s permissions.','label'));
  for(const permission of permissions){
   const stateWord=permission.state==='granted'?'Allowed':permission.state==='notGranted'?'Not allowed yet':'Not known';
   const row=node('div',undefined,'memory');row.append(node('p',`${permission.label}: ${stateWord}`),node('small',permission.why));root.append(row);
  }
  root.append(button('Set up Mac access',()=>emit('permissions.setup')),button('Back',()=>show('settings'),'secondary'));
 } else if(view==='permission') {
  root.append(node('div','Calendar & Reminders','label'),node('h2','Your draft can stay here'),node('p','Native Calendar and Reminders are not connected in this build. I haven’t read or changed any events or reminders.','notice'),node('p','You can ask Pip to draft a plan once a provider is connected. A draft is not a scheduled event or alarm.'));
  root.append(button('Keep draft',()=>show('chat'),'secondary'));
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
  root.append(button('Remember a fact',()=>show('remember'),'secondary'),button('Back',()=>show('chat')));
 }
}

/* Window height: it follows the content from its smallest to the cap, and the host panel is told the larger of the old and new
   heights while the change plays, so nothing is ever clipped. Microtasks, not animation frames: WebKit pauses frames while hidden. */
let fitQueued = false, fitTarget = 0, settleTimer = 0, settling = false;
// The most height: the 70% default, or the height the person chose by dragging the top edge (320 pt up to what fits under the screen's top).
const LIFT = 24, TOP_ROOM = 12, MOST_MIN = 320, WIDTH_MIN = 420, WIDTH_MAX = 760;
const screenHeight = () => flags.visibleHeight || innerHeight;
const mostMax = () => Math.max(MOST_MIN, screenHeight() - LIFT - TOP_ROOM);
const capHeight = () => flags.most > 0 ? Math.floor(Math.min(Math.max(flags.most, MOST_MIN), mostMax())) : Math.floor(0.7 * screenHeight());
const reduced = () => document.body.classList.contains('reduced-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
const character = $('character'), magic = new window.PipMagic({ canvas: $('fx'), character, win: $('win'), emit, reduced });
const setMagic = (level, save) => { if (!window.PipMagicLevels.includes(level)) return; magicLevel = level; magic.setLevel(level); if (save) emit('configureMagic', { level }); };
const fit = () => { if (fitQueued) return; fitQueued = true; queueMicrotask(() => { fitQueued = false; doFit(); }); };
function doFit() {
 const win = $('win');
 document.documentElement.style.setProperty('--cap', capHeight() + 'px');
 const from = Math.round(win.getBoundingClientRect().height);
 win.style.height = 'auto';
 const to = Math.round(win.getBoundingClientRect().height);
 win.style.height = from + 'px'; void win.offsetHeight; win.style.height = to + 'px';
 if (to === fitTarget && from === to) return;
 fitTarget = to;
 // The width is the host's to keep: it is sent only while the person drags the left edge, so a first measurement taken before the web view has a size cannot narrow the window.
 const send = h => emit('resize', { windowHeight: h, ...(flags.most > 0 ? { mostHeight: flags.most } : {}) });
 settling = true; send(Math.max(from, to)); clearTimeout(settleTimer);
 settleTimer = setTimeout(() => { settling = false; send(to); const cv = $('cv'); if (followNewest && !cv.hidden) cv.scrollTop = cv.scrollHeight; syncLatest(); }, reduced() ? 0 : 400);
}
new MutationObserver(fit).observe($('win'), { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class', 'open'] });
addEventListener('resize', fit);

/* Resizing: the left edge sets the width (420 to 760 pt), the top edge the most height. The window's right side and bottom stay where they are,
   so it grows toward the pointer. The host places the panel and keeps both choices on this Mac. A pointer's screen position, not the page's, is
   what is measured, because the page itself moves while the left edge is dragged. */
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
function dragEdge(edge, e) {
 if (e.button !== 0) return;
 e.preventDefault();
 const win = $('win'), grip = e.currentTarget, rect = win.getBoundingClientRect();
 const start = { x: e.screenX, y: e.screenY, width: flags.width || Math.round(rect.width), height: Math.round(rect.height) };
 grip.setPointerCapture(e.pointerId); document.body.classList.add('dragging');
 const move = ev => {
  if (edge === 'left') {
   flags.width = clamp(Math.round(start.width + start.x - ev.screenX), WIDTH_MIN, WIDTH_MAX);
   emit('resize', { windowWidth: flags.width, windowHeight: Math.round(win.getBoundingClientRect().height), ...(flags.most > 0 ? { mostHeight: flags.most } : {}) });
  } else {
   // The window follows the pointer even when the conversation is shorter than the height being chosen; letting go settles it back to its content.
   const height = clamp(Math.round(start.height + start.y - ev.screenY), MOST_MIN, mostMax());
   flags.most = height; document.documentElement.style.setProperty('--minh', height + 'px'); doFit();
  }
 };
 const end = () => {
  grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', end); grip.removeEventListener('pointercancel', end);
  document.body.classList.remove('dragging'); document.documentElement.style.removeProperty('--minh'); fit();
  emit('configureWindow', { width: flags.width || start.width, most: flags.most > 0 ? flags.most : 0 });
 };
 grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
}
$('grip-l').addEventListener('pointerdown', e => dragEdge('left', e));
$('grip-t').addEventListener('pointerdown', e => dragEdge('top', e));

/* The live rows of the working turn: one 22 px row per step, only the current one spins. Rows are kept and updated, never rebuilt, so the spinner keeps turning. */
class LiveBox {
 constructor(draw) { this.draw = draw; this.el = node('div', undefined, 'acs'); this.rows = new Map(); this.body = node('div', undefined, 'lv-body'); this.shown = []; this.drewParts = false; this.box = node('div', undefined, 'lv-box'); this.box.append(this.el, this.body); }
 row(id) {
  let row = this.rows.get(id);
  if (!row) { row = { el: node('div', undefined, 'ac'), mark: node('span'), text: node('span'), time: node('time') }; row.el.append(row.mark, row.text, row.time); this.rows.set(id, row); this.el.append(row.el); }
  return row;
 }
 set(row, label, status, ms) {
  row.text.textContent = label; row.time.textContent = ms === undefined ? '' : seconds(ms);
  row.el.className = 'ac ' + ({ running: 'lv', done: 'ok', failed: 'bad' }[status] ?? '');
  const want = status === 'running' ? 'sp' : status;
  // A step that finishes sends four embers from the lantern (above Calm).
  if (row.status !== want) { if (want === 'done' && row.status === 'sp') magic.step(); row.status = want; row.mark.replaceWith(row.mark = want === 'sp' ? node('i', undefined, 'sp') : icon(want === 'failed' ? 'x' : 'ok')); }
 }
 // The reply as far as it has arrived: words, and each part the moment its block is complete. Blocks only ever grow, so what is drawn stays.
 blocks(live) { return live?.blocks ?? (live?.words ? [{ type: 'text', text: live.words }] : []); }
 update(live, now, paused = false) {
  const steps = live?.steps ?? [];
  const running = steps.some(s => s.state === 'running');
  for (const step of steps) this.set(this.row(step.id), step.label, step.state, step.state === 'running' ? now - step.startedAt : step.milliseconds);
  if (live?.running && !running && !live.words && !paused) this.set(this.row('thinking'), steps.length ? 'Thinking…' : 'Thinking', 'running', now - (steps.at(-1) ? steps.at(-1).startedAt + (steps.at(-1).milliseconds ?? 0) : live.startedAt));
  else if (this.rows.has('thinking')) { this.rows.get('thinking').el.remove(); this.rows.delete('thinking'); }
  const blocks = this.blocks(live);
  this.body.hidden = !blocks.length;
  blocks.forEach((block, i) => {
   const had = this.shown[i], key = block.type === 'text' ? block.text : JSON.stringify(block.parts);
   if (had && had.type === block.type) {
    if (block.type === 'parts' ? had.key === key : key === had.key) return;
    // New words fade in over 160 ms; a text that was replaced rather than extended is drawn again whole.
    if (block.type === 'text' && key.startsWith(had.key)) { had.el.append(node('span', key.slice(had.key.length), 'w')); had.key = key; return; }
   }
   for (const old of this.shown.splice(i)) old.els.forEach(el => el.remove());
   const els = [];
   if (block.type === 'text') { const el = node('div', undefined, 'live-words'); el.append(node('span', key, 'w')); els.push(el); this.shown.push({ type: 'text', key, el, els }); }
   else { for (const part of block.parts) { const el = this.draw(part); if (!el.classList.contains('nt')) el.classList.add('ar'); els.push(el); } this.shown.push({ type: 'parts', key, els }); this.drewParts = true; queueMicrotask(() => { for (const el of els) if (el.isConnected) magic.part(el); }); }
   this.body.append(...els);
  });
  for (const old of this.shown.splice(blocks.length)) old.els.forEach(el => el.remove());
 }
}
let liveBox = null, liveFor = null;
const drewLive = new Set();
// A choice inside a part that is still arriving answers the work being done, the same as typing it.
const liveCtx = { choose: label => { const target = steerTarget(); if (target) steer(label, target); else send(label); }, openUrl: url => openUrl(url), proposal: a => { emit('propose', { action: a }); view = 'chat'; } };
const endLive = id => { if (id && liveBox?.drewParts) drewLive.add(id); liveBox = null; liveFor = null; };

/* One turn: your message, then the work (live rows or a folded line), then the reply, a problem or both. */
function openUrl(url) { emit('propose', { action: { type: 'url.open', url } }); }
const askAgain = w => send(w.request, { retry: true });
function replyFor(w, fresh) {
 const r = w.result, root = node('div', undefined, 'tn' + (fresh ? ' ar' : '')), arrived = [], drawnLive = drewLive.has(w.id);
 const blocks = (replies[w.id] ?? [{ type: 'text', text: r.text }]).map(b => ({ ...b }));
 // A choice stays answered after the redraw: the next message in this chat is the one that picked it.
 const turns = chats().find(c => c.works.some(x => x.id === w.id))?.works ?? [], next = turns[turns.findIndex(x => x.id === w.id) + 1];
 const ctx = { choose: label => send(label), picked: next?.request, openUrl, proposal: a => { emit('propose', { action: a }); view = 'chat'; } };
 if (r.kind === 'draft') {
  const el = node('section', undefined, 'pl pt-draft'); el.append(node('div', undefined, 'ph'));
  el.firstChild.append(node('b', 'Draft'), node('span', 'Not sent'));
  if (r.title) el.append(node('b', r.title, 'pt'));
  const draft = node('textarea', r.text, 'draft'); draft.setAttribute('aria-label', 'Editable writing draft'); draft.maxLength = 30000;
  draft.oninput = () => { r.text = draft.value; emit('saveDraft', { id: w.id, text: draft.value }); };
  const actions = node('div', undefined, 'rw');
  actions.append(button('Make it shorter', () => { $('composer').value = 'Make this draft shorter:\n' + draft.value; $('composer').focus(); emit('saveComposer', { text: $('composer').value }); autosize(); }, 'bt'),
   button('Save note', () => ctx.proposal({ type: 'note.save', text: draft.value }), 'bt'), button('Copy draft', () => ctx.proposal({ type: 'clipboard.copy', text: draft.value }), 'bt pm'));
  el.append(draft, actions); root.append(el);
 } else {
  // The title line becomes the heading when the answer begins with it, so it is never said twice.
  const head = blocks[0]?.type === 'text' ? blocks[0].text.split('\n') : [];
  const first = head[0]?.replace(/^[#>*\-\s]+/, '').trim();
  if (first && first === r.title && head.length > 1 && !head[1].trim()) { const h = node('div', undefined, 'md'); h.append(node('h3', r.title)); root.append(h); blocks[0].text = head.slice(2).join('\n'); }
  for (const block of blocks) {
   if (block.type === 'text') { if (block.text.trim()) root.append(window.pipMarkdown(block.text, openUrl)); continue; }
   for (const part of block.parts) { const el = window.pipParts.render(part, ctx); if (fresh && !drawnLive && !el.classList.contains('nt')) { el.classList.add('ar'); arrived.push(el); } root.append(el); }
  }
 }
 const row = node('div', undefined, 'sr0');
 (r.sources ?? []).forEach((s, i) => { const chip = button(undefined, () => openUrl(s.url), 'so'); chip.append(node('b', String(i + 1)), document.createTextNode(hostOf(s.url))); chip.title = `${s.url}\nRetrieved ${s.fetchedAt}`; row.append(chip); });
 row.append(iconButton('copy', 'Copy answer', () => ctx.proposal({ type: 'clipboard.copy', text: r.text }), 'push'), iconButton('redo', 'Try again', () => askAgain(w)));
 root.append(row);
 if (r.backup) root.append(node('p', `Answered by ${r.backup.provider}, your backup, because ${r.backup.replaced} could not answer: ${r.backup.reason}.`, 'nc'));
 // Each new part's border lights and embers fly to it once it is on the page.
 if (arrived.length) queueMicrotask(() => { for (const el of arrived) if (el.isConnected) magic.part(el); });
 return root;
}
function problemFor(w) {
 const box = node('div', undefined, 'pb'), error = w.error || (w.status === 'Stopped' ? 'You stopped Pip.' : 'Pip could not finish this.');
 box.append(node('b', error), node('p', w.status === 'Stopped' ? 'Nothing further was done. Steps already finished are not undone.' : 'Your message is kept. Steps already finished are not undone.'));
 if (w.needsScreenContext) box.append(node('p', 'A fresh reviewed window is required before continuation. Saved references cannot restore it.'));
 else if (w.status === 'Interrupted') box.append(button('Review continuation', () => proposal({ type: 'work.continue', workId: w.id, attempts: w.usage?.attempts ?? 0, projectRevision: w.projectContext ? (state.projects ?? []).find(p => p.id === w.projectContext.id && p.active)?.revision ?? 0 : 0 }), 'bt pm'));
 else if (/provider|sign|connect|allow|key|plan/i.test(error)) box.append(button('Open settings', () => show('settings'), 'bt'));
 else box.append(button('Try again', () => askAgain(w), 'bt'));
 // Interrupted work stays open until the person continues it or stops it.
 if (w.status === 'Interrupted') box.append(button('Stop work', () => emit('stop'), 'bt'));
 return box;
}
function foldFor(w) {
 const steps = stepsByWork.get(w.id) ?? w.steps, ms = w.usage?.activeMilliseconds;
 if (!steps?.length && !ms) return null;
 const wrap = node('div', undefined, 'acs'), head = button(undefined, () => { const open = head.getAttribute('aria-expanded') !== 'true'; head.setAttribute('aria-expanded', String(open)); list.hidden = !open; if (open) opened.add(w.id); else opened.delete(w.id); }, 'ac');
 const label = `Worked ${ms ? seconds(ms) : 'a moment'}${steps?.length ? `, ${steps.length} ${steps.length === 1 ? 'step' : 'steps'}` : ''}`;
 head.append(icon('chev'), node('span', label));
 head.setAttribute('aria-expanded', String(opened.has(w.id)));
 const list = node('div', undefined, 'acs'); list.hidden = !opened.has(w.id);
 for (const s of steps ?? []) { const row = node('div', undefined, 'ac ' + (s.state === 'failed' ? 'bad' : 'ok')); row.append(icon(s.state === 'failed' ? 'x' : 'ok'), node('span', s.label), node('time', s.milliseconds === undefined ? '' : seconds(s.milliseconds))); list.append(row); }
 wrap.append(head, list); return wrap;
}
// What the person told Pip while he worked on this request: each steer is one of their messages, after the steps it redirected.
const steersFor = w => (w.steers ?? []).map(s => { const el = node('div', s.text, 'me'); el.dataset.steer = ''; return el; });
function turnFor(w) {
 const t = node('div', undefined, 'tn');
 t.append(node('div', w.request, 'me'));
 const status = w.status;
 if (status === 'Queued') { const a = node('div', undefined, 'acs'), row = node('div', undefined, 'ac lv'); row.append(node('i', undefined, 'sp'), node('span', 'Waiting its turn')); a.append(row); t.append(a); }
 else if (status === 'Working') { liveBox ??= new LiveBox(part => window.pipParts.render(part, liveCtx)); liveFor = w.id; liveBox.update(liveMsg, Date.now(), !!pausedProposal()); t.append(liveBox.box, ...steersFor(w)); }
 else {
  const fold = foldFor(w); if (fold) t.append(fold);
  t.append(...steersFor(w));
  if (browserStates.has(w.id)) t.append(button('Watch browser', () => { browserView.open(w.id); show('browser'); }, 'bt'));
  if (w.result) { const fresh = initialized && !seenResults.has(w.id); t.append(replyFor(w, fresh)); }
  if (w.error || ['Could not finish', 'Interrupted', 'Stopped'].includes(status)) t.append(problemFor(w));
  for (const p of state.proposals) if (p.workId === w.id && p.action.type === 'step.pause' && ['succeeded', 'cancelled', 'failed-known', 'unknown'].includes(p.status)) {
   const row = node('div', undefined, 'ac rc ' + (p.status === 'succeeded' ? 'ok' : '')); row.append(icon(p.status === 'succeeded' ? 'ok' : 'x'), node('span', p.receipt || 'Decided.')); t.append(row);
  }
 }
 return t;
}
function renderConversation() {
 const cv = $('cv'), chat = currentChat();
 const pinned = cv.scrollHeight - cv.scrollTop - cv.clientHeight < 48, top = cv.scrollTop;
 if (liveFor && (!workingWork() || workingWork().id !== liveFor)) endLive(liveFor);
 cv.replaceChildren(...(chat ? chat.works.map(turnFor) : []));
 for (const held of state.proposals.filter(p => p.status === 'unknown')) cv.append(window.pipParts.render({ kind: 'note', tone: 'warn', text: held.receipt + ' ' + JSON.stringify(held.action) }));
 for (const w of chat?.works ?? []) if (w.result && !seenResults.has(w.id)) seenResults.add(w.id);
 cv.scrollTop = followNewest || pinned ? cv.scrollHeight : top;
}
// The view follows the newest words unless you scrolled up; then a Latest button waits above the message box.
// While the window is changing height the scroll position is not yours, so only a settled scroll counts.
function syncLatest() { const cv = $('cv'); if (settling) return; const away = cv.scrollHeight - cv.scrollTop - cv.clientHeight > 60; followNewest = !away; $('latest').hidden = !away || cv.hidden; }
$('cv').addEventListener('scroll', syncLatest);
new ResizeObserver(() => { const cv = $('cv'); if (followNewest && !cv.hidden) cv.scrollTop = cv.scrollHeight; }).observe($('cv'));
$('latest').onclick = () => { followNewest = true; const cv = $('cv'); cv.scrollTop = cv.scrollHeight; $('latest').hidden = true; $('composer').focus(); };

/* The paused step: a panel above the message box. The safe button is first; the accent button names the act. */
const VERBS = { send: ['Send this?', 'Do not send', 'Send it', 'sends it', 'send'], pay: ['Make this payment?', 'Do not pay', 'Pay', 'pays', 'pay'], publish: ['Publish this?', 'Do not publish', 'Publish', 'publishes it', 'publish'], delete: ['Delete this?', 'Keep it', 'Delete', 'deletes it', 'delete'] };
// The question names what is held, in the words of the step's own details: "Send this to ana@example.com?". Without a name it stays the plain question.
const AIMS = ['to', 'recipient', 'payee', 'destination', 'where', 'target', 'title', 'path', 'name', 'item'];
function heldQuestion(kind, details) {
 const [plain] = VERBS[kind] ?? VERBS.send, verb = plain.replace(/ this.*$/, '');
 const fields = new Map(String(details).split('\n').map(line => line.match(/^([a-z_]+):\s*(.+)$/i)).filter(Boolean).map(m => [m[1].toLowerCase(), m[2].trim()]));
 const aim = AIMS.map(name => fields.get(name)).find(value => value && value.length <= 60);
 return aim ? (kind === 'delete' ? `Delete ${aim}?` : kind === 'pay' ? `Pay ${aim}?` : `${verb} this to ${aim}?`) : plain;
}
let dockFor = '';
function renderDock() {
 const p = pausedProposal(), dock = $('dock');
 dock.hidden = !p;
 if (!p) { dockFor = ''; magic.pause(false); return; }
 if (dockFor === p.id) return;
 dockFor = p.id;
 const [, no, yes, , verb] = VERBS[p.action.kind] ?? VERBS.send;
 const ph = node('div', undefined, 'ph'); ph.append(node('b', 'Paused'), node('span', 'You did not ask for this'));
 const rw = node('div', undefined, 'rw');
 const yesButton = button(yes, () => runPaused(p), 'bt pm'); yesButton.id = 'allow';
 rw.append(button(no, () => { emit('cancel', { id: p.id }); }, 'bt'), yesButton);
 const ask = node('div', undefined, 'dq'); ask.append(node('h4', heldQuestion(p.action.kind, p.action.details)), node('p', `Pip wants to ${verb} this. Nothing has happened yet.`));
 // What the step would do stays in view as plain lines, so the person reads it before choosing.
 if (p.action.details) ask.append(node('pre', p.action.details));
 dock.replaceChildren(ph, ask, rw);
 // Arrival: the panel's border lights in copper once embers reach it (magic.pause), never at Calm.
 dock.classList.remove('sw');
 magic.pause(true, dock);
}
// One press answers once: the shortcut can reach this from the message box and from the page, and a second press on the same step does nothing.
const approving = new Set();
function runPaused(p) { if (approving.has(p.id)) return; approving.add(p.id); for (const b of $('dock').querySelectorAll('button')) b.disabled = true; magic.yes(); emit('approve', { id: p.id, revision: p.revision, digest: p.digest }); }

/* Chats: the list replaces the conversation, not the window. */
let chatQuery = '', chatIndex = 0;
function renderChats() {
 const tl = $('tl'), all = chats().filter(c => !chatQuery || (c.title + ' ' + (c.last.result?.title ?? '')).toLowerCase().includes(chatQuery.toLowerCase()));
 const search = node('label', undefined, 'sf'), input = node('input'); input.type = 'search'; input.id = 'chat-search'; input.placeholder = 'Search chats'; input.value = chatQuery; input.setAttribute('aria-label', 'Search chats');
 input.oninput = () => { chatQuery = input.value; chatIndex = 0; renderChats(); $('chat-search').focus(); };
 search.append(icon('find'), input);
 const fresh = button(undefined, startNew, 'tr nw'); fresh.append(icon('plus'), node('span', 'New chat')); fresh.style.gridColumn = '1 / -1';
 tl.replaceChildren(search, fresh);
 if (!all.length) tl.append(node('p', chatQuery ? 'No chat matches.' : 'No chats yet.', 'none'));
 all.forEach((c, i) => {
  const row = button(undefined, () => { chatId = c.id; explicitNew = false; followNewest = true; show('chat'); $('composer').focus(); }, 'tr' + (i === chatIndex ? ' sel' : ''));
  const dot = node('i', undefined, 'td'), color = chatDot(c); if (color) dot.style.background = color;
  const last = c.last.status === 'Working' || c.last.status === 'Queued' ? 'Working…' : c.last.result ? (c.last.result.text.replace(/\s+/g, ' ').slice(0, 120)) : (c.last.error || c.last.status);
  row.append(dot, node('b', c.title), node('time', when(c.last.updatedAt)), node('span', last)); row.dataset.chat = c.id; tl.append(row);
 });
}
function startNew() { chatId = null; explicitNew = true; followNewest = true; show('chat'); $('composer').focus(); }

/* Which parts of the window show, in each scene. */
function header() {
 const s = scene(), chat = currentChat(), live = liveMsg;
 document.body.dataset.scene = s;
 const title = view === 'chats' ? 'Chats' : view === 'chat' ? (chat ? chat.title : 'Pip') : ({ settings: 'Settings', feedback: 'Feedback', tracker: 'Tracker', memory: 'Remembered facts', remember: 'Remember', projects: 'Projects', browser: 'Browser task', 'browser-scope': 'Browser task', 'mac-access': 'Mac access', permission: 'Calendar and Reminders', 'provider-allow': 'Settings' }[view] ?? 'Pip');
 $('title').textContent = title;
 const step = Math.max(1, live?.turns ?? 1);
 $('workStatus').textContent = ({ ready: 'Ready', working: `Working, step ${step}`, paused: 'Waiting for you', problem: 'Could not finish', talk: 'Listening', threads: `${chats().length} on this Mac` })[s];
 for (const b of $('header-buttons').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.go === view));
}
function footer() {
 const s = scene(), live = liveMsg, typed = $('composer').value.trim().length > 0, limits = live?.limits ?? { turns: 24, milliseconds: 600000 };
 const elapsed = live?.startedAt ? Date.now() - live.startedAt : 0, step = Math.max(1, live?.turns ?? 1), count = `Step ${step} of ${limits.turns}`;
 const pause = pausedProposal(), act = VERBS[pause?.action.kind]?.[3] ?? 'sends it';
 const text = {
  ready: ['Saved on this Mac', `${hotkey} hides`], working: [`${count} · ${clock(elapsed)} of ${clock(limits.milliseconds)}`, typed ? (steerTarget() ? 'Return redirects Pip · Esc stops' : 'Return asks it next · Esc stops') : 'Esc stops'],
  paused: [`${count} · paused`, `⌘Return ${act}`], threads: ['Saved on this Mac', 'Esc goes back'], talk: ['Listening on this Mac. Nothing sends until you review it.', 'Return stops · Esc cancels'],
  problem: ['Your message is kept', `${hotkey} hides`]
 }[s];
 if (!noticeOn) $('status').textContent = text[0];
 $('shortcut').textContent = text[1];
}
function input() {
 const s = scene(), typed = $('composer').value.trim().length > 0, chat = currentChat();
 $('composer').placeholder = ({ ready: chat ? 'Reply to Pip' : 'Ask Pip anything', working: steerTarget() ? 'Tell Pip to change course' : 'Ask Pip something next', paused: 'Or tell Pip what to do instead', threads: 'Ask Pip anything', problem: 'Ask Pip anything', talk: 'Ask Pip anything' })[s];
 const send = $('send'), working = s === 'working';
 send.replaceChildren(); send.className = 'sd';
 if (working && !typed) { send.classList.add('sq'); send.append(icon('stop')); send.setAttribute('aria-label', 'Stop'); send.title = 'Stop'; send.dataset.mode = 'stop'; }
 else if (working && steerTarget()) { send.classList.add('wd'); send.append(document.createTextNode('Steer'), icon('up')); send.setAttribute('aria-label', 'Steer Pip'); send.title = 'Tell Pip to change course'; send.dataset.mode = 'steer'; }
 else if (working) { send.classList.add('wd'); send.append(document.createTextNode('Ask next'), icon('up')); send.setAttribute('aria-label', 'Send after Pip finishes'); send.title = 'Send after Pip finishes'; send.dataset.mode = 'next'; }
 else { send.append(icon('up')); send.setAttribute('aria-label', 'Send'); send.title = 'Send'; send.dataset.mode = 'send'; }
 $('talk').classList.toggle('on', s === 'talk'); $('talk').setAttribute('aria-label', s === 'talk' ? 'Stop listening' : 'Talk');
 $('level').hidden = s !== 'talk';
}
function bodyViews() {
 const secondary = view !== 'chat' && view !== 'chats', proposalShown = view === 'chat' && otherProposal();
 const empty = view === 'chat' && !currentChat() && !proposalShown;
 $('cv').hidden = !(view === 'chat' && !proposalShown && !empty); $('tl').hidden = view !== 'chats'; $('result').hidden = !(secondary || proposalShown);
 const showResume = empty && !explicitNew && chats().length > 0 && !listening;
 $('chips').hidden = !(empty && !listening); $('resume').hidden = !showResume;
 if (showResume) { const last = chats()[0]; $('resume').replaceChildren(icon('chev'), node('span', 'Back to ' + last.title), node('time', when(last.last.updatedAt))); $('resume').onclick = () => { chatId = last.id; followNewest = true; show('chat'); $('composer').focus(); }; }
}
function render() {
 const root = $('result'), p = otherProposal();
 if (view === 'browser-scope' && root.querySelector('#browserGoal')) { header(); footer(); input(); fit(); return; }
 const preserving = (view === 'tracker' && root.contains(trackerView)) || (view === 'feedback' && root.contains(feedbackView)) || (view === 'projects' && !!root.querySelector('#project-title')) || (view === 'browser' && root.contains(browserView));
 bodyViews();
 if (view === 'chats') renderChats();
 else if (view === 'chat' && p) { root.replaceChildren(); renderProposal(p, root); }
 else if (view === 'chat') { root.replaceChildren(); renderConversation(); }
 else { if (!preserving) root.replaceChildren(); renderSecondary(root, preserving); }
 renderDock(); header(); footer(); input(); updateCharacter(); updateClock(); fit();
 if (p && view !== 'chat') notice('A saved action needs your approval.');
}
/* One timer, only while Pip works and the window is on screen: the clock in the bottom row and the time on the running row. Pip's work goes on
   while the window is hidden; only drawing it stops. */
let clockTimer = 0, windowAway = false;
const onScreen = () => !document.hidden && !windowAway;
function updateClock() {
 if (workingWork() && onScreen()) { if (!clockTimer) clockTimer = setInterval(() => { footer(); if (liveBox && liveFor) liveBox.update(liveMsg, Date.now(), !!pausedProposal()); }, 500); }
 else if (clockTimer) { clearInterval(clockTimer); clockTimer = 0; }
}
function updateCharacter() {
 const s = scene(), last = currentChat()?.last, key = s + ':' + (last?.status ?? ''), c = character;
 if (key === lastCharacter) return; lastCharacter = key;
 const pose = ({ working: 'working', paused: 'approval', problem: 'blocked', talk: 'listening', threads: 'rest' })[s] ?? (last?.status === 'Done' ? 'done' : 'rest');
 c.showState(pose, { verified: pose === 'done', background: document.hidden });
 magic.working(s === 'working');
 if (s !== 'paused') magic.pause(false);
}
/* Where Pip looks when the pointer rests: the words being typed, the live step, the newest part, the list of chats. A paused step: straight at you. */
function focusPoint() {
 if (document.body.classList.contains('out') || document.hidden) return null;
 const s = scene(), win = $('win').getBoundingClientRect(), composer = $('composer');
 let el = null, along = .7;
 if (s === 'paused') return null;
 if (document.activeElement === composer && composer.value) { const box = composer.getBoundingClientRect(); return [box.left + Math.min(box.width - 24, 14 + composer.value.length * 7), box.top + Math.min(box.height, 22) / 2]; }
 if (s === 'threads') el = $('tl');
 else if (s === 'working') el = $('cv').querySelector('.acs .lv') || $('cv').querySelector('.acs .ac:last-child') || $('cv').querySelector('.tn:last-child');
 else if (s === 'problem') el = $('cv').querySelector('.pb') || $('cv').querySelector('.tn:last-child');
 else if (s === 'talk') el = composer;
 else el = $('cv').querySelector('.tn:last-child .pl, .tn:last-child .rc, .tn:last-child') || composer;
 const box = el?.getBoundingClientRect();
 if (!box || !box.width) return null;
 const y = Math.max(win.top + 12, Math.min(win.bottom - 12, box.top + box.height / 2));
 return [box.left + box.width * along, y];
}
character.setFocus(focusPoint);
// The page's own pointer events serve tests and the page's edge; the host sends the pointer from anywhere on screen.
document.addEventListener('pointermove', e => character.pointer(e.clientX, e.clientY), { passive: true });
document.documentElement.addEventListener('pointerleave', () => character.pointer(null));
character.addEventListener('click', () => magic.poke());
$('composer').addEventListener('input', () => { character.nudge(0, .15); });

/* Steering: while Pip works on this chat, a typed message redirects the work he is doing; he is not stopped. At a paused step the step is
   cancelled first, so "tell Pip instead" means instead. If the host refuses (the work had just ended) the words come back to the message box. */
const steered = new Map();
function steer(raw, target) {
 // The steer goes first: it waits for the paused step to end, so Pip's next turn already holds both the skipped step and the new words.
 const pause = pausedProposal();
 steered.set(emit('steer', { workId: target.id, request: raw }), raw);
 if (pause) emit('cancel', { id: pause.id });
 $('composer').value = ''; emit('saveComposer', { text: '' }); autosize(); followNewest = true; render();
}
/* Sending. Return sends; while Pip works on another chat's request the message queues behind it. */
function send(raw, { retry = false } = {}) {
 const request = raw.trim(); if (!request) return;
 const pause = pausedProposal(); if (pause) emit('cancel', { id: pause.id });
 const chat = view === 'chats' ? undefined : currentChat();
 const parent = chat ? [...chat.works].reverse().find(w => w.status === 'Done' && w.result) : undefined;
 const id = emit('submit', { request: raw, ...(parent ? { contextWorkId: parent.id } : {}), ...(selectedProject ? { project: selectedProject } : {}) });
 if (selectedProject) notice('Approved project context applies only to this request.');
 selectedProject = null; selected = id;
 if (chat && !parent) forcedChat.set(id, chat.id);
 chatId = chat ? chat.id : id; explicitNew = false; followNewest = true; view = 'chat';
 if (!retry) { $('composer').value = ''; autosize(); }
 render();
}
// The message box grows to six lines before it scrolls: the limit is the line height times six, plus the box's own padding (CSS max-height).
function autosize() { const c = $('composer'); c.style.height = 'auto'; c.style.height = Math.min(c.scrollHeight, parseFloat(getComputedStyle(c).maxHeight) || 139) + 'px'; }
$('ask').onsubmit = e => {
 e.preventDefault();
 if ($('send').dataset.mode === 'stop') { emit('stop'); return; }
 // Return while listening only stops the capture, so the words can be read before anything is sent.
 if (dictation.pending) { dictation.stopListening(); return; }
 const rawRequest = $('composer').value, request = rawRequest.trim(); if (!request) return;
 if (feedbackComposerRequest) { notice('A local feedback save is awaiting its receipt. Your message is kept.'); return; }
 const feedback = request.match(/^(?:log|save) (?:a )?(bug|feature request|issue)(?: about pip)?:\s*([\s\S]+)$/i);
 if (feedback) { const id = crypto.randomUUID(); feedbackComposerRequest = { id, request: $('composer').value }; emit('feedback.save', { id, originalWords: rawRequest, title: feedback[2].slice(0, 200), kind: ({ 'bug': 'bug', 'feature request': 'feature', 'issue': 'issue' })[feedback[1].toLowerCase()], priority: 'normal' }); return; }
 const target = steerTarget(); if (target) steer(rawRequest, target); else send(rawRequest);
};
$('composer').onkeydown = e => {
 if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('ask').requestSubmit(); }
};
$('composer').oninput = () => { emit('saveComposer', { text: $('composer').value }); autosize(); input(); footer(); };

/* Header: Chats, New chat, More, Close. Settings, Feedback and the rest sit under More. */
const headerButtons = $('header-buttons');
for (const [name, label, go, action] of [['list', 'Chats', 'chats', () => show(view === 'chats' ? 'chat' : 'chats')], ['plus', 'New chat', '', startNew], ['more', 'More', 'menu', () => toggleMenu()], ['x', 'Close', '', () => requestHide()]]) {
 const b = iconButton(name, label, action); b.dataset.go = go; b.id = go === 'chats' ? 'chats' : go === 'menu' ? 'more' : name === 'x' ? 'hide' : 'newchat'; headerButtons.append(b);
}
function toggleMenu(force) {
 const menu = $('menu'), open = force ?? menu.hidden; menu.hidden = !open; $('more').setAttribute('aria-expanded', String(open));
 if (!open) return;
 menu.replaceChildren();
 for (const [label, key, go] of [['Settings', '⌘,', () => show('settings')], ['Feedback', '', () => show('feedback')], ['Tracker', '', () => show('tracker')], ['Remember', '', () => show('remember')], ['Browser task', '', () => show('browser-scope')]]) {
  const b = button(undefined, () => { toggleMenu(false); go(); }, ''); b.setAttribute('role', 'menuitem'); b.dataset.item = label.toLowerCase().replace(/\s+/g, '-'); b.append(node('span', label), node('kbd', key)); menu.append(b);
 }
 menu.firstChild.focus();
}
document.addEventListener('click', e => { if (!$('menu').hidden && !e.target.closest('#menu, #more')) toggleMenu(false); });
$('menu').addEventListener('keydown', e => { const items = [...$('menu').querySelectorAll('button')], i = items.indexOf(document.activeElement); if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); } if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); } });
$('talk').append(icon('mic'));
const dictation = new window.PipDictation({ emit, reveal, changed: () => { listen(); autosize(); render(); }, level: setLevel, notice });
function listen() { listening = dictation.state === 'capturing' || dictation.state === 'stopping'; }
function setLevel(value) { [...$('level').children].forEach((bar, i) => { bar.style.height = Math.round(3 + 13 * Math.max(0, Math.min(1, value)) * [.45, .85, .6, 1, .5][i]) + 'px'; }); }
for (const b of document.querySelectorAll('[data-prompt]')) b.onclick = () => { $('composer').value = b.dataset.prompt; $('composer').focus(); emit('saveComposer', { text: $('composer').value }); autosize(); input(); footer(); };

/* Window motion: arrivals fade in over 360 ms and small changes take 160 ms. The host removes the window after the 160 ms exit. */
let hiding = 0;
function requestHide() {
 if (hiding) { clearTimeout(hiding); hiding = 0; emit('hide'); return; }
 const wait = magic.hide();
 document.body.classList.add('out');
 hiding = setTimeout(() => { hiding = 0; emit('hide'); }, wait);
}
const conceal = () => { character.conceal(); document.body.classList.add('snap', 'out'); void document.body.offsetHeight; document.body.classList.remove('snap'); };
function arrive() { conceal(); void document.body.offsetHeight; document.body.classList.remove('out'); }

window.pipReceive = message => {
 if (!message || typeof message !== 'object') return;
 if (message.kind === 'browserState') { browserStates.set(message.payload.workId, message.payload); browserView.update(message.payload); if (view === 'chat') render(); return; }
 if (message.kind === 'browserResult') { browserView.accept(message); fit(); return; }
 if (message.kind === 'error') { browserView.accept(message); if (steered.has(message.id)) { const words = steered.get(message.id); steered.delete(message.id); if (!$('composer').value) { $('composer').value = words; emit('saveComposer', { text: words }); autosize(); input(); footer(); } } }
 if (message.kind === 'live') {
  liveMsg = message.payload;
  const work = workingWork();
  if (work && liveBox && liveFor === work.id) { liveBox.update(liveMsg, Date.now(), !!pausedProposal()); header(); footer(); if (followNewest) { const cv = $('cv'); cv.scrollTop = cv.scrollHeight; } }
  else if (work) render();
 } else if (message.kind === 'state') {
  const next = message.payload.state;
  const receipt = initialized ? [...next.proposals].reverse().find(p => ['succeeded', 'failed-known'].includes(p.status) && !state.proposals.some(old => old.id === p.id && old.status === p.status && old.receipt === p.receipt)) : null;
  const before = workingWork();
  state = next; replies = message.payload.replies ?? {}; providers = message.payload.providers?.providers ?? []; window.pipProviderName = providerName(); workViews = message.payload.workViews ?? [];
  const now = workingWork();
  // The run that just ended keeps its rows, so its folded line can open on them.
  if (before && before.id !== now?.id && liveMsg?.steps?.length) { stepsByWork.set(before.id, liveMsg.steps.map(s => s.state === 'running' ? { ...s, state: 'done' } : s)); liveMsg = null; endLive(before.id); }
  if (now && now.id !== before?.id) { liveMsg = null; endLive(before?.id); }
  if (!initialized) { $('composer').value = state.composer; autosize(); applySummonView(); }
  render(); initialized = true;
  if (receipt && !pausedProposal()) notice(receipt.receipt);
 } else if (message.kind === 'trackerResult') {
  const query = trackerQueries.get(message.id); trackerQueries.delete(message.id); if (query) trackerView.setRecords(query.view, message.payload, query.revision);
 } else if (message.kind === 'feedbackSaved') {
  if (feedbackView.pending?.id === message.payload.id) feedbackView.acknowledge(message.payload.id);
  if (feedbackComposerRequest?.id === message.payload.id) { if ($('composer').value === feedbackComposerRequest.request) { $('composer').value = ''; emit('saveComposer', { text: '' }); autosize(); } feedbackComposerRequest = null; }
  trackerView.openRecord('about', message.payload.id); show('tracker');
  notice(`Saved ${message.payload.id} to About Pip · Backlog. No implementation started.`);
 } else if (message.kind === 'nativeStatus') {
  const p = message.payload;
  hotkey = String(p.hotkey ?? '⌘⇧E').replace(/ to summon$/, ''); nativeShortcut = p.letter ?? 'e';
  flags.visibleHeight = Number(p.visibleHeight) > 0 ? Number(p.visibleHeight) : 0;
  flags.most = Number(p.mostHeight) > 0 ? Number(p.mostHeight) : 0; flags.width = Number(p.windowWidth) > 0 ? Number(p.windowWidth) : 0;
  document.body.classList.toggle('reduced-motion', !!p.reducedMotion);
  document.body.classList.toggle('solid', !!p.solid);
  document.body.classList.toggle('contrast', !!p.contrast);
  character.setReduced(!!p.reducedMotion); if (p.reducedMotion) magic.halt();
  if (p.magic) setMagic(p.magic, false);
  footer(); fit();
 } else if (message.kind === 'summon') {
  const now = performance.now(), short = now - lastSummonAt < QUICK_REPEAT_MS; lastSummonAt = now;
  windowAway = false; applySummonView(); lastCharacter = ''; render(); $('composer').focus();
  character.setHidden(false); arrive(); magic.summon({ short }); character.wake();
 } else if (message.kind === 'dictation') { dictation.receive(message.payload); }
 else if (message.kind === 'dictationCancelled') { if (message.payload.session === dictation.session) dictation.cancel({ notify: false }); }
 else if (message.kind === 'popupHidden') { windowAway = true; updateClock(); clearTimeout(hiding); hiding = 0; dictation.cancel({ notify: false }); magic.halt(); conceal(); character.setHidden(true); }
 else if (message.kind === 'hideRequest') requestHide();
 else if (message.kind === 'pointer') { const q = message.payload; if (q.off) character.pointer(null); else character.pointer(Number(q.x), Number(q.y)); }
 else if (message.kind === 'settings') show('settings');
 else if (message.kind === 'permissionsState') { permissions = message.payload.permissions ?? []; permissionsAskedAt = message.payload.askedAt ?? ''; if (view === 'mac-access') render(); }
 else if (['error', 'disconnected'].includes(message.kind)) { notice(message.payload.message); if (feedbackView.pending) feedbackView.failed(message.payload.message); if (message.kind === 'disconnected') { view = 'settings'; $('result').hidden = false; $('cv').hidden = true; $('result').replaceChildren(node('p', message.payload.message, 'notice')); } }
};

/* Keys: Return sends, Shift Return adds a line. Esc stops Pip, or cancels talking, or leaves Chats, or hides the window, in that order. */
window.pipEscape = () => {
 if (!$('menu').hidden) { toggleMenu(false); return true; }
 if (workingWork()) { emit('stop'); return true; }
 if (dictation.pending) { dictation.cancel(); return true; }
 if (view !== 'chat') { show('chat'); return true; }
 return false;
};
document.addEventListener('keydown', e => {
 if (e.key === 'Escape') { e.preventDefault(); if (!window.pipEscape()) requestHide(); return; }
 if (e.metaKey && !e.shiftKey && !e.altKey) {
  if (e.key === 'n') { e.preventDefault(); startNew(); }
  else if (e.key === 'k') { e.preventDefault(); show(view === 'chats' ? 'chat' : 'chats'); if (view === 'chats') $('chat-search')?.focus(); }
  else if (e.key === ',') { e.preventDefault(); show('settings'); }
  else if (e.key === 'Enter' && pausedProposal()) { e.preventDefault(); runPaused(pausedProposal()); }
 }
 if (view === 'chats' && ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key) && !(e.key === 'Enter' && e.target.closest?.('button'))) {
  const rows = [...$('tl').querySelectorAll('.tr[data-chat]')]; if (!rows.length) return;
  if (e.key === 'Enter') { e.preventDefault(); rows[chatIndex]?.click(); return; }
  e.preventDefault(); chatIndex = (chatIndex + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length; rows.forEach((r, i) => r.classList.toggle('sel', i === chatIndex)); rows[chatIndex].scrollIntoView({ block: 'nearest' });
 }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) dictation.cancel(); updateClock(); if (onScreen()) { footer(); if (liveBox && liveFor) liveBox.update(liveMsg, Date.now(), !!pausedProposal()); } });
addEventListener('blur', () => dictation.cancel());
// In the native app the window stays hidden until the host's summon message arrives.
if (window.webkit?.messageHandlers?.pip) { document.body.classList.add('native'); conceal(); windowAway = true; }
render(); emit('snapshot'); $('composer').focus();
