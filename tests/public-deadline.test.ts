import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import dns from 'node:dns/promises';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { readPublicURL, PublicResponseTimeout } from '../runtime/public-web.js';
const fixture=JSON.parse(await readFile(new URL('./fixtures/public-readme.json',import.meta.url),'utf8'));

// Intent: V1-SPEC public reads enforce time bounds even if an endpoint drips data.
// Real captured page bytes feed a mock socket that faithfully resets its idle timeout.
test('A6 public response has an absolute deadline despite continuing data',async()=>{
 mock.timers.enable({apis:['setTimeout']});
 const resolver=mock.method(dns,'lookup',async()=>fixture.addresses);
 let feed:()=>void=()=>{};let request:any;let idle:ReturnType<typeof setTimeout>|undefined;let limit=0;let cursor=0;let destroyed=false;
 const get=mock.method(https,'get',((_url:unknown,options:any,consume:any)=>{
  limit=options.timeout;request=new EventEmitter();
  request.destroy=(error:Error)=>{if(destroyed)return;destroyed=true;if(idle)clearTimeout(idle);request.emit('error',error);};
  queueMicrotask(()=>{
   const response=new EventEmitter() as any;response.statusCode=200;response.headers={'content-type':fixture.contentType};consume(response);
   feed=()=>{if(destroyed)return;response.emit('data',Buffer.from(fixture.body.slice(cursor,cursor+1)));cursor++;if(idle)clearTimeout(idle);idle=setTimeout(()=>request.emit('timeout'),limit);};
  });return request;
 }) as any);
 syncBuiltinESMExports();let outcome:Error|undefined;
 const pending=readPublicURL(fixture.source).catch(error=>{outcome=error;});
 try{
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(limit>0);
  for(let elapsed=1000;elapsed<limit;elapsed+=1000){feed();mock.timers.tick(1000);await Promise.resolve();}
  assert.equal(outcome,undefined,'Continuing data must not fail before the deadline');
  feed();mock.timers.tick(1000);await new Promise(resolve=>setImmediate(resolve));
  assert.ok(outcome instanceof PublicResponseTimeout,'The absolute deadline must fail with the typed timeout reason');
  await pending;
 }finally{
  request?.destroy(new Error('Fixture socket closed'));if(idle)clearTimeout(idle);
  resolver.mock.restore();get.mock.restore();syncBuiltinESMExports();mock.timers.reset();
 }
});
