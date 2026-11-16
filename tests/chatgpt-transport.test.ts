import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createModels,type Context} from '@earendil-works/pi-ai';
import {openaiProvider} from '@earendil-works/pi-ai/providers/openai';
import {CHATGPT_MODEL,chatGPTPayload} from '../runtime/chatgpt-transport.js';

// Intent: ELF-26, the pinned engine must handle preview tool declarations and only accept
// completed Responses. Real engine + HTTP/SSE parser, official Responses shapes;
// this injected transport never contacts OpenAI and proves no account eligibility.
const frame=(type:string,data:object)=>`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`;
const call={type:'function_call',id:'fc_pip_protocol',call_id:'call_pip_protocol',name:'answer',arguments:JSON.stringify({kind:'draft',title:'A reply',text:'Thank you for the notes.'}),status:'completed'};
const completed=frame('response.output_item.added',{output_index:0,item:{...call,arguments:''}})+frame('response.output_item.done',{output_index:0,item:call})+frame('response.completed',{response:{status:'completed',output:[call],usage:{input_tokens:12,output_tokens:8,total_tokens:20}}});
const context:Context={systemPrompt:'You are Pip. Finish with answer.',messages:[{role:'user',content:'Write a warmer reply',timestamp:Date.now()}],tools:[{name:'answer',description:'Finish with a draft',parameters:{type:'object',properties:{kind:{type:'string'},title:{type:'string'},text:{type:'string'}},required:['kind','title','text']}}]};

test('ELF-26 actual Responses transport declares and replays tools and rejects a stream without completion',async()=>{
 const models=createModels();models.setProvider({...openaiProvider(),auth:{apiKey:{name:'Isolated HTTP fixture',resolve:async()=>({auth:{apiKey:'pip-protocol-access'}})}}});
 const model=models.getModel('openai',CHATGPT_MODEL)!;assert.ok(model);
 const payloads:any[]=[];let transportFailure:unknown;
 const request:typeof fetch=async(input,init)=>{try{
  const req=new Request(input,init);assert.equal(req.url,'https://api.openai.com/v1/responses');
  const p=await req.json();payloads.push(p);
  assert.equal(p.store,false);assert.equal(p.stream,true);
  // This model declares tools with additional_tools input, one of the preview’s two supported forms.
  const declaration=p.input.find((item:any)=>item.type==='additional_tools');assert.equal(declaration.tools[0].name,'answer');
  assert.equal(p.max_output_tokens,undefined);assert.equal(p.prompt_cache_options,undefined);
  return new Response(completed,{headers:{'content-type':'text/event-stream'}});
 }catch(error){transportFailure=error;throw error;}};
 const first=await models.completeSimple(model,context,{fetch:request,onPayload:chatGPTPayload});
 assert.equal(transportFailure,undefined);assert.equal(first.stopReason,'toolUse',first.errorMessage);assert.equal(first.content[0].type,'toolCall');
 const tool=first.content[0];if(tool.type!=='toolCall')throw Error('Missing answer tool');assert.equal(tool.arguments.text,'Thank you for the notes.');
 await models.completeSimple(model,{...context,messages:[...context.messages,first,{role:'toolResult',toolCallId:tool.id,toolName:tool.name,content:[{type:'text',text:'Acknowledged'}],isError:false,timestamp:Date.now()}]},{fetch:request,onPayload:chatGPTPayload});
 assert.equal(payloads[1].input.find((item:any)=>item.type==='function_call').name,'answer');
 const incomplete=await models.completeSimple(model,context,{onPayload:chatGPTPayload,fetch:async()=>new Response(frame('response.output_item.added',{output_index:0,item:call})+frame('response.output_item.done',{output_index:0,item:call}),{headers:{'content-type':'text/event-stream'}})});
 assert.equal(incomplete.stopReason,'error');assert.ok(incomplete.errorMessage);
});
