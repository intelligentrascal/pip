import { query, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { Memory, Result, Source, ProviderRequestContext } from './domain.js';
import { text, validateAction } from './domain.js';
import { backendToolNames } from './model-backends.js';
import { pipToolGroups, systemPrompt } from './prompt.js';
import { modelPrompt } from './context-prompt.js';
import { browserToolNames } from './model-browser.js';

class ClaudeStatusError extends Error {}
export function safeClaudeFailure(error:unknown):Error&{code?:'sign-in-required'} {
 if(error instanceof ClaudeStatusError)return error;
 const status=error&&typeof error==='object'&&'status' in error?error.status:undefined;
 if(status===401||error instanceof Error&&/not logged in|not signed in|please sign in/i.test(error.message))return Object.assign(new Error('Claude is not signed in. Use your existing Claude connection; no other provider was tried.'),{code:'sign-in-required' as const});
 return new Error('Claude could not finish. Your request is saved; no action was taken.');
}

export type Provider = (request: string, memory: Memory[], signal: AbortSignal, context?: ProviderRequestContext) => Promise<Result>;
export const disabledProvider: Provider = async () => { throw new Error('Claude is not connected yet. Your request is saved. Live account checks need your Allow choice.'); };
export function claudeProvider(allowed: boolean, executable: string): Provider {
 if (!allowed) return disabledProvider;
 return async (request, memory, signal, context) => {
  const controller = new AbortController();
  const abort = () => controller.abort(); signal.addEventListener('abort',abort,{once:true});
  let timedOut=false;
  const timeout = setTimeout(()=>{timedOut=true;abort();},180000);
  const sources: Source[]=[];
  const groups=pipToolGroups(context,sources);
  const server = createSdkMcpServer({name:'pip-public',version:'1.0.0',tools:groups.public});
  const browser=groups.browser?createSdkMcpServer({name:'pip-browser',version:'1.0.0',tools:groups.browser}):undefined;
  const isolated=groups.isolated?createSdkMcpServer({name:'pip-isolated',version:'1.0.0',tools:groups.isolated}):undefined;
  try {
   const response = query({prompt:modelPrompt(request,context), options:{
    pathToClaudeCodeExecutable:executable, model:'sonnet', cwd:process.env.PIP_MODEL_CWD ?? '/tmp', settingSources:[], persistSession:false, stderr:()=>{},
    ...(context?{sessionId:context.sessionId}:{}),
    tools:[], mcpServers:{'pip-public':server,...(browser?{'pip-browser':browser}:{}),...(isolated?{'pip-isolated':isolated}:{})}, allowedTools:['mcp__pip-public__read_public_url','mcp__pip-public__search_public_web',...(browser?browserToolNames.map(name=>'mcp__pip-browser__'+name):[]),...(isolated?backendToolNames.map(name=>'mcp__pip-isolated__'+name):[])],
    canUseTool: async () => ({behavior:'deny',message:'Only Pip’s read-only public research tools are available.'}),
    abortController:controller, maxTurns:8, includePartialMessages:false,
    systemPrompt:systemPrompt('Claude',memory,context,'Return a JSON object: kind (answer or draft), title, text, and optional proposal.'),
    outputFormat:{type:'json_schema',schema:{type:'object',properties:{kind:{type:'string',enum:['answer','draft']},title:{type:'string'},text:{type:'string'},proposal:{type:'object',additionalProperties:true}},required:['kind','title','text'],additionalProperties:false}}
   }});
   let result: Result|undefined; let model='Claude Sonnet'; let sessionId='';
   for await (const message of response) {
    if (message.type==='system' && message.subtype==='init') { model=message.model; sessionId=message.session_id; }
    if (message.type==='result') {
     if(message.subtype==='error_max_turns')throw Object.assign(new ClaudeStatusError('Claude reached this episode’s turn boundary. Review progress before continuing.'),{code:'provider-cutoff'});
     if (message.is_error || message.subtype!=='success') throw new ClaudeStatusError('Claude could not finish. Your request is saved; no action was taken.');
     const parsed = message.structured_output as Record<string,unknown>|undefined;
     if (!parsed || !['answer','draft'].includes(String(parsed.kind))) throw new ClaudeStatusError('Claude returned an unreadable answer. Your request is saved.');
     result = {...(context?.screen?{screenSource:structuredClone(context.screen.descriptor)}:{}),kind:parsed.kind as 'answer'|'draft',title:text(parsed.title,'title',500),text:text(parsed.text),sources,model,sessionId};
     if (parsed.proposal) result.proposal=validateAction(parsed.proposal);
    }
   }
   if (!result) throw Object.assign(new ClaudeStatusError('Claude made no usable progress. Review the task before continuing.'),{code:'no-progress'});
   return result;
  } catch(error) { if(timedOut)throw Object.assign(new ClaudeStatusError('Claude reached this episode’s time boundary. Review progress before continuing.'),{code:'provider-cutoff'});throw safeClaudeFailure(error); } finally {clearTimeout(timeout); signal.removeEventListener('abort',abort);}
 };
}
