import {text} from './domain.js';

export type ScreenContextRef={id:string;revision:number};
export type ScreenContextDescriptor=ScreenContextRef&{app:string;capturedAt:string;width:number;height:number;mode:'image'|'text'};
export type SharedScreenContext={descriptor:ScreenContextDescriptor;content:{type:'image';mediaType:'image/png'|'image/jpeg';data:string}|{type:'text';text:string}};
export const maxScreenImageBytes=480000;
function record(input:unknown):Record<string,unknown>{if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid window context');return input as Record<string,unknown>;}
function keys(input:Record<string,unknown>,allowed:string[]){if(Object.keys(input).some(key=>!allowed.includes(key)))throw Error('Unexpected window context field');}
export function screenRef(input:unknown):ScreenContextRef{
 const value=record(input);keys(value,['id','revision']);
 const id=text(value.id,'window context ID',100);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)||!Number.isSafeInteger(value.revision)||(value.revision as number)<1)throw Error('Invalid window context reference');
 return {id,revision:value.revision as number};
}
export function screenImageSize(bytes:Buffer,mediaType:'image/png'|'image/jpeg'):{width:number;height:number}{
 if(mediaType==='image/png'){
  if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR')throw Error('Invalid window image');
  return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
 }
 if(bytes.length<4||bytes[0]!==255||bytes[1]!==216)throw Error('Invalid window image');
 let offset=2;
 while(offset+4<=bytes.length){
  if(bytes[offset++]!==255)throw Error('Invalid window image');
  while(bytes[offset]===255)offset++;
  const marker=bytes[offset++];
  if(marker===217||marker===218)break;
  if(marker===1||(marker>=208&&marker<=215))continue;
  if(offset+2>bytes.length)break;
  const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)break;
  if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){
   if(length<8)break;return {height:bytes.readUInt16BE(offset+3),width:bytes.readUInt16BE(offset+5)};
  }
  offset+=length;
 }
 throw Error('Unreadable window image dimensions');
}
export function sharedScreenContext(input:unknown):SharedScreenContext{
 const value=record(input);keys(value,['descriptor','content']);const descriptor=record(value.descriptor);
 keys(descriptor,['id','revision','app','capturedAt','width','height','mode']);
 const reference=screenRef({id:descriptor.id,revision:descriptor.revision});
 const app=text(descriptor.app,'source application',200),capturedAt=text(descriptor.capturedAt,'capture time',40);
 if(!/^\d{4}-\d\d-\d\dT/.test(capturedAt)||!Number.isFinite(Date.parse(capturedAt)))throw Error('Invalid capture time');
 const width=descriptor.width as number,height=descriptor.height as number;
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>1280||height>1280||width*height>1280*960)throw Error('Window image dimensions exceed the local bound');
 const content=record(value.content);
 if(descriptor.mode==='text'&&content.type==='text'){
  keys(content,['type','text']);return {descriptor:{...reference,app,capturedAt,width,height,mode:'text'},content:{type:'text',text:text(content.text,'shared window text',20000)}};
 }
 if(descriptor.mode==='image'&&content.type==='image'){
  keys(content,['type','mediaType','data']);
  if(content.mediaType!=='image/png'&&content.mediaType!=='image/jpeg')throw Error('Unsupported window image type');
  const data=text(content.data,'shared image',Math.ceil(maxScreenImageBytes/3)*4);
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(data)||data.length%4!==0)throw Error('Invalid window image encoding');
  const bytes=Buffer.from(data,'base64');if(bytes.toString('base64')!==data)throw Error('Invalid window image encoding');if(bytes.length>maxScreenImageBytes)throw Error('Window image is too large');
  const actual=screenImageSize(bytes,content.mediaType);if(actual.width!==width||actual.height!==height)throw Error('Window image dimensions do not match its descriptor');
  return {descriptor:{...reference,app,capturedAt,width,height,mode:'image'},content:{type:'image',mediaType:content.mediaType,data}};
 }
 throw Error('Window sharing mode does not match the selected content');
}

/** ELF-8: raw pixels/OCR stay in process memory, never in the durable document. */
export class EphemeralScreenContexts {
 private pending:SharedScreenContext|undefined;
 private bound=new Map<string,SharedScreenContext>();
 attach(input:unknown):ScreenContextRef{
  const context=sharedScreenContext(input),current=this.pending;
  if(current?.descriptor.id===context.descriptor.id){
   if(current.descriptor.revision>context.descriptor.revision)throw Error('Window context changed. Review a fresh preview.');
   if(current.descriptor.revision===context.descriptor.revision&&JSON.stringify(current)!==JSON.stringify(context))throw Error('Window context changed without a new revision');
  }
  this.pending=context;return {id:context.descriptor.id,revision:context.descriptor.revision};
 }
 bind(workId:string,input:unknown):ScreenContextDescriptor{
  const reference=screenRef(input),context=this.pending;
  if(!context||context.descriptor.id!==reference.id||context.descriptor.revision!==reference.revision)throw Error('Window context expired or changed. Share a fresh preview.');
  if(this.bound.has(workId))throw Error('This work already owns window context');
  const bytes=[...this.bound.values(),context].reduce((total,c)=>total+(c.content.type==='image'?Buffer.byteLength(c.content.data,'base64'):Buffer.byteLength(c.content.text)),0);
  if(bytes>2000000)throw Error('Queued window context reached its memory bound. Finish or stop existing work before sharing another preview.');
  this.bound.set(workId,context);this.pending=undefined;return structuredClone(context.descriptor);
 }
 take(workId:string):SharedScreenContext|undefined{const context=this.bound.get(workId);this.bound.delete(workId);return context;}
 release(workId:string){this.bound.delete(workId);}
 discard(reference?:ScreenContextRef):Set<string>{
  const matches=(context:SharedScreenContext)=>!reference||context.descriptor.id===reference.id&&context.descriptor.revision===reference.revision;
  if(this.pending&&matches(this.pending))this.pending=undefined;
  const removed=new Set<string>();for(const [id,context] of this.bound)if(matches(context)){this.bound.delete(id);removed.add(id);}return removed;
 }
}
