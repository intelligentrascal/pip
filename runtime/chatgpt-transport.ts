import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';

// ELF-24/26: ChatGPT plan access for this locally hosted app. Sign-in is pi-ai's own
// openaiChatGPTOAuth, shipped by its OpenAI provider; Pip only adds the preview's HTTP rules.
// Current OpenAI registration/preview rules: https://developers.openai.com/siwc/token-sharing-open-source
export const CHATGPT_MODEL='gpt-6.1-sol';

/** Apply the preview’s HTTP rules to the engine’s assembled request, including tools. */
export function chatGPTPayload(raw:unknown){
 const p={...(raw as Record<string,unknown>)};
 for(const field of ['background','conversation','max_output_tokens','max_tool_calls','metadata','moderation','multi_agent','prompt','prompt_cache_retention','prompt_cache_options','safety_identifier','temperature','top_logprobs','top_p','truncation','user','previous_response_id'])delete p[field];
 p.store=false;p.stream=true;
 if(Array.isArray(p.input))p.input=p.input.map(item=>item.role==='system'?{...item,role:'developer'}:item);
 if(Array.isArray(p.tools)&&p.tools.length)p.tools=[{type:'namespace',name:'pip',description:'Pip’s app-owned tools.',tools:p.tools}];
 return p;
}

/** pi-ai's OpenAI provider, with its sign-in untouched and the preview's rules on every request,
 * including the ones the conversation engine makes for itself. */
export function chatGPTProvider(){
 const base=openaiProvider();
 type Options={onPayload?:(payload:unknown,model:never)=>unknown}|undefined;
 const rules=(options:Options)=>({...options,onPayload:async(payload:unknown,model:never)=>chatGPTPayload((await options?.onPayload?.(payload,model))??payload)});
 return {...base,
  stream:((model:never,context:never,options:never)=>base.stream(model,context,rules(options) as never)) as typeof base.stream,
  streamSimple:((model:never,context:never,options:never)=>base.streamSimple(model,context,rules(options) as never)) as typeof base.streamSimple};
}
