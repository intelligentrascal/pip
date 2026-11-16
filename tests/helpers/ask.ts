import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openHost, type Host, type HostOptions } from '../../runtime/pi-durable-adapter.js';
import type { Work } from '../../runtime/domain.js';

const base=process.env.PIP_TEST_ROOT??path.join(os.tmpdir(),'pip-unit-fixtures');
/** A new isolated Pip home that the host accepts as a test fixture. */
export async function testHome(prefix='pip-'){await mkdir(base,{recursive:true});const home=await mkdtemp(path.join(base,prefix));await writeFile(path.join(home,'.pip-test-home'),'pip-test-only');return home;}
const TERMINAL=['Done','Could not finish','Interrupted','Stopped'];
/** Wait for committed state, never for time alone. */
export async function until(host:Host,predicate:(s:Awaited<ReturnType<Host['snapshot']>>)=>boolean,ms=8000) {const deadline=Date.now()+ms;while(Date.now()<deadline){const state=await host.snapshot();if(predicate(state))return state;await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('Expected committed state did not arrive: '+JSON.stringify((await host.snapshot()).works.map(w=>[w.id,w.status,w.error])));}
export const finished=(id:string)=>(s:{works:Work[]})=>TERMINAL.includes(s.works.find(w=>w.id===id)?.status??'');
let counter=0;
/** Ask once on a fresh open of the home, wait for the ask to end, close. The conversation persists in the home between asks. */
export async function ask(home:string,request:string,options:Partial<HostOptions>={}):Promise<Work> {
 const host=await openHost({home,fixture:true,retry:{maxRetries:0},...options});
 try{const id='ask-'+(++counter);await host.submit(id,request);return (await until(host,finished(id))).works.find(w=>w.id===id)!;}
 finally{await host.close();}
}
