import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { validateURL, type Source } from './domain.js';

export class PublicResponseTimeout extends Error {
 constructor(){super('Public response exceeded its time limit');this.name='PublicResponseTimeout';}
}

export function publicAddress(address: string): boolean {
 if (isIP(address) === 4) {
  const [a,b] = address.split('.').map(Number);
  return !(a===0 || a===10 || a===127 || a>=224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&[0,2,168].includes(b)) || (a===198&&[18,19,51].includes(b)) || (a===203&&b===0) || (a===100&&b>=64&&b<=127));
 }
 // Only global unicast IPv6; reject documentation, transition and mapped ranges.
 return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^(2001:(db8|0|10|20):|2002:)/i.test(address);
}
export async function resolvePublic(raw: string) {
 const url = new URL(validateURL(raw));
 const host = url.hostname.replace(/^\[|\]$/g,'');
 const addresses = await lookup(host,{all:true});
 if (!addresses.length || addresses.some(a=>!publicAddress(a.address))) throw new Error('This address is not a public web source.');
 return { url, address:addresses[0] };
}
type SourceReference = { version: number; url: string; offset: number; digest: string };
function sourceReference(value?:string):SourceReference|undefined {
 if(value===undefined)return;
 try {
  if(typeof value!=='string'||value.length>4096)throw new Error();
  const ref=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
  if(!ref||ref.version!==1||Object.keys(ref).sort().join(',')!=='digest,offset,url,version'||!Number.isSafeInteger(ref.offset)||ref.offset<1||ref.offset>750000||typeof ref.digest!=='string'||!/^[a-f0-9]{64}$/.test(ref.digest))throw new Error();
  validateURL(ref.url);return ref;
 }catch{throw new Error('That source continuation is invalid. Open the source again.');}
}
export async function readPublicURL(raw: string, continuation?:string, redirects = 0): Promise<Source> {
 if (redirects>4) throw new Error('Too many redirects');
 const ref=sourceReference(continuation);
 if(ref&&validateURL(raw)!==ref.url)throw new Error('This continuation belongs to a different source URL.');
 const {url,address} = await resolvePublic(raw);
 const response = await new Promise<{status:number; location:string; type:string; body:string}>((resolve,reject)=>{
  let deadline:ReturnType<typeof setTimeout>|undefined;
  const fail=(error:Error)=>{if(deadline)clearTimeout(deadline);reject(error);};
  const request = https.get(url,{timeout:12000, headers:{'User-Agent':'Pip/0.1 public research','Accept':'text/html,text/plain'}, lookup: (_host, options, cb) => {
   // Node's connection racing requests all addresses. Keep the same validated
   // DNS pin, but honour the callback shape instead of resolving the host again.
   if (options.all) cb(null,[address]);
   else cb(null,address.address,address.family);
  }}, res=>{
   const chunks: Buffer[]=[]; let size=0;
   res.on('data', chunk=>{size+=chunk.length; if(size>750000) request.destroy(new Error('Page is too large')); else chunks.push(chunk);});
   res.on('end',()=>{if(deadline)clearTimeout(deadline);resolve({status:res.statusCode??0,location:String(res.headers.location??''),type:String(res.headers['content-type']??''),body:Buffer.concat(chunks).toString('utf8')});});
   res.on('error',fail);
  });
  request.on('timeout',()=>request.destroy(new Error('Public page timed out'))); request.on('error',fail);
  deadline=setTimeout(()=>{const error=new PublicResponseTimeout();fail(error);request.destroy(error);},12000);
 });
 if ([301,302,303,307,308].includes(response.status)) return readPublicURL(new URL(response.location,url).href,continuation,redirects+1);
 if (response.status!==200 || !/^(text\/html|text\/plain)/i.test(response.type)) throw new Error('That page is unavailable or is not readable text.');
 const title = response.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? url.hostname;
 const extracted = /^text\/plain/i.test(response.type) ? response.body : response.body.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
 const body=extracted.replace(/\s+/g,' ').trim();
 const digest=createHash('sha256').update(body).digest('hex');
 if(ref&&(ref.digest!==digest||ref.offset>=body.length))throw new Error('The source changed since that reference. Open it again before continuing.');
 const offset=ref?.offset??0;let end=Math.min(offset+24000,body.length);
 if(end<body.length&&body.charCodeAt(end-1)>=0xD800&&body.charCodeAt(end-1)<=0xDBFF)end--;
 const next=end<body.length?Buffer.from(JSON.stringify({version:1,url:url.href,offset:end,digest})).toString('base64url'):undefined;
 return {id:randomUUID(),url:url.href,title:title.slice(0,250),fetchedAt:new Date().toISOString(),text:body.slice(offset,end),offset,totalCharacters:body.length,truncated:next!==undefined,...(next?{continuation:next}:{})};
}
export async function searchPublicWeb(query: string): Promise<Source> {
 return readPublicURL('https://html.duckduckgo.com/html/?q='+encodeURIComponent(query.slice(0,500)));
}
