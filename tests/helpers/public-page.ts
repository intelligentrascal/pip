import { EventEmitter } from 'node:events';
import { mock } from 'node:test';
import { syncBuiltinESMExports } from 'node:module';
import dns from 'node:dns/promises';
import https from 'node:https';

export type PublicPageFixture = { source: string; addresses: {address:string;family:number}[]; contentType:string; body:string };
/** Replace network I/O only; the real reader still validates DNS and invokes its pinned lookup. */
export async function withPublicPage<T>(fixture:PublicPageFixture, run:(getCalls:()=>number)=>Promise<T>):Promise<T> {
 const resolver=mock.method(dns,'lookup',async()=>fixture.addresses);
 const get=mock.method(https,'get',((_url:unknown, options:any, consume:any)=>{
  const request=new EventEmitter() as any;
  request.destroy=(error:Error)=>{request.emit('error',error);return request;};
  queueMicrotask(()=>options.lookup(new URL(fixture.source).hostname,{all:true},(error:Error|null)=>{
   if(error){request.emit('error',error);return;}
   const response=new EventEmitter() as any;response.statusCode=200;response.headers={'content-type':fixture.contentType};
   consume(response);response.emit('data',Buffer.from(fixture.body));response.emit('end');
  }));return request;
 }) as any);
 syncBuiltinESMExports();
 try{return await run(()=>get.mock.callCount());}
 finally{resolver.mock.restore();get.mock.restore();syncBuiltinESMExports();}
}
