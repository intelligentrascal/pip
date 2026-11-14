import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskBrowsers } from '../runtime/task-browser.js';
import { browserURL, browserProxy } from '../runtime/browser-network.js';
import { browserPageURL, linkedURL, savedBrowserPage } from './helpers/browser-page.js';
import net from 'node:net';
import dns from 'node:dns/promises';
import { mock } from 'node:test';
import { syncBuiltinESMExports } from 'node:module';
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { modelBrowserTools,browserToolNames } from '../runtime/model-browser.js';

// Intent: accepted ELF-8 task-owned browser, fresh refs, private exclusive handoff,
// hostile page/network denial and Stop. Actual Chromium; no account or native input.
test('task browsers isolate storage, bound public reads and exclude agent commands during private control', {timeout:45000}, async()=>{
 let visits=0;
 const events:any[]=[];
 const owner=new TaskBrowsers(s=>events.push(s),{headless:true,fixture:{respond:url=>savedBrowserPage(url,visits++===0)}});
 let client:Client|undefined,server:ReturnType<typeof createSdkMcpServer>|undefined;
 try{
  owner.grant('read-one',[browserPageURL,linkedURL]);owner.grant('read-two',[browserPageURL]);
  assert.throws(()=>owner.grant('read-one',[browserPageURL]),/already/);
  assert.equal(owner.tools('another-task'),undefined);
  const first=owner.tools('read-one')!,second=owner.tools('read-two')!;
  const citations:any[]=[];
  server=createSdkMcpServer({name:'pip-browser',version:'1.0.0',tools:modelBrowserTools(first,source=>citations.push(source))});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.instance.connect(a);client=new Client({name:'Pip browser protocol check',version:'1.0.0'});await client.connect(b);
  assert.deepEqual((await client.listTools()).tools.map(t=>t.name).sort(),[...browserToolNames].sort());
  const denied=await client.callTool({name:'takeover',arguments:{workId:'read-two'}}).then(result=>result.isError===true,()=>true);assert.equal(denied,true);
  const response:any=await client.callTool({name:'inspect',arguments:{}});assert.notEqual(response.isError,true);
  let reading=JSON.parse(response.content[0].text);
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
  const navigated:any=await client.callTool({name:'navigate',arguments:{ref:reading.links[0].ref,revision:reading.revision}});assert.notEqual(navigated.isError,true);
  const next=JSON.parse(navigated.content[0].text);assert.equal(next.url,linkedURL);assert.equal(citations.at(-1).url,linkedURL);
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
 }finally{await client?.close();await server?.instance.close();await owner.closeAll();}
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
