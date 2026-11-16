import { test } from 'node:test';
import type { AssistantMessage, FauxResponseStep, Message } from '@earendil-works/pi-ai';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { openHost } from '../runtime/pi-durable-adapter.js';
import { AXI_TOOLS, AUTOMATION_SERVERS, macTools } from '../runtime/mac-tools.js';
import { fauxEngine, said, calls } from './helpers/faux-engine.js';
import { testHome, ask, until, finished } from './helpers/ask.js';

// Intent: ELF-56 piece 4, builder spec item 5 — every ability is a tool of the one conversation: pi's files and
// shell (read, write, edit, bash), the plan's automation packages, and the axi command-line tools. The Mac is a
// stand-in: files land in the isolated test home and automation servers are the protocol stub, never a live browser.

const stub=fileURLToPath(new URL('./fixtures/mcp-stub.mjs',import.meta.url));
const seen:string[]=[];
const spy=(ctx:{messages:Message[]}):undefined=>{seen.push(JSON.stringify(ctx.messages));return undefined;};
type RawTool={name:string;description:string;execute:(args:never,api:never,context:never)=>Promise<{output:{type:'text';text:string}[]}>};
const runTool=(tool:{execute:unknown},args:Record<string,unknown>)=>(tool.execute as RawTool['execute'])(args as never,undefined as never,{abortSignal:undefined} as never);

test('the conversation\'s files and shell tools run inside the isolated test home',{timeout:60000},async()=>{
 const home=await testHome('pip-mac-');
 const {faux,engine}=fauxEngine();
 faux.setResponses([
  calls(['bash',{command:'pwd'}]),
  calls(['write',{path:'notes/tea.txt',content:'Two sugars.'}]),
  calls(['read',{path:'notes/tea.txt'}]),
  (ctx:Parameters<FauxResponseStep>[0])=>{spy(ctx);return said('Saved two sugars in notes/tea.txt.');},
 ]);
 const work=await ask(home,'Keep a note about tea in notes/tea.txt, read it back, and tell me where you are.',{engine});
 assert.equal(work.status,'Done',work.error??'');
 assert.equal(await readFile(path.join(home,'notes','tea.txt'),'utf8'),'Two sugars.','write made the file in the test home');
 // The shell starts at the test home, not the project or the app bundle.
 const pwd=seen.find(s=>s.includes('"command":"pwd"'));
 assert.ok(pwd?.includes(home),'bash pwd saw the test home');
 // What the file tools read reached the model as a tool result.
 assert.ok(seen.some(s=>s.includes('Two sugars.')),'the read result reached the model');
});

test('a stand-in automation server\'s tools join the conversation and answer',{timeout:60000},async()=>{
 const home=await testHome('pip-macmcp-');
 const {faux,engine}=fauxEngine();
 const local:string[]=[];
 faux.setResponses([
  calls(['stub_browser_navigate',{url:'https://example.test/form'}]),
  calls(['stub_browser_fill_form',{fields:{name:'Ana'}}]),
  (ctx:Parameters<FauxResponseStep>[0])=>{local.push(JSON.stringify(ctx.messages));return said('Filled the form in the stand-in browser.');},
 ]);
 let host:Awaited<ReturnType<typeof openHost>>|undefined;
 try{
  host=await openHost({home,fixture:true,engine,retry:{maxRetries:0},mac:{servers:[{name:'stub',label:'Stub',command:process.execPath,args:[stub]}]}});
  await host.submit('a','Open the form page and fill it in.');
  const state=await until(host,finished('a'));
  assert.equal(state.works[0].status,'Done',state.works[0].error??'');
  assert.ok(local.some(s=>s.includes('Opened https://example.test/form')),'the stand-in browser\'s answer reached the model');
  assert.ok(local.some(s=>s.includes('Filled the form: name')),'the stand-in form tool\'s answer reached the model');
 }finally{await host?.close();}
});

test('the plan\'s automation servers and the file tools are wired into one tool set',{timeout:120000},async()=>{
 // Production wiring: a non-fixture home starts the three real MCP servers, each carrying its server's name.
 assert.deepEqual(AUTOMATION_SERVERS.map(s=>s.name),['playwright','peekaboo','automator']);
 const {tools,close}=await macTools({baseDir:os.tmpdir(),servers:[{name:'stub',label:'Stub',command:process.execPath,args:[stub]}]});
 try{
  for(const name of ['read','write','edit','bash'])assert.ok(tools.some(t=>t.name===name),name+' is in the tool set');
  assert.ok(tools.some(t=>t.name==='stub_echo'),'the automation server\'s tools join them');
  // The named outward tools are the adapter's own; they stay in the conversation beside these abilities.
  assert.ok(!tools.some(t=>t.name==='send_message'),'mac tools add no second send tool');
 }finally{close();}
});

test('an axi tool runs its program with the given arguments; an absent one says so',async()=>{
 const sandbox=process.env.PIP_TEST_ROOT??path.join(os.tmpdir(),'pip-axi-fixtures');
 await mkdir(sandbox,{recursive:true});
 const bin=await mkdtemp(path.join(sandbox,'pip-axi-'));
 const program=path.join(bin,AXI_TOOLS[0]!.program);
 await writeFile(program,'#!/bin/sh\nprintf \'ARGS:\';for a in "$@";do printf \' %s\' "$a";done;printf \'\\n\'\n');
 await chmod(program,0o755);
 const {tools,close}=await macTools({baseDir:bin,searchPath:[bin]});
 try{
  const integrations=tools.find(t=>t.name==='axi_integrations')!;
  assert.match((integrations as unknown as RawTool).description,/Run infinitary-integrations-axi/);
  const result=await runTool(integrations,{arguments:['call','notion','read','{"page":"plan"}']});
  assert.equal(result.output[0].text,'ARGS: call notion read {"page":"plan"}');
  const empty=await mkdtemp(path.join(sandbox,'pip-axi-none-'));
  const absent=await macTools({baseDir:empty,searchPath:[empty]});
  try{
   const browser=absent.tools.find(t=>t.name==='axi_browser')!;
   const reply=await runTool(browser,{arguments:[]});
   assert.match(reply.output[0].text,/not installed on this Mac/);
  }finally{absent.close();}
 }finally{close();}
});

// The conversation's environment, wired in the adapter, resolves relative paths at the home it was built for.
test('the node environment resolves relative paths at the base it was given',async()=>{
 const base=process.env.PIP_TEST_ROOT??os.tmpdir();
 const env=new NodeExecutionEnv({cwd:base});
 const resolved=await env.absolutePath('notes/tea.txt',undefined as never);
 assert.ok(resolved.ok&&resolved.value.startsWith(base),String(resolved.ok?resolved.value:'unresolved'));
});
