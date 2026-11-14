export class PipTracker extends HTMLElement {
 constructor(){super();this.attachShadow({mode:'open'});this.records=[];this.view='work';this.selected=null;this.queryRevision=0;}
 connectedCallback(){if(!this.shadowRoot.childNodes.length)this.render();else this.request();}
 openRecord(view,id){if(!['work','about'].includes(view)||typeof id!=='string'||!id)throw Error('Invalid tracker target');this.view=view;this.selected=id;this.records=[];this.focusSelected=true;if(this.shadowRoot.childNodes.length){this.shadowRoot.querySelector('#search').value='';this.shadowRoot.querySelector('#filter').value='';for(const v of ['work','about'])this.shadowRoot.querySelector('#'+v).setAttribute('aria-pressed',String(v===view));this.drawRecords();this.request();}}
 setRecords(view,records,revision=this.queryRevision){if(view!==this.view||revision!==this.queryRevision)return;this.records=records;this.drawRecords();this.dispatchEvent(new CustomEvent('tracker-rendered',{detail:{view,revision,ids:records.map(record=>record.id)}}));}
 request(){this.dispatchEvent(new CustomEvent('tracker-query',{detail:{revision:++this.queryRevision,view:this.view,query:this.shadowRoot.querySelector('#search').value,status:this.shadowRoot.querySelector('#filter').value},bubbles:true,composed:true}));}
 render(){
  this.shadowRoot.innerHTML=`<link rel="stylesheet" href="${new URL('./tracker.css',import.meta.url)}"><h2>Tracker</h2><nav aria-label="Tracker views"><button id="work" aria-pressed="${this.view==='work'}">Work</button><button id="about" aria-pressed="${this.view==='about'}">About Pip</button><button id="feedback">Feedback</button></nav>
  <label>Search<input id="search" type="search" maxlength="1000"></label><label>Status<select id="filter"><option value="">All statuses</option>${['Backlog','Queued','Working','Waiting on you','Done','Blocked','Held/Unknown','Interrupted','Stopped','Declined','Archived'].map(s=>`<option>${s}</option>`).join('')}</select></label>
  <p id="count" role="status" aria-live="polite"></p><div id="records"></div><section id="detail" aria-label="Record detail"></section>`;
  for(const view of ['work','about'])this.shadowRoot.querySelector('#'+view).onclick=()=>{this.view=view;this.selected=null;for(const v of ['work','about'])this.shadowRoot.querySelector('#'+v).setAttribute('aria-pressed',String(v===view));this.records=[];this.drawRecords();this.request();};
  this.shadowRoot.querySelector('#feedback').onclick=()=>this.dispatchEvent(new CustomEvent('tracker-feedback',{bubbles:true,composed:true}));
  this.shadowRoot.querySelector('#search').oninput=()=>this.request();this.shadowRoot.querySelector('#filter').onchange=()=>this.request();
  this.drawRecords();this.request();
 }
 drawRecords(){
  const root=this.shadowRoot.querySelector('#records');if(!root)return;root.replaceChildren();
  this.shadowRoot.querySelector('#count').textContent=`${this.records.length} matching ${this.view==='work'?'work':'About Pip'} records`;
  if(!this.records.length){const p=document.createElement('p');p.textContent='No matching records.';root.append(p);}
  for(const r of this.records){const button=document.createElement('button');button.type='button';button.dataset.recordId=r.id;button.textContent=`${r.status} · ${r.title}`;button.onclick=()=>{this.selected=r.id;this.drawDetail(r);};root.append(button);}
  const selected=this.records.find(r=>r.id===this.selected);if(selected){this.drawDetail(selected);if(this.focusSelected){const button=[...root.querySelectorAll('button')].find(b=>b.dataset.recordId===selected.id);button?.focus();button?.scrollIntoView({block:'nearest'});this.focusSelected=false;}}else this.shadowRoot.querySelector('#detail').replaceChildren();
 }
 drawDetail(record){
  const root=this.shadowRoot.querySelector('#detail');root.replaceChildren();
  const add=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;root.append(el);};
  add('h3',record.title);add('small',`${record.id} · ${record.feedback?.kind??'work'} · ${record.priority??'normal'}`);
  add('p',record.status);add('p',`Original request: ${record.originalWords}`);add('p',`Next: ${record.reason||'Inspect the recorded result.'}`);
  if(record.result)add('p',`Result: ${record.result}`);
  if(record.view==='work'){
   const activity=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Activity, sources and approvals';activity.append(summary);
   const notes=[...(record.activity??[]).map(e=>e.note),...(record.sources??[]).map(s=>`${s.title} · ${s.url}`),...(record.approvals??[]).map(p=>`${p.id} · ${p.status} · ${p.receipt}`)];
   for(const text of notes){const p=document.createElement('p');p.textContent=text;activity.append(p);}root.append(activity);
  }
  const f=record.feedback;if(f){
   add('p',`Reproduction: ${f.reproduction||'Not supplied'}`);add('p',`Source: ${f.sourceWorkId||'Explicit Feedback form'}`);
   if(f.duplicateOf)add('p',`Duplicate of: ${f.duplicateOf}`);
   const history=document.createElement('details'),summary=document.createElement('summary');summary.textContent='History and corrections';history.append(summary);
   for(const revision of f.history){const p=document.createElement('p');p.textContent=`Revision ${revision.revision}: ${revision.note}\n${revision.title}\n${revision.reproduction}`;history.append(p);}root.append(history);
  }
 }
}
customElements.define('pip-tracker',PipTracker);
