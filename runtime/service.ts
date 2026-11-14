import readline from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import { openHost, type Host } from './pi-durable-adapter.js';
import { claudeProvider } from './claude.js';
import { ProviderManager } from './providers.js';
import { text } from './domain.js';
import { resolvePublic } from './public-web.js';
import { IsolatedBackendClient } from './backend-client.js';
import { trackerRecords } from './tracker.js';
import { TaskBrowsers } from './task-browser.js';

process.umask(0o077);
const home=process.env.PIP_HOME??path.join(os.homedir(),'Library/Application Support/Pip');
let host:Host|undefined;
const write=(kind:string,payload:unknown,id='host')=>process.stdout.write(JSON.stringify({version:1,id,kind,payload})+'\n');
const browsers=new TaskBrowsers(state=>write('browserState',state));
const backend=process.env.PIP_TEST==='1'&&process.env.PIP_NATIVE==='1'&&process.env.PIP_ISOLATED_BACKENDS==='1'?new IsolatedBackendClient(message=>process.stdout.write(JSON.stringify(message)+'\n')):undefined;
let providers:ProviderManager|undefined;
const changed=()=>{if(host)void host.snapshot().then(async state=>{
 const workViews=trackerRecords(state,'work');
 for(const work of workViews)if(['Done','Stopped','Interrupted'].includes(work.status)&&browsers.has(work.id)&&browsers.state(work.id).driver!=='stopped')await browsers.close(work.id);
 write('state',{state,workViews,providers:await providers!.view(),fixture:process.env.PIP_TEST==='1'});
});};
try {
 providers=new ProviderManager({home,claudeEnvAllowed:process.env.PIP_CLAUDE_ALLOWED==='1',claude:()=>claudeProvider(true,process.env.PIP_CLAUDE_PATH??'/opt/homebrew/bin/claude'),notify:e=>{if(e.type==='changed')changed();else write('openAuth',{url:e.url});}});
 host=await openHost({browser:id=>browsers.tools(id),home,fixture:process.env.PIP_TEST==='1',provider:providers.provider(),changed,backend,native:proposal=>write('effect',proposal)});
 changed();
 const reader=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
 let line=Promise.resolve();
 reader.on('line',raw=>{
  // Private native replies bypass the serialized command queue: a pending bounded
  // read/approval may itself be waiting for this response. Renderer kinds exclude it.
  if(backend&&raw.length<=2000000){try{const m=JSON.parse(raw);if(m.kind==='backend.response'){backend.receive(m);return;}}catch{}}
  line=line.then(async()=>{
   let id='invalid';
   try {
    if(raw.length>1000000)throw new Error('Request too large');
    const m=JSON.parse(raw);
    if(raw.length>100000&&m.kind!=='nativeContext')throw new Error('Request too large'); if(m.version!==1||typeof m.id!=='string'||m.id.length>100||!m.payload||typeof m.payload!=='object'||Array.isArray(m.payload))throw new Error('Invalid request');
    id=m.id; const p=m.payload;
    switch(m.kind) {
    case 'snapshot': break;
    case 'nativeContext': if(process.env.PIP_NATIVE!=='1')throw Error('Window context requires the private native connection');write('contextAttached',await host!.attachScreenContext(p.context),id);return;
    case 'nativeClearContext': if(process.env.PIP_NATIVE!=='1')throw Error('Window context requires the private native connection');await host!.discardScreenContext(p.reference);break;
    case 'resumeScreenWork': await host!.resumeScreenWork(text(p.id,'work ID',100),p.reference);break;
    case 'work.backlog': {const saved=await host!.saveWorkToBacklog({id,...p});write('workSaved',{id:saved.id,status:saved.status},id);break;}
    case 'feedback.save': {const saved=await host!.saveFeedback({id,...p});write('feedbackSaved',{id:saved.id,status:saved.status},id);break;}
    case 'feedback.correct': await host!.correctFeedback(text(p.id,'feedback ID',100),p.revision,p.change);break;
    case 'tracker': write('trackerResult',await host!.tracker(p.view,p.query??'',p.status??''),id);return;
    case 'backendQuery': write('backendResult',await host!.backendQuery(text(p.op,'operation',100),p.args??{}),id);return;
    case 'reconcile': await host!.reconcile(text(p.id,'proposal ID',100));break;
    case 'alarmSnapshot': write('backendResult',await host!.alarmSnapshot(),id);return;
    case 'submit': {
     const request=text(p.request,'request',12000);
     if(p.browserPages!==undefined){
      if((await host!.snapshot()).works.some(w=>w.id===id))throw Error('That request already exists.');
      browsers.grant(id,p.browserPages);
     }
     try{await host!.submit(id,request,p.contextWorkId===undefined?undefined:text(p.contextWorkId,'selected result',100),p.screenContext,p.project,p.browserPages!==undefined);}catch(error){if(browsers.has(id))await browsers.close(id);throw error;}
     break;
    }
    case 'browser': {
     const workId=text(p.workId,'work ID',100);
     if(!(await host!.snapshot()).works.some(w=>w.id===workId))throw Error('This task does not exist.');
     write('browserResult',await browsers.command(workId,p.op),id);return;
    }
    case 'provider.allow': await providers!.allow(text(p.id,'provider',40));break;
    case 'provider.withdraw': await providers!.withdraw(text(p.id,'provider',40));break;
    case 'provider.select': await providers!.select(text(p.id,'provider',40),p.model===undefined?undefined:text(p.model,'model',100));break;
    case 'provider.backup': await providers!.setBackup(p.id===null?null:text(p.id,'provider',40));break;
    case 'provider.signIn': await providers!.signIn(text(p.id,'provider',40));break;
    case 'provider.cancelSignIn': await providers!.cancelSignIn(text(p.id,'provider',40));break;
    case 'provider.remove': await providers!.remove(text(p.id,'provider',40));break;
    // Only the native secure field writes here; the web page's bridge list excludes this kind.
    case 'provider.setKey': if(process.env.PIP_NATIVE!=='1'&&process.env.PIP_TEST!=='1')throw new Error('A key can only be entered in the native secure field.');await providers!.setKey(text(p.id,'provider',40),text(p.key,'key',600));break;
    case 'saveComposer': await host!.saveComposer(p.text); return;
    case 'saveDraft': await host!.saveDraft(text(p.id,'work ID',100),p.text); return;
    case 'stop': await Promise.all([browsers.closeAll(),host!.stop()]);break;
    case 'propose': if(p.action?.type==='url.open')await resolvePublic(p.action.url); await host!.propose(p.action);break;
    case 'cancel': await host!.cancel(text(p.id,'proposal ID',100));break;
    case 'approve': if(!Number.isSafeInteger(p.revision))throw new Error('Invalid revision'); await host!.approve(text(p.id,'proposal ID',100),p.revision,text(p.digest,'digest',64));break;
    case 'receipt': if(process.env.PIP_NATIVE!=='1'||!['succeeded','failed-known','unknown'].includes(p.status))throw new Error('Unexpected receipt'); await host!.receipt(text(p.id,'effect ID',100),p.status,text(p.receipt,'receipt',1000));break;
    default: throw new Error('Unsupported request');
    }
    changed();
   } catch(error) {write('error',{message:error instanceof Error ? error.message : 'Pip could not complete this request.'},id);}
  }).catch(()=>{write('error',{message:'Pip’s local state is unavailable. Quit and reopen Pip.'});});
 });
 let closing=false;
 const close=async()=>{if(closing)return;closing=true;reader.close();backend?.close();await Promise.all([browsers.closeAll(),host?.close()]);process.exit(0);};
 reader.on('close',()=>void close());
 process.on('SIGTERM',()=>void close()); process.on('SIGINT',()=>void close());
} catch { write('disconnected',{message:'Pip could not open its local state. Another instance may already be running.'}); process.exitCode=1; }
