import { open, readFile, rename, chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Credential, CredentialInfo, CredentialStore, AuthOperationOptions } from '@earendil-works/pi-ai';

/** Private files are written 0600 through a temporary file and an atomic rename. */
async function writePrivate(file:string,body:string){
 await mkdir(path.dirname(file),{recursive:true,mode:0o700});
 const tmp=file+'.'+randomUUID()+'.tmp';
 const handle=await open(tmp,'wx',0o600);
 try{await handle.writeFile(body);await handle.sync();}finally{await handle.close();}
 await rename(tmp,file);await chmod(file,0o600);
}
async function readJSON<T>(file:string,fallback:T):Promise<T>{
 try{return JSON.parse(await readFile(file,'utf8')) as T;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return fallback;throw new Error('Pip could not read '+path.basename(file)+'.');}
}

/** Secrets live only here: a mode-0600 file owned by the service. Never Keychain,
 * never pip.sqlite, never a renderer snapshot, a log or model context. */
export class FileCredentialStore implements CredentialStore {
 private chain:Promise<unknown>=Promise.resolve();
 constructor(readonly file:string){}
 private enqueue<T>(job:()=>Promise<T>):Promise<T>{const next=this.chain.then(job,job);this.chain=next.catch(()=>{});return next;}
 private load(){return readJSON<Record<string,Credential>>(this.file,{});}
 read(id:string,_o?:AuthOperationOptions){return this.enqueue(async()=>(await this.load())[id]);}
 list(_o?:AuthOperationOptions):Promise<readonly CredentialInfo[]>{return this.enqueue(async()=>Object.entries(await this.load()).map(([providerId,c])=>({providerId,type:c.type})));}
 /** The engine's contract: undefined from `fn` leaves the entry unchanged (a queued
  * refresh that finds another request already refreshed) and resolves with it. */
 modify(id:string,fn:(current:Credential|undefined)=>Promise<Credential|undefined>,_o?:AuthOperationOptions){
  return this.enqueue(async()=>{const all=await this.load();const current=all[id];const next=await fn(current);if(next===undefined)return current;all[id]=next;await writePrivate(this.file,JSON.stringify(all));return next;});
 }
 /** Removal is explicit (Remove), never inferred from a no-change modify. */
 delete(id:string,_o?:AuthOperationOptions){return this.enqueue(async()=>{const all=await this.load();delete all[id];await writePrivate(this.file,JSON.stringify(all));});}
}

/** Non-secret choices: which provider is active, the one backup, models, and the recorded Allow. */
export type Allowance={terms:number;at:string};
export type ProviderSettings={version:1;active:string;backup:string|null;models:Record<string,string>;allowed:Record<string,Allowance>;chatGPTHostId?:string};
const empty=():ProviderSettings=>({version:1,active:'claude',backup:null,models:{},allowed:{}});
export class SettingsStore {
 private chain:Promise<unknown>=Promise.resolve();
 constructor(readonly file:string){}
 read():Promise<ProviderSettings>{return readJSON(this.file,empty()).then(s=>({...empty(),...s}));}
 update(fn:(s:ProviderSettings)=>void):Promise<ProviderSettings>{
  const job=async()=>{const s=await this.read();fn(s);await writePrivate(this.file,JSON.stringify(s));return s;};
  const next=this.chain.then(job,job);this.chain=next.catch(()=>{});return next;
 }
}
