import { text, validateURL, type State } from './domain.js';

// ELF-8 approved project continuity: references describe context, never grant access.
export type ProjectPin={title:string;reference:string;checkedAt:string};
export type Project={id:string;revision:number;active:boolean;title:string;summary:string;provenance:string;pins:ProjectPin[];workIds:string[];updatedAt:string};
export type ProjectContext=Pick<Project,'id'|'revision'|'title'|'summary'|'provenance'|'pins'|'updatedAt'>;
export type ProjectAction=
 | {type:'project.save';projectId:string;revision:number;title:string;summary:string;provenance:string;pins:ProjectPin[];workIds:string[]}
 | {type:'project.forget';projectId:string;revision:number}
 | {type:'work.continue';workId:string;attempts:number;projectRevision:number};
export function projectAction(a:Record<string,unknown>):ProjectAction {
 const keys=a.type==='project.save'?['type','projectId','revision','title','summary','provenance','pins','workIds']:a.type==='project.forget'?['type','projectId','revision']:['type','workId','attempts','projectRevision'];
 if(Object.keys(a).some(k=>!keys.includes(k)))throw Error('Unexpected continuity field');
 if(a.type==='work.continue'){
  if(!Number.isSafeInteger(a.attempts)||(a.attempts as number)<0||!Number.isSafeInteger(a.projectRevision)||(a.projectRevision as number)<0)throw Error('Invalid continuation revision');
  return {type:a.type,workId:text(a.workId,'work ID',100),attempts:a.attempts as number,projectRevision:a.projectRevision as number};
 }
 if(!Number.isSafeInteger(a.revision)||(a.revision as number)<0)throw Error('Invalid project revision');
 const base={projectId:text(a.projectId,'project ID',100),revision:a.revision as number};
 if(a.type==='project.forget')return {type:a.type,...base};
 if(a.type!=='project.save'||!Array.isArray(a.pins)||a.pins.length>20||!Array.isArray(a.workIds)||a.workIds.length>100)throw Error('Invalid project context');
 const pins=a.pins.map(p=>{
  if(!p||typeof p!=='object'||Object.keys(p).some(k=>!['title','reference','checkedAt'].includes(k)))throw Error('Invalid pin');
  const checkedAt=text(p.checkedAt,'source check time',100);if(!Number.isFinite(Date.parse(checkedAt))||Date.parse(checkedAt)>Date.now())throw Error('Invalid source check time');
  return {title:text(p.title,'source title',200),reference:validateURL(p.reference),checkedAt};
 });
 return {type:'project.save',...base,title:text(a.title,'project title',200),summary:text(a.summary,'approved summary',12000),provenance:text(a.provenance,'provenance',1000),pins,workIds:[...new Set(a.workIds.map(id=>text(id,'work ID',100)))]};
}
export function projectContext(state:State,id:string,revision:number):ProjectContext {
 const p=state.projects?.find(p=>p.id===id&&p.active);
 if(!p||p.revision!==revision)throw Object.assign(new Error('Project changed or was forgotten. Review its current context.'),{code:'context-changed'});
 return {id:p.id,revision:p.revision,title:p.title,summary:p.summary,provenance:p.provenance,pins:p.pins.map(pin=>({...pin})),updatedAt:p.updatedAt};
}
export function checkProjectAction(state:State,a:ProjectAction) {
 if(a.type==='work.continue'){
  const w=state.works.find(w=>w.id===a.workId);
  if(!w||w.status!=='Interrupted'||w.needsScreenContext||(w.usage?.attempts??0)!==a.attempts)throw Error('This work cannot continue. Reattach ephemeral sources separately or review its current status.');
  if(state.proposals.some(p=>p.workId===w.id&&['proposed','unknown','intent-recorded'].includes(p.status)))throw Error('Resolve the existing action; it will not be replayed.');
  if(w.projectContext)projectContext(state,w.projectContext.id,a.projectRevision);
  else if(a.projectRevision!==0)throw Error('This work has no project');
  return;
 }
 const p=state.projects?.find(p=>p.id===a.projectId);
 if(a.type==='project.forget'&&a.revision===0)throw Error('Project changed. Review a fresh proposal.');
 if(a.revision===0 ? !!p : !p?.active||p.revision!==a.revision)throw Error('Project changed. Review a fresh proposal.');
 if(a.type==='project.save'&&a.workIds.some(id=>!state.works.some(w=>w.id===id)))throw Error('Linked work is unavailable');
}
export function applyProjectAction(state:State,a:ProjectAction) {
 checkProjectAction(state,a);
 if(a.type==='work.continue')return; // The durable owner queues a new inference episode, never an old effect.
 state.projects??=[];
 const old=state.projects.find(p=>p.id===a.projectId);
 if(a.type==='project.forget'){
  old!.active=false;old!.summary='';old!.pins=[];old!.workIds=[];old!.provenance='Forgotten by explicit approval';old!.revision++;old!.updatedAt=new Date().toISOString();
  // Remove cached summaries from future follow-ups and pending inference.
  for(const w of state.works)if(w.projectContext?.id===a.projectId)delete w.projectContext;
 }else{
  const value:Project={id:a.projectId,revision:a.revision+1,active:true,title:a.title,summary:a.summary,provenance:a.provenance,pins:a.pins,workIds:a.workIds,updatedAt:new Date().toISOString()};
  if(old)Object.assign(old,value);else state.projects.push(value);
 }
}
