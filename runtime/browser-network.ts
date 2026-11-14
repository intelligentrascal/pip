import http from 'node:http';
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import { publicAddress } from './public-web.js';

export function browserURL(raw:unknown):string {
 if(typeof raw!=='string'||raw.length>4000||/[\u0000-\u0020\u007f]/.test(raw))throw Error('Choose a public HTTPS page.');
 const u=new URL(raw);
 if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||u.hash)throw Error('Choose a public HTTPS page without credentials or a fragment.');
 if(u.hostname==='localhost'||u.hostname.endsWith('.localhost')||u.hostname.endsWith('.local')||net.isIP(u.hostname.replace(/^\[|\]$/g,''))&&!publicAddress(u.hostname.replace(/^\[|\]$/g,'')))throw Error('Private network destinations are not allowed.');
 return u.href;
}

// Chromium uses this CONNECT-only proxy for every origin, including loopback.
// Validate every DNS answer, then connect to that exact address: a second browser
// DNS lookup cannot turn a public check into a private-network connection.
export async function browserProxy(pages:string[]) {
 const hosts=new Set(pages.map(page=>new URL(page).hostname));
 const sockets=new Set<net.Socket>();
 const server=http.createServer((_req,res)=>{res.writeHead(403);res.end();});
 server.on('connect',(req,client,head)=>{
  const socket=client as net.Socket;sockets.add(socket);socket.on('error',()=>socket.destroy());socket.on('close',()=>sockets.delete(socket));
  void (async()=>{
   const u=new URL('https://'+req.url);
   browserURL(u.href);
   if(!hosts.has(u.hostname))throw Error('unreviewed host');
   if(u.port&&u.port!=='443')throw Error('port');
   const host=u.hostname.replace(/^\[|\]$/g,'');
   const answers=await lookup(host,{all:true});
   if(!answers.length||answers.some(a=>!publicAddress(a.address)))throw Error('private');
   if(socket.destroyed)return;
   const upstream=net.connect({host:answers[0].address,port:443});sockets.add(upstream);
   upstream.setTimeout(15000,()=>upstream.destroy());upstream.on('error',()=>socket.destroy());
   upstream.on('close',()=>{sockets.delete(upstream);socket.destroy();});socket.on('close',()=>upstream.destroy());
   upstream.once('connect',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);});
  })().catch(()=>socket.destroy());
 });
 server.on('error',()=>{for(const socket of sockets)socket.destroy();});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
 const address=server.address() as net.AddressInfo;
 return {url:`http://127.0.0.1:${address.port}`,close:async()=>{for(const s of sockets)s.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
