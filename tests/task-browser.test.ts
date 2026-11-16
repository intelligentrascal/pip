import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskBrowsers } from '../runtime/task-browser.js';
import { browserURL, browserProxy } from '../runtime/browser-network.js';
import { browserPageURL, linkedURL, savedBrowserPage } from './helpers/browser-page.js';
import net from 'node:net';
import dns from 'node:dns/promises';
import { mock } from 'node:test';
import { syncBuiltinESMExports } from 'node:module';
import { pipTools, type ActiveRun } from '../runtime/pip-tools.js';
import { openHost } from '../runtime/pi-durable-adapter.js';
import { fauxEngine, said, calls } from './helpers/faux-engine.js';
import { testHome, until, finished } from './helpers/ask.js';

/** The model's browser tools, called as the conversation calls them: by name, with a failure thrown to the model. */
function modelBrowser(browser:NonNullable<ActiveRun['browser']>){
 const run:ActiveRun={workId:'read-one',sources:[],browser,check:async()=>{}};
 const tools=pipTools(()=>run);
 const call=async(name:string,args:Record<string,unknown>)=>{
  const tool=tools.find(t=>t.name===name);if(!tool)throw new Error('No such tool: '+name);
  const result=await (tool as unknown as {execute:(a:unknown,api:unknown,ctx:unknown)=>Promise<{output:{type:string;text:string}[]}>}).execute(args,{},{});
  return JSON.parse(result.output[0].text);
 };
 return {call,tools,citations:run.sources};
}

// Intent: accepted ELF-8 task-owned browser, fresh refs, private exclusive handoff,
// hostile page/network denial and Stop. Actual Chromium; no account or native input.
test('task browsers isolate storage, bound public reads and exclude agent commands during private control', {timeout:45000}, async()=>{
 let visits=0;
 const events:any[]=[];
 const owner=new TaskBrowsers(s=>events.push(s),{headless:true,fixture:{respond:url=>savedBrowserPage(url,visits++===0)}});
 try{
  owner.grant('read-one',[browserPageURL,linkedURL]);owner.grant('read-two',[browserPageURL]);
  assert.throws(()=>owner.grant('read-one',[browserPageURL]),/already/);
  assert.equal(owner.tools('another-task'),undefined);
  const first=owner.tools('read-one')!,second=owner.tools('read-two')!;
  const model=modelBrowser(first),citations=model.citations;
  for(const name of ['inspect','navigate','scroll'])assert.ok(model.tools.some(t=>t.name===name),name+' is a tool of the conversation');
  assert.equal(model.tools.some(t=>t.name==='takeover'),false,'private control is never a model tool');
  await assert.rejects(model.call('takeover',{workId:'read-two'}),/No such tool/);
  let reading=await model.call('inspect',{});
  assert.equal(citations[0].url,browserPageURL);
  assert.match(reading.text,/@earendil-works\/pi-durable/);
  assert.match(reading.text,/Task-local note: Read the durable harness introduction; cookie: readingNote=durable/);
  const unrelated=await second.inspect();
  assert.match(unrelated.text,/Task-local note: none; cookie:\s/);
  assert.ok(!unrelated.text.includes('Read the durable harness introduction; cookie: readingNote=durable'));
  // Read after real fetch settlements; DOM event, not sleep/retry. Inspection itself
  // sees the initial document; the next native browser protocol round trip observes traps.
  reading=await first.inspect();assert.match(reading.text,/POST blocked; private blocked/);
  assert.equal(reading.links.length,1,'An unreviewed page never becomes an admitted link ref');
  const old=reading;
  await assert.rejects(second.navigate(old.links[0].ref,unrelated.revision),/expired/);
  await first.scroll('down',reading.revision);
  await assert.rejects(first.navigate(old.links[0].ref,old.revision),/expired/);
  reading=await first.inspect();
  const next=await model.call('navigate',{ref:reading.links[0].ref,revision:reading.revision});assert.equal(next.url,linkedURL);assert.equal(citations.at(-1).url,linkedURL);
  const frame=await owner.watch('read-one');assert.ok(Buffer.from(frame.frame,'base64').length>1000);
  await owner.takeOver('read-one');
  assert.equal(owner.state('read-one').driver,'captain');
  for(const command of [()=>first.inspect(),()=>first.scroll('down',next.revision),()=>first.navigate(reading.links[0].ref,reading.revision),()=>owner.watch('read-one')])await assert.rejects(command(),/cannot use/);
  await owner.returnControl('read-one');
  await assert.rejects(first.scroll('down',owner.state('read-one').revision),/expired/);
  const fresh=await first.inspect();assert.ok(fresh.revision>next.revision);
  const during=first.inspect();const takeover=owner.takeOver('read-one');
  await assert.rejects(during,/control|captain|Control/);await takeover;
  assert.equal(owner.state('read-one').driver,'captain');
  await owner.close('read-one');await owner.close('read-one');await assert.rejects(first.inspect(),/cannot use/);
  assert.equal(owner.tools('read-one'),undefined,'Closed scope cannot be supplied to a new worker');
  assert.match(owner.state('read-one').activity,/discarded/);
  assert.equal(owner.state('read-two').driver,'pip','Stop one browser does not stop another task');
  assert.ok(events.some(s=>s.frameAt),'Actual successful capture publishes frame freshness, not a premature success label');
  assert.ok(!JSON.stringify(events).includes('@earendil-works/pi-durable'),'No page body or frame in activity metadata');
 }finally{await owner.closeAll();}
});

// Intent: ELF-8 keeps passwords and verification private, including Watch frames.
// The genuine captured README receives an explicit disposable sign-in trap;
// this is not account access or proof of a provider sign-in.
test('sign-in and verification fields refuse agent inspection and Watch capture', {timeout:15000},async()=>{
 const states:any[]=[];
 const browser=new TaskBrowsers(state=>states.push(state),{headless:true,fixture:{respond:url=>{const saved=savedBrowserPage(url);return saved?{...saved,body:saved.body+'<label>Password <input type="password" value="disposable test password"></label><label>Verification <input autocomplete="one-time-code" value="123456"></label>'}:undefined;}}});
 try{
  browser.grant('private-challenge',[browserPageURL]);
  await assert.rejects(browser.tools('private-challenge')!.inspect(),/private takeover/);
  await assert.rejects(browser.watch('private-challenge'),/private takeover/);
  assert.equal(states.some(state=>state.frameAt),false);
  assert.equal(JSON.stringify(states).includes('disposable test password'),false);
 }finally{await browser.closeAll();}
});

// Intent: ELF-8 public HTTPS/DNS/private-network guard. Real CONNECT interface;
// captured public DNS fixture is in the public reader suite; this adverse fixture
// represents a host whose answers rebind to loopback. No outbound socket is made.
test('browser proxy rejects unreviewed hosts and private DNS at the connection boundary', {timeout:10000},async()=>{
 for(const url of ['http://example.com','https://user:pass@example.com','https://127.0.0.1','https://[::1]','file:///tmp/note','https://example.com:8443'])assert.throws(()=>browserURL(url));
 const dnsMock=mock.method(dns,'lookup',async()=>[{address:'127.0.0.1',family:4}]);
 syncBuiltinESMExports();
 const proxy=await browserProxy(['https://example.com/']);
 const request=async(host:string)=>new Promise<string>((resolve,reject)=>{
  const u=new URL(proxy.url);const socket=net.connect({host:u.hostname,port:Number(u.port)});let reply='';
  socket.setTimeout(2000,()=>{socket.destroy();reject(Error('Proxy did not refuse within its deadline'));});
  socket.on('connect',()=>socket.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`));socket.on('data',chunk=>reply+=chunk);socket.on('error',reject);socket.on('close',()=>resolve(reply));
 });
 try{assert.equal(await request('example.com'),'');assert.equal(await request('unreviewed.example'),'');}finally{await proxy.close();dnsMock.mock.restore();syncBuiltinESMExports();}
});

// Intent: ELF-56 the task browser is one of the conversation's tools: a model that inspects the granted page cites it, with no takeover path.
test('the conversation reads a granted page through the inspect tool and cites it', {timeout:45000}, async()=>{
 const owner=new TaskBrowsers(()=>{},{headless:true,fixture:{respond:url=>savedBrowserPage(url,false)}});
 const home=await testHome('pip-browser-tool-');const {faux,engine}=fauxEngine();
 faux.setResponses([calls(['inspect',{}]),ctx=>{
  const result=ctx.messages.find(m=>m.role==='toolResult');assert.ok(result,'the reading reaches the model as a tool result');
  return said('The page introduces the durable harness.');}]);
 const host=await openHost({home,fixture:true,engine,browser:id=>owner.tools(id)});
 try{
  owner.grant('read-page',[browserPageURL]);
  await host.submit('read-page','Read this page and summarise it.',undefined,undefined,undefined,true);
  const state=await until(host,finished('read-page'));const work=state.works[0];
  assert.equal(work.status,'Done');assert.equal(work.result?.sources[0].url,browserPageURL);assert.match(work.result!.sources[0].text,/@earendil-works\/pi-durable/);
  assert.equal(faux.state.callCount,2);
 }finally{await host.close();await owner.closeAll();}
});
