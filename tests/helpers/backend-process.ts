import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { IsolatedBackendClient } from '../../runtime/backend-client.js';

export const buildBackend=()=>promisify(execFile)('swift',['build','--product','PipBackendFixture'],{timeout:180000,maxBuffer:1000000});
export async function fixtureHome(){
 const sandbox=process.env.PIP_TEST_ROOT??path.join(os.tmpdir(),'pip-wiring-fixtures');await mkdir(sandbox,{recursive:true});const home=await mkdtemp(path.join(sandbox,'pip-wire-'));
 await writeFile(path.join(home,'.pip-test-home'),'pip-test-only');
 const targets=[{id:randomUUID(),title:'Fixture calendar',kind:'event',writable:true,revision:randomUUID()},{id:randomUUID(),title:'Fixture reminders',kind:'reminder',writable:true,revision:randomUUID()},{id:randomUUID(),title:'Other fixture reminders',kind:'reminder',writable:true,revision:randomUUID()}];
 await writeFile(path.join(home,'backend-seed.json'),JSON.stringify({targets,objects:[],access:true,notificationPermission:'granted'}));
 return {home,sandbox,targets,env:{...process.env,PIP_HOME:home,PIP_TEST_ROOT:sandbox,PIP_TEST:'1',PIP_NATIVE:'1',PIP_ISOLATED_BACKENDS:'1',PIP_CLAUDE_ALLOWED:''}};
}
export function nativePeer(env:NodeJS.ProcessEnv){
 const child=spawn(path.resolve('.build/debug/PipBackendFixture'),[],{env,stdio:['pipe','pipe','pipe']});
 let errors='';child.stderr.on('data',data=>{errors+=data;});
 const requests:any[]=[];let listener:(message:any)=>void=()=>{};
 const send=(message:any)=>{requests.push(message);child.stdin.write(JSON.stringify(message)+'\n');};
 const client=new IsolatedBackendClient(send);
 listener=message=>{client.receive(message);};
 const lines=createInterface({input:child.stdout});lines.on('line',line=>listener(JSON.parse(line)));
 const exited=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code));});
 return {client,requests,send,route(fn:(message:any)=>void){listener=fn;},async close(){client.close();child.stdin.end();const code=await exited;if(code!==0)throw Error('Fixture native peer failed: '+errors);}};
}
export async function wireDue(client:IsolationClient,wall:Record<string,unknown>){const response=await client.read('resolveDue',{wall}) as any;if(response.kind!=='resolved')throw Error('Fixture date was unresolved');return response.due;}
type IsolationClient=Pick<IsolatedBackendClient,'read'>;
export const wall=(hour:number|null=9,day=6)=>({year:2026,month:11,day,hour,minute:hour===null?null:0,zone:'Europe/Madrid'});
export function scheduleChange(target:any,after:any,before?:any,kind='create'){return {target,kind,objectID:before?.id??null,beforeRevision:before?.revision??null,beforeCorrelation:before?.correlation??null,after};}
export const reminderValue=(title:string,due:any=null)=>({kind:'reminder',title,start:null,end:null,due,completed:false});
