import {test,expect} from '@playwright/test';
import path from 'node:path';

// Intent: ELF-8 explicit on-device capture, ephemeral review, separate Ask,
// cancellation/denial preserving typing. Native speech events are stand-ins:
// these are real composer/bridge journeys, not live microphone proof.
test('dictation reviews text without sending partials and preserves typed drafts',async({page})=>{
 const messages:any[]=[];
 await page.exposeFunction('pipTestBridge',(message:any)=>{messages.push(message);});
 await page.goto('/');
 const composer=page.locator('#composer'),talk=page.getByRole('button',{name:'Talk',exact:true});
 const receive=async(payload:any)=>page.evaluate(payload=>(window as any).pipReceive({kind:'dictation',payload}),payload);
 const latest=()=>messages.filter(m=>m.kind==='dictation.start').at(-1)?.payload.session;
 const capture=async(name:string)=>{if(process.env.PIP_CAPTURE_DIR){await page.evaluate(async()=>{await (document.getElementById('character') as any).ready;(document.getElementById('character') as any).cut();(document.getElementById('ink') as any).finishMotion();});await page.screenshot({path:path.join(process.env.PIP_CAPTURE_DIR,name+'.png')});}};
 await expect(composer).toBeFocused();await composer.fill('Please summarise:');
 expect(messages.some(m=>m.kind==='dictation.start')).toBe(false);
 const rectangle=await composer.boundingBox();
 await expect.poll(()=>messages.filter(m=>m.kind==='resize').at(-1)?.payload.height).toBeTruthy();
 const compactHeight=messages.filter(m=>m.kind==='resize').at(-1).payload.height;
 await talk.click();await expect.poll(latest).toBeTruthy();const denied=latest();
 await receive({session:denied,state:'unavailable',message:'Microphone and Speech Recognition access are not both granted. Pip has requested neither. Keep typing; a later consented microphone check is needed.'});
 await expect(page.locator('#dictation-status')).toContainText('requested neither');
 await expect(composer).toHaveValue('Please summarise:');
 await expect.poll(()=>messages.filter(m=>m.kind==='resize').at(-1)?.payload.height).toBeGreaterThan(compactHeight);
 await capture('dictation-unavailable');
 await talk.click();await expect.poll(latest).not.toBe(denied);const first=latest();
 await page.evaluate(session=>(window as any).pipReceive({kind:'dictationCancelled',payload:{session}}),denied);
 await expect(page.locator('#dictation')).toBeVisible();
 await receive({session:first,state:'capturing',text:'the meeting notes',message:'Fixture speech events — no microphone is running.'});
 await expect(page.getByLabel('Transcript — review before adding')).toHaveValue('the meeting notes');
 await expect(page.getByLabel('Transcript — review before adding')).not.toBeEditable();
 await composer.press('Enter');expect(messages.some(m=>m.kind==='submit')).toBe(false);
 await capture('dictation-capturing-fixture');
 await page.getByRole('button',{name:'Stop capture',exact:true}).click();
 await expect.poll(()=>messages.filter(m=>m.kind==='dictation.stop').length).toBe(1);
 await receive({session:first,state:'review',text:'the meeting notes',message:'Fixture stopped transcript. Review before Ask; no microphone was used.'});
 const transcript=page.getByLabel('Transcript — review before adding');await expect(transcript).toBeEditable();await transcript.fill('the meeting notes from today');
 await receive({session:first,state:'capturing',text:'late partial',message:'late'});await expect(transcript).toHaveValue('the meeting notes from today');
 await capture('dictation-review-fixture');
 await page.getByRole('button',{name:'Add to composer',exact:true}).click();
 await expect(composer).toHaveValue('Please summarise:\nthe meeting notes from today');
 expect(messages.some(m=>m.kind==='submit')).toBe(false);
 const after=await composer.boundingBox();expect(after!.x).toBe(rectangle!.x);expect(after!.y).toBe(rectangle!.y);
 await expect(page.locator('#status')).toContainText('Nothing was sent');
 await capture('dictation-ready-to-ask');
 await page.getByRole('button',{name:'Ask Pip',exact:true}).click();
 await expect.poll(()=>messages.filter(m=>m.kind==='submit').length).toBe(1);
 expect(messages.find(m=>m.kind==='submit').payload.request).toBe('Please summarise:\nthe meeting notes from today');
 // Cancellation, focus loss and native lifecycle signals forget speech, not typed text.
 await composer.fill('Keep my typed draft.');
 for(const ending of ['escape','native','hidden','blur']){
  const previous=latest();await talk.click();await expect.poll(latest).not.toBe(previous);const id=latest();
  await receive({session:id,state:'capturing',text:'Do not send this partial.',message:'Fixture partial'});
  if(ending==='escape')await composer.press('Escape');
  if(ending==='native')await page.evaluate(session=>(window as any).pipReceive({kind:'dictationCancelled',payload:{session}}),id);
  if(ending==='hidden'){await page.evaluate(()=>(window as any).pipReceive({kind:'popupHidden',payload:{}}));await expect(page.locator('.panel')).toHaveCSS('clip-path',/^inset\(100% 0(px|%) 0(px|%) 100%\)$/);await page.evaluate(()=>(window as any).pipReceive({kind:'summon',payload:{}}));} // The host always summons before the folded page is shown again.
  if(ending==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#dictation')).toBeHidden();await expect(composer).toHaveValue('Keep my typed draft.');
  await receive({session:id,state:'review',text:'stale completion',message:'late'});await expect(page.locator('#dictation')).toBeHidden();
 }
 const previous=latest();await talk.click();await expect.poll(latest).not.toBe(previous);const empty=latest();
 await receive({session:empty,state:'review',text:'',message:'No speech was recognised. Nothing was sent.'});
 await page.getByRole('button',{name:'Add to composer',exact:true}).click();await expect(page.locator('#dictation-status')).toContainText('no transcript');
 await transcript.fill('Meeting notes. '.repeat(1000).slice(0,12000));
 await page.getByRole('button',{name:'Add to composer',exact:true}).click();await expect(page.locator('#dictation-status')).toContainText('too long');
 await expect(composer).toHaveValue('Keep my typed draft.');await page.getByRole('button',{name:'Cancel dictation',exact:true}).click();
 expect(messages.filter(m=>m.kind==='submit').length).toBe(1);
 expect(messages.filter(m=>m.kind==='saveComposer').some(m=>m.payload.text.includes('Do not send'))).toBe(false);
 console.log(JSON.stringify({surface:'production composer',speech:'stand-in native events only',typedDraftPreserved:true,partialSubmitted:false,explicitAskCount:1,composerBefore:rectangle,composerAfter:after,lateEventsIgnored:true}));
});

// Intent: ELF-8 truthful unavailable states; a web view is not a speech engine.
test('without the native bridge Talk explains unavailable capture and typing still works',async({page})=>{
 await page.goto('/');await page.locator('#composer').fill('Read the document behind Pip.');
 await page.getByRole('button',{name:'Talk',exact:true}).click();
 await expect(page.locator('#dictation-status')).toContainText('needs the native Pip app');
 await expect(page.getByRole('button',{name:'Talk',exact:true})).toBeEnabled();
 await expect(page.getByLabel('Transcript — review before adding')).toBeHidden();
 await page.locator('#composer').press('End');await page.locator('#composer').pressSequentially(' Keep it short.');
 await expect(page.locator('#composer')).toHaveValue('Read the document behind Pip. Keep it short.');
 await page.getByRole('button',{name:'Close dictation',exact:true}).click();
 await expect(page.locator('#dictation')).toBeHidden();
});

// Intent: ELF-8 truthful failure and usable transcript controls in the native
// host's requested window height, not just a generously sized browser preview.
test('native height includes transcript review and an unresponsive start stays unconfirmed',async({page})=>{
 const messages:any[]=[];await page.setViewportSize({width:472,height:720});
 await page.clock.install();await page.exposeFunction('pipTestBridge',(m:any)=>messages.push(m));await page.goto('/');
 await page.locator('#composer').fill('Keep my draft.');await page.getByRole('button',{name:'Talk',exact:true}).click();
 await expect.poll(()=>messages.find(m=>m.kind==='dictation.start')?.payload.session).toBeTruthy();
 const id=messages.find(m=>m.kind==='dictation.start').payload.session;
 await page.clock.fastForward(5001);
 await expect(page.locator('#dictation-status')).toContainText('could not confirm capture status');
 await expect.poll(()=>messages.some(m=>m.kind==='dictation.cancel'&&m.payload.session===id)).toBe(true);
 await expect(page.locator('#composer')).toHaveValue('Keep my draft.');expect(messages.some(m=>m.kind==='submit')).toBe(false);
 await page.getByRole('button',{name:'Talk',exact:true}).click();
 await expect.poll(()=>messages.filter(m=>m.kind==='dictation.start').at(-1)?.payload.session).not.toBe(id);
 const next=messages.filter(m=>m.kind==='dictation.start').at(-1).payload.session;
 const sizes=messages.filter(m=>m.kind==='resize').length;
 await page.evaluate(payload=>(window as any).pipReceive({kind:'dictation',payload}),{session:next,state:'review',text:'the meeting notes',message:'Fixture stopped transcript. Review before Ask; no microphone was used.'});
 await expect.poll(()=>messages.filter(m=>m.kind==='resize').length).toBeGreaterThan(sizes);
 const requested=messages.filter(m=>m.kind==='resize').at(-1).payload.height;
 await page.setViewportSize({width:472,height:Math.round(Math.min(852,Math.max(315,requested)))});
 await expect(page.getByRole('button',{name:'Add to composer',exact:true})).toBeInViewport({ratio:1});
 await expect(page.getByRole('button',{name:'Cancel dictation',exact:true})).toBeInViewport({ratio:1});
 await expect(page.locator('#composer')).toBeInViewport({ratio:1});
 await page.getByRole('button',{name:'Cancel dictation',exact:true}).click();
 await expect(page.locator('#composer')).toHaveValue('Keep my draft.');
});
