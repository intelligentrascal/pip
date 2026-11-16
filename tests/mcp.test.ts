import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mcpTools } from '../runtime/mcp.js';
import { AUTOMATION_SERVERS } from '../runtime/mac-tools.js';

// Intent: ELF-56 piece 4 — the plan's automation packages (Playwright MCP, Peekaboo, Automator MCP) become tools of
// Pip's conversation through one MCP stdio adapter. The stub server speaks the real protocol; the real packages are
// started once to prove the exact versions answer the same frames.

const stub=fileURLToPath(new URL('./fixtures/mcp-stub.mjs',import.meta.url));
const noContext={abortSignal:undefined} as never;
const callTool=async(tool:ToolRegistrationShape,args:Record<string,unknown>)=>await tool.execute(args as never,undefined as never,noContext) as {output:{type:'text';text:string}[]};
type ToolRegistrationShape={name:string;description:string;parameters:unknown;execute:(args:never,api:never,context:never)=>Promise<unknown>};

test('the adapter lists an MCP server\'s tools with their declared names and schemas',async()=>{
 const {tools,close}=await mcpTools([{name:'stub',label:'Stub',command:process.execPath,args:[stub]}]);
 try{
  assert.deepEqual(tools.map(t=>t.name).sort(),['stub_browser_fill_form','stub_browser_navigate','stub_echo','stub_fail']);
  const echo=tools.find(t=>t.name==='stub_echo')!;
  assert.match(echo.description,/Echo the given text back\./);
  // The MCP tool's JSON schema is carried through to the model unchanged.
  const schema=echo.parameters as {type:string;properties:Record<string,{type:string}>;required:string[]};
  assert.equal(schema.type,'object');assert.equal(schema.properties.text.type,'string');assert.deepEqual(schema.required,['text']);
 }finally{close();}
});

test('a tool call returns the server\'s text, and an error result fails with the server\'s own words',async()=>{
 const {tools,close}=await mcpTools([{name:'stub',label:'Stub',command:process.execPath,args:[stub]}]);
 try{
  const echo=tools.find(t=>t.name==='stub_echo')!;
  const result=await callTool(echo as unknown as ToolRegistrationShape,{text:'Tea, please.'});
  assert.equal(result.output[0].text,'echo: Tea, please.');
  const fail=tools.find(t=>t.name==='stub_fail')!;
  await assert.rejects(()=>callTool(fail as unknown as ToolRegistrationShape,{reason:'the page refused'}),/stub failed: the page refused/);
 }finally{close();}
});

test('a server that will not start registers one plainly-worded tool that reports the reason',async()=>{
 const {tools,close}=await mcpTools([{name:'broken',label:'Broken',command:process.execPath,args:['-e','process.exit(3)']}]);
 try{
  assert.deepEqual(tools.map(t=>t.name),['broken_unavailable']);
  const unavailable=await callTool(tools[0] as unknown as ToolRegistrationShape,{});
  assert.match(unavailable.output[0].text,/Broken is unavailable:/);
  assert.match(unavailable.output[0].text,/stopped \(exit 3\)/);
 }finally{close();}
});

test('the three real automation packages answer the same frames at their pinned versions',{timeout:90000},async()=>{
 for(const spec of AUTOMATION_SERVERS){
  const entry=({playwright:'@playwright/mcp/cli.js',peekaboo:'@steipete/peekaboo/peekaboo-mcp.js',automator:'automator-mcp/src/index.js'})[spec.name]!;
  const {tools,close}=await mcpTools([{name:spec.name,label:spec.label,command:process.execPath,
   args:[fileURLToPath(new URL(`../node_modules/${entry}`,import.meta.url))]}],{initializeTimeoutMs:45000});
  try{
   assert.ok(tools.length>0,`${spec.name} exposes tools`);
   assert.ok(tools.every(t=>t.name.startsWith(spec.name+'_')),`${spec.name} tools carry the server's name`);
  }finally{close();}
 }
});

