import { spawn, type ChildProcess } from 'node:child_process';
import { Type } from '@earendil-works/pi-ai';
import { defineTool, type ToolRegistration } from '@earendil-works/pi-durable';

/** A local MCP server (Model Context Protocol) that Pip starts and speaks over stdin/stdout.
 * Each package the plan names ships one; its tools become Pip's tools of the conversation. */
export type McpServerSpec={name:string;label:string;command:string;args?:string[]};
export type McpSpawn=(command:string,args:readonly string[])=>ChildProcess|undefined;
export type McpOptions={spawn?:McpSpawn;initializeTimeoutMs?:number;callTimeoutMs?:number;maxResultCharacters?:number};

const PROTOCOL='2025-06-18';
const clip=(text:string,limit:number)=>text.length>limit?text.slice(0,limit)+`… (${text.length-limit} characters kept out)`:(text.length===0?'(no text output)':text);
/** One tool failure gives the model an error result it can read, never a crash. */
const reply=(text:string)=>({output:[{type:'text' as const,text}]});
type GuardedResult={output:({type:'text';text:string}|{type:'image';data:string;mimeType:string})[]};
function guarded(job:()=>Promise<GuardedResult>){return job().catch(error=>{throw new Error(error instanceof Error?error.message.slice(0,500):'The tool failed.');});}

type Pending={resolve:(value:Record<string,unknown>)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout};
type Json=Record<string,unknown>;

/** The client half of one MCP server: newline-delimited JSON-RPC over the child's stdio. */
export class McpClient {
 private child?:ChildProcess;
 private nextId=1;
 private buffer='';
 private pending=new Map<number,Pending>();
 private exitReason?:string;
 constructor(private readonly spec:McpServerSpec,private readonly options:McpOptions){}

 private lines(chunk:Buffer|Uint8Array){
  this.buffer+=chunk.toString('utf8');
  for(;;){
   const at=this.buffer.indexOf('\n');
   if(at<0)break;
   const line=this.buffer.slice(0,at).trim();this.buffer=this.buffer.slice(at+1);
   if(!line)continue;
   let message:Json;try{message=JSON.parse(line);}catch{continue;}
   const id=typeof message.id==='number'?message.id:undefined;
   if(id===undefined||!this.pending.has(id))continue;
   const p=this.pending.get(id)!;clearTimeout(p.timer);this.pending.delete(id);
   if(message.error!==undefined)p.reject(new Error(String((message.error as Json).message??'The tool server refused the request.')));
   else p.resolve((message.result??{}) as Json);
  }
 }

 private start(child:ChildProcess){
  this.child=child;
  child.stdout?.on('data',chunk=>this.lines(chunk as Buffer));
  // Server notices go to stderr; keep only enough to explain a failure, never the whole log.
  child.stderr?.on('data',()=>{});
  child.on('exit',(code,signal)=>{this.child=undefined;
   this.exitReason=`the ${this.spec.label} tool server stopped${code===null?` (${signal})`:` (exit ${code})`}`;
   for(const [,p] of this.pending){clearTimeout(p.timer);p.reject(new Error(this.exitReason));}
   this.pending.clear();
  });
  child.on('error',error=>{this.child=undefined;this.exitReason=`the ${this.spec.label} tool server could not start: ${error.message}`;});
 }

 private send(method:string,params:Json):number{
  const id=this.nextId++;
  this.child?.stdin?.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
  return id;
 }

 private request(method:string,params:Json,timeoutMs:number,signal?:AbortSignal):Promise<Json>{
  if(!this.child||this.child.exitCode!==null)throw new Error(this.exitReason??`the ${this.spec.label} tool server is not running.`);
  const id=this.send(method,params);
  return new Promise<Json>((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`${this.spec.label} did not answer within ${Math.round(timeoutMs/1000)} s.`));},timeoutMs);
   this.pending.set(id,{resolve:resolve as (value:Json)=>void,reject,timer});
   const onAbort=()=>{this.pending.delete(id);clearTimeout(timer);reject(new Error('Stopped. The run ended while this step was running.'));};
   signal?.addEventListener('abort',onAbort,{once:true});
   void signal; // kept readable above
  });
 }

 private async connect():Promise<void>{
  const spawnFn=this.options.spawn??((command,args)=>spawn(command,[...args],{stdio:['pipe','pipe','pipe']}));
  const child=spawnFn(this.spec.command,this.spec.args??[]);
  if(!child)throw new Error(this.exitReason??`the ${this.spec.label} tool server could not start.`);
  this.start(child);
  const timeout=this.options.initializeTimeoutMs??20000;
  await this.request('initialize',{protocolVersion:PROTOCOL,capabilities:{},clientInfo:{name:'pip',version:'0.1.0'}},timeout);
  this.child!.stdin?.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
 }

 /** One attempt to reach the server. A short-lived failure is retried once on the next call. */
 async ensure():Promise<void>{
  if(this.child&&this.child.exitCode===null)return;
  this.exitReason=undefined;
  const first=await this.connect().catch(error=>error instanceof Error?error.message:String(error));
  if(first!==undefined)throw new Error(first);
 }

 async listTools():Promise<{name:string;description?:string;inputSchema?:Json}[]>{
  await this.ensure();
  const result=await this.request('tools/list',{},this.options.initializeTimeoutMs??20000);
  const tools=result.tools;
  return Array.isArray(tools)?(tools as {name:string;description?:string;inputSchema?:Json}[]):[];
 }

 /** Run one tool call, honouring the run's Stop signal; the result's text and images are what the model reads. */
 async call(tool:string,command:string,arguments_:Json,signal?:AbortSignal):Promise<{output:({type:'text';text:string}|{type:'image';data:string;mimeType:string})[]}>{
  await this.ensure();
  const result=await this.request('tools/call',{name:tool,arguments:arguments_},this.options.callTimeoutMs??120000,signal);
  const content=Array.isArray(result.content)?result.content as Json[]:[];
  const limit=this.options.maxResultCharacters??100000;
  const output:({type:'text';text:string}|{type:'image';data:string;mimeType:string})[]=[];
  for(const part of content){
   if(part['type']==='image'&&typeof part['data']==='string'&&typeof part['mimeType']==='string')output.push({type:'image',data:part['data'],mimeType:part['mimeType']});
   else{const text=part['type']==='text'&&typeof part['text']==='string'?part['text']:JSON.stringify(part);output.push({type:'text',text:clip(text,limit)});}
  }
  const text=output.map(part=>part.type==='text'?part.text:'(an image was returned)').join('\n');
  if(result.isError===true)throw new Error(clip(text||`${this.spec.label} reported the step failed.`,limit));
  if(output.length===0)output.push({type:'text',text:`${this.spec.label} returned nothing.`});
  return {output};
 }

 close():void{
  const child=this.child;
  if(!child)return;
  this.child=undefined;
  for(const [,p] of this.pending){clearTimeout(p.timer);p.reject(new Error('Pip closed.'));}
  this.pending.clear();
  try{child.stdin?.end();}catch{}
  child.kill();
 }
}

/** The JSON schema an MCP tool declares, carried through to the model unchanged. */
const parameterSchema=(inputSchema?:Json)=>{
 if(!inputSchema||typeof inputSchema!=='object'||(inputSchema as Json).type!=='object')return Type.Object({input:Type.Record(Type.String(),Type.Unknown(),{description:'Arguments as the tool declares them.'})});
 return Type.Unsafe(inputSchema as Json) as unknown as typeof Type.Object;
};

export type McpTools={tools:ToolRegistration[];close():void};

/** Turn one MCP server's tools into conversation tools, each prefixed with the server's name. A server that will not
 * start registers a single plainly-worded tool instead, so the model can report the gap instead of guessing. */
export async function mcpTools(specs:readonly McpServerSpec[],options:McpOptions={}):Promise<McpTools>{
 const clients=specs.map(spec=>new McpClient(spec,options));
 const tools:ToolRegistration[]=[];
 for(const [index,spec] of specs.entries()){
  const client=clients[index];
  const prefix=spec.name.replace(/[^a-z0-9_]+/g,'_').toLowerCase();
  let listed:{name:string;description?:string;inputSchema?:Json}[]=[];
  try{listed=await client.listTools();}
  catch(reason){listed=[];client.close();
   tools.push(defineTool({name:`${prefix}_unavailable`,replay:'safe',
    description:`${spec.label}'s tools could not start on this Mac: ${reason instanceof Error?reason.message:String(reason)}. Call this to ask again; otherwise say plainly that ${spec.label} is unavailable.`,
    parameters:Type.Object({}),
    execute:()=>guarded(async()=>{
     try{await client.ensure();return reply(`${spec.label} is running again, but its tools were not loaded into this conversation. Ask the captain to restart Pip, or continue without ${spec.label}.`);}
     catch(error){return reply(`${spec.label} is unavailable: ${error instanceof Error?error.message:String(error)}.`);}
    })}));
   continue;
  }
  for(const tool of listed){
   if(typeof tool.name!=='string'||!tool.name)continue;
   const name=`${prefix}_${tool.name}`.slice(0,64);
   tools.push(defineTool({name,replay:'safe',
    description:`${spec.label}: ${typeof tool.description==='string'?tool.description:tool.name}`,
    parameters:parameterSchema(tool.inputSchema),
    execute:(args,api,context)=>guarded(async()=>await client.call(tool.name,tool.name,args as Json,context.abortSignal))}));
  }
 }
 return {tools,close:()=>{for(const client of clients)client.close();}};
}
