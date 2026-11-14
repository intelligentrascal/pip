import { projectAction, checkProjectAction, applyProjectAction, type ProjectAction, type Project, type ProjectContext } from './projects.js';
import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { backendAction, isBackendAction, type BackendAction, type BackendReader } from './backend-contracts.js';

export type Action = ProjectAction | BackendAction
 | { type: 'memory.save'; text: string; source: string }
 | { type: 'memory.edit'; memoryId: string; revision: number; text: string }
 | { type: 'memory.forget'; memoryId: string; revision: number }
 | { type: 'clipboard.copy'; text: string }
 | { type: 'url.open'; url: string }
 | { type: 'app.open'; bundleId: string }
 | { type: 'note.save'; text: string };
export type Memory = { id: string; text: string; source: string; revision: number; active: boolean; updatedAt: string };
export type Proposal = { workId?: string; id: string; revision: number; digest: string; action: Action; status: 'proposed'|'cancelled'|'intent-recorded'|'succeeded'|'failed-known'|'unknown'; receipt: string; createdAt: string; backendResult?: string };
export type Source = { id: string; url: string; title: string; fetchedAt: string; text: string; offset?: number; totalCharacters?: number; truncated?: boolean; continuation?: string };
export type Result = { screenSource?: import('./screen-context.js').ScreenContextDescriptor; kind: 'answer'|'draft'; title: string; text: string; sources: Source[]; model: string; sessionId: string; proposal?: Action; backup?: { provider: string; replaced: string; reason: string } };
export type SelectedContext = { workId: string; request: string; result: Pick<Result, 'kind'|'title'|'text'> };
export type ProviderRequestContext = { browser?: import('./task-browser.js').BrowserTools; project?: ProjectContext; screen?: import('./screen-context.js').SharedScreenContext; sessionId: string; context?: SelectedContext; backend?: BackendReader };
export type Work = { browserRequired?: boolean; pauseReason?: 'restart'|'provider-cutoff'|'no-progress'|'context-changed'; projectContext?: ProjectContext; usage?: {attempts:number; activeMilliseconds:number}; screenContext?: import('./screen-context.js').ScreenContextDescriptor; needsScreenContext?: boolean; title?: string; priority?: 'low'|'normal'|'high'; updatedAt?: string; history?: {at:string; status:string; note:string}[]; goal?: 'result'|'effect'; completion?: 'result'|'review'; id: string; request: string; status: 'Backlog'|'Queued'|'Working'|'Done'|'Stopped'|'Interrupted'|'Could not finish'; result: Result|null; error: string; taskId: number; createdAt: string; sessionId?: string; threadId?: string; context?: SelectedContext };
export type State = { projects?: Project[]; feedback?: import('./tracker.js').Feedback[]; schema: number; composer: string; works: Work[]; memory: Memory[]; proposals: Proposal[] };
export const currentSchema = 4;
export const initialState = (): State => ({schema:1, composer:'', works:[], memory:[], proposals:[]});
export function text(value: unknown, name = 'text', max = 30000): string {
 if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${name}`);
 return value;
}
export function validateURL(value: unknown): string {
 const url = new URL(text(value, 'URL', 2048));
 if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Only public HTTPS links are supported');
 if (isIP(url.hostname.replace(/^\[|\]$/g,''))) throw new Error('Use a public hostname, not a network address');
 if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) throw new Error('Local links are not supported');
 return url.href;
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
 if (Object.keys(value).some(k => !keys.includes(k))) throw new Error('Unexpected action field');
}
export function validateAction(input: unknown): Action {
 if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid action');
 const a = input as Record<string, unknown>;
 if(isBackendAction(a.type))return backendAction(a);
 if(['project.save','project.forget','work.continue'].includes(String(a.type)))return projectAction(a);
 switch(a.type) {
 case 'memory.save': exactKeys(a,['type','text','source']); return {type:a.type,text:text(a.text),source:text(a.source,'source',1000)};
 case 'memory.edit': case 'memory.forget': {
  exactKeys(a, a.type === 'memory.edit' ? ['type','memoryId','revision','text'] : ['type','memoryId','revision']);
  if (!Number.isSafeInteger(a.revision) || (a.revision as number)<1) throw new Error('Invalid revision');
  const base = {memoryId:text(a.memoryId,'memory ID',100), revision:a.revision as number};
  return a.type === 'memory.edit' ? {type:a.type,...base,text:text(a.text)} : {type:a.type,...base};
 }
 case 'clipboard.copy': case 'note.save': exactKeys(a,['type','text']); return {type:a.type,text:text(a.text)};
 case 'url.open': exactKeys(a,['type','url']); return {type:a.type,url:validateURL(a.url)};
 case 'app.open': exactKeys(a,['type','bundleId']); if (!['com.apple.iCal','com.apple.reminders','com.apple.TextEdit','com.apple.finder'].includes(String(a.bundleId))) throw new Error('Unsupported application'); return {type:a.type,bundleId:String(a.bundleId)};
 default: throw new Error('That action is not supported. No sending, deletion or shell commands are available.');
 }
}
export const digest = (action: Action) => createHash('sha256').update(JSON.stringify(validateAction(action))).digest('hex');
export function propose(state: State, input: unknown): Proposal {
 const action = validateAction(input);
 validateTarget(state, action);
 const p: Proposal = {id:randomUUID(), revision:1, digest:digest(action),action,status:'proposed',receipt:'',createdAt:new Date().toISOString()};
 state.proposals.push(p); return p;
}
function validateTarget(state: State, a: Action) {
 if(a.type==='project.save'||a.type==='project.forget'||a.type==='work.continue')checkProjectAction(state,a);
 if(a.type==='schedule.mutate'&&state.proposals.some(p=>p.status==='unknown'&&p.action.type==='schedule.mutate'&&(a.change.objectID ? p.action.change.objectID===a.change.objectID||p.id===a.change.beforeCorrelation : p.action.change.target.id===a.change.target.id&&JSON.stringify(p.action.change.after)===JSON.stringify(a.change.after))))throw new Error('An equivalent native outcome is Unknown. Reconcile it before another change.');
 if (a.type === 'memory.edit' || a.type === 'memory.forget') {
  const m = state.memory.find(m => m.id === a.memoryId);
  if (!m?.active || m.revision !== a.revision) throw new Error('This fact changed. Review a fresh proposal.');
 }
}
export function approve(state: State, id: string, revision: number, approvedDigest: string): Proposal {
 const p = state.proposals.find(p => p.id === id);
 if (!p || p.status !== 'proposed' || p.revision !== revision || p.digest !== approvedDigest || p.digest !== digest(p.action)) throw new Error('Approval is stale or already used.');
 validateTarget(state,p.action);
 p.status = 'intent-recorded';
 if(p.action.type==='project.save'||p.action.type==='project.forget'||p.action.type==='work.continue'){applyProjectAction(state,p.action);p.status='succeeded';p.receipt=p.action.type==='work.continue'?'Continuation requested; prior actions will not replay.':'Project context updated on this Mac';}
 if (p.action.type.startsWith('memory.')) {
  const a = p.action;
  if (a.type === 'memory.save') state.memory.push({id:p.id,text:a.text,source:a.source,revision:1,active:true,updatedAt:new Date().toISOString()});
  if (a.type === 'memory.edit' || a.type === 'memory.forget') {
   const m = state.memory.find(m => m.id === a.memoryId)!;
   if (a.type === 'memory.edit') m.text = a.text; else m.active = false;
   m.revision++; m.updatedAt = new Date().toISOString();
  }
  p.status='succeeded'; p.receipt='Saved on this Mac';
 }
 return p;
}
export function recover(state: State) {
 for (const p of state.proposals) if (p.status === 'intent-recorded') { p.status='unknown'; p.receipt='I can’t confirm whether this happened. I won’t repeat it.'; }
}
export const actionLabel = (a: Action): string => ({'project.save':'Save project context','project.forget':'Forget project','work.continue':'Continue work','memory.save':'Save fact','memory.edit':'Update fact','memory.forget':'Forget fact','clipboard.copy':'Copy draft','url.open':'Open link','app.open':'Open app','note.save':'Save note','schedule.mutate':'Save isolated schedule change','alarm.schedule':'Schedule isolated local alarm','note.review':'Review isolated overwrite','note.review.confirm':'Confirm isolated review'}[a.type]);
