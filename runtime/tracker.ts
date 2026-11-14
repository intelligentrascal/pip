import { text, currentSchema, type State, type Work } from './domain.js';

export type FeedbackKind = 'feature'|'bug'|'issue';
export type Priority = 'low'|'normal'|'high';
export type TrackerStatus = 'Backlog'|'Queued'|'Working'|'Waiting on you'|'Done'|'Blocked'|'Held/Unknown'|'Interrupted'|'Stopped'|'Declined'|'Archived';
export type Feedback = {
 id:string; originalWords:string; title:string; kind:FeedbackKind; priority:Priority;
 createdAt:string; updatedAt:string; revision:number; reproduction:string; sourceWorkId?:string;
 duplicateOf?:string; resolution?:{reason:string; version?:string};
 status:'Backlog'|'Done'|'Declined'|'Archived';
 history:{at:string; revision:number; note:string; title:string; reproduction:string; duplicateOf?:string}[];
};
export type FeedbackInput = {id:string; originalWords:string; title:string; kind:FeedbackKind; priority:Priority; reproduction?:string; sourceWorkId?:string};
export type TrackerRecord = {id:string; view:'work'|'about'; title:string; originalWords:string; status:TrackerStatus; reason:string; createdAt:string; result:string; priority:Priority; activity?:{at:string;note:string}[]; sources?:{id:string;title:string;url:string}[]; approvals?:{id:string;status:string;receipt:string}[]; feedback?:Feedback};

// ELF-8: migrate the existing document in place; never infer historical sends or delivery.
export function migrateTracker(state:State) {
 if(!Number.isInteger(state.schema)||state.schema<1||state.schema>currentSchema)throw Error('Unsupported Pip state schema');
 state.feedback??=[];
 state.projects??=[];
 state.schema=currentSchema;
 return state;
}
export function saveFeedback(state:State,input:FeedbackInput):Feedback {
 migrateTracker(state);
 const id=text(input.id,'feedback ID',100);
 const originalWords=text(input.originalWords,'original words',12000);
 const title=text(input.title,'title',200);
 if(!['feature','bug','issue'].includes(input.kind)||!['low','normal','high'].includes(input.priority))throw Error('Invalid feedback category');
 const reproduction=input.reproduction===undefined?'':input.reproduction;
 if(typeof reproduction!=='string'||reproduction.length>12000)throw Error('Invalid reproduction details');
 if(input.sourceWorkId!==undefined&&!state.works.some(w=>w.id===input.sourceWorkId))throw Error('Source work is unavailable');
 const existing=state.feedback!.find(f=>f.id===id);
 if(existing){
  if(existing.originalWords!==originalWords||existing.title!==title||existing.kind!==input.kind||existing.priority!==input.priority||existing.reproduction!==reproduction||existing.sourceWorkId!==input.sourceWorkId)throw Error('Feedback ID already used');
  return existing;
 }
 if(state.works.some(w=>w.id===id))throw Error('Record ID already used');
 const now=new Date().toISOString();
 const feedback:Feedback={id,originalWords,title,kind:input.kind,priority:input.priority,reproduction,...(input.sourceWorkId?{sourceWorkId:input.sourceWorkId}:{}),createdAt:now,updatedAt:now,revision:1,status:'Backlog',history:[{at:now,revision:1,title,reproduction,note:'Explicitly saved to local backlog. No implementation started.'}]};
 state.feedback!.push(feedback);return feedback;
}
export function correctFeedback(state:State,id:string,revision:number,change:{title:string;reproduction:string;note:string;duplicateOf?:string}) {
 const f=state.feedback?.find(f=>f.id===id);
 if(!f||f.revision!==revision)throw Error('Feedback changed. Reopen the record.');
 const title=text(change.title,'title',200),note=text(change.note,'correction',12000);
 if(typeof change.reproduction!=='string'||change.reproduction.length>12000)throw Error('Invalid reproduction details');
 if(change.duplicateOf!==undefined&&(!state.feedback!.some(other=>other.id===change.duplicateOf)||change.duplicateOf===id))throw Error('Choose another existing feedback record');
 f.title=title;f.reproduction=change.reproduction;f.duplicateOf=change.duplicateOf;
 f.revision++;f.updatedAt=new Date().toISOString();f.history.push({at:f.updatedAt,revision:f.revision,note,title,reproduction:f.reproduction,...(f.duplicateOf?{duplicateOf:f.duplicateOf}:{})});return f;
}
export type BacklogWorkInput={id:string;request:string;title:string;priority:Priority};
export function saveBacklogWork(state:State,input:BacklogWorkInput):Work {
 const id=text(input.id,'work ID',100),request=text(input.request,'request',12000),title=text(input.title,'title',200);
 if(!['low','normal','high'].includes(input.priority))throw Error('Invalid priority');
 if(state.feedback?.some(f=>f.id===id))throw Error('Record ID already used by feedback');
 const existing=state.works.find(w=>w.id===id);
 if(existing){if(existing.request!==request||existing.title!==title||existing.priority!==input.priority)throw Error('Work ID already used');return existing;}
 const at=new Date().toISOString();
 const work:Work={id,request,title,priority:input.priority,status:'Backlog',createdAt:at,updatedAt:at,result:null,error:'',taskId:0,history:[{at,status:'Backlog',note:'Explicitly saved for later; no start requested.'}]};
 state.works.push(work);return work;
}
export function recordWorkStatus(work:Work,status:Work['status'],note:string){
 work.status=status;work.updatedAt=new Date().toISOString();
 (work.history??=[]).push({at:work.updatedAt,status,note});
}
function workRecord(state:State,w:Work):TrackerRecord {
 const proposals=state.proposals.filter(p=>p.workId===w.id);
 let status:TrackerStatus=w.status==='Could not finish'?'Blocked':w.status;
 let reason=w.error;
 if(proposals.some(p=>p.status==='unknown'||p.status==='intent-recorded')){status='Held/Unknown';reason='An issued action needs a confirmed result. It will not be repeated.';}
 else if(proposals.some(p=>p.status==='proposed')){status='Waiting on you';reason='Review the exact proposed action.';}
 else if(w.needsScreenContext){status='Waiting on you';reason='Review and share a fresh window, then Continue this task.';}
 else if(w.status==='Done'&&proposals.some(p=>p.status==='failed-known'||p.status==='cancelled')){status='Blocked';reason='The proposed action did not complete.';}
 else if(w.status==='Done'&&!w.result){status='Interrupted';reason='No verified result is available.';}
 // Legacy results lack an effect/goal association. Preserve them without inventing delivery.
 else if(w.status==='Done'&&!w.completion){status='Waiting on you';reason='Historical result available; completion was not verified against the requested goal.';}
 else if(w.status==='Done'&&(w.completion==='review'||w.goal!=='result')){status='Waiting on you';reason='A result is ready; the requested outcome still needs review.';}
 if(w.status==='Backlog')reason='Saved for later. No start requested or executor assigned.';
 return {id:w.id,view:'work',title:w.title??w.request,originalWords:w.request,status,reason,createdAt:w.createdAt,result:w.result?.text??'',priority:w.priority??'normal',activity:w.history?.map(e=>({at:e.at,note:e.note})),sources:w.result?.sources.map(s=>({id:s.id,title:s.title,url:s.url})),approvals:proposals.map(p=>({id:p.id,status:p.status,receipt:p.receipt}))};
}
export function trackerRecords(state:State,view:'work'|'about',query='',status=''):TrackerRecord[] {
 const records:TrackerRecord[]=view==='work'?state.works.map(w=>workRecord(state,w)):(state.feedback??[]).map(f=>({id:f.id,view:'about',title:f.title,originalWords:f.originalWords,status:f.status,reason:f.status==='Backlog'?'Saved locally; no implementation owner assigned.':f.resolution?.reason??'',createdAt:f.createdAt,result:f.resolution?.version??'',priority:f.priority,feedback:f}));
 const term=query.toLocaleLowerCase();
 return records.filter(r=>(!status||r.status===status)&&`${r.id} ${r.title} ${r.originalWords} ${r.feedback?.reproduction??''}`.toLocaleLowerCase().includes(term)).reverse();
}
