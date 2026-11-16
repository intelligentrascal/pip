import {test,expect} from '@playwright/test';

// Intent: ELF-8 explicit on-device capture, nothing sent without the person, cancellation and denial preserving typing; and ELF-65's agreed
// design (ELF-73, gap 1): the words appear in the message box while Pip listens, in secondary text, with Talk lit and five level bars,
// instead of in a separate review panel. Native speech events are stand-ins: these are real message-box journeys, not live microphone proof.
test('dictation shows its words in the message box, stops on the first Return, and sends only when asked',async({page})=>{
 const messages:any[]=[];
 await page.exposeFunction('pipTestBridge',(message:any)=>{messages.push(message);});
 await page.goto('/');
 const composer=page.locator('#composer'),talk=page.locator('#talk');
 const receive=async(payload:any)=>page.evaluate(payload=>(window as any).pipReceive({kind:'dictation',payload}),payload);
 const latest=()=>messages.filter(m=>m.kind==='dictation.start').at(-1)?.payload.session;
 await expect(composer).toBeFocused();await composer.fill('Please summarise:');
 expect(messages.some(m=>m.kind==='dictation.start')).toBe(false);
 const box=(await composer.boundingBox())!;
 // A refusal leaves the typed words alone and says why in the status line.
 await talk.click();await expect.poll(latest).toBeTruthy();const denied=latest();
 await receive({session:denied,state:'unavailable',message:'Microphone and Speech Recognition access are not both granted. Pip has requested neither. Keep typing; a later consented microphone check is needed.'});
 await expect(page.locator('#status')).toContainText('requested neither');
 await expect(composer).toHaveValue('Please summarise:');await expect(composer).toBeEditable();
 // Listening: live words follow what was typed, in the message box, with Talk lit and the level bars showing.
 await talk.click();await expect.poll(latest).not.toBe(denied);const first=latest();
 await page.evaluate(session=>(window as any).pipReceive({kind:'dictationCancelled',payload:{session}}),denied);
 await receive({session:first,state:'capturing',text:'the meeting notes',message:'Fixture speech events — no microphone is running.'});
 await expect(composer).toHaveValue('Please summarise: the meeting notes');await expect(composer).not.toBeEditable();
 await expect(talk).toHaveClass(/\bon\b/);await expect(talk).toHaveAttribute('aria-label','Stop listening');await expect(page.locator('#level')).toBeVisible();
 const secondary=await page.evaluate(()=>{const probe=document.createElement('i');probe.style.color='var(--t2)';document.body.append(probe);const color=getComputedStyle(probe).color;probe.remove();return color;});
 expect(await composer.evaluate(c=>getComputedStyle(c).color)).toBe(secondary);
 await receive({session:first,state:'level',level:.8});
 expect((await page.locator('#level i').evaluateAll(bars=>bars.map(bar=>parseFloat((bar as HTMLElement).style.height)))).every(h=>h>3)).toBe(true);
 await expect(page.locator('#dictation')).toHaveCount(0);
 // The first Return only stops listening; nothing is sent.
 await composer.focus();await page.keyboard.press('Enter');
 await expect.poll(()=>messages.filter(m=>m.kind==='dictation.stop').length).toBeGreaterThan(0);expect(messages.some(m=>m.kind==='submit')).toBe(false);
 await receive({session:first,state:'review',text:'the meeting notes',message:'Fixture stopped transcript.'});
 await expect(composer).toBeEditable();await expect(composer).toHaveValue('Please summarise: the meeting notes');await expect(talk).not.toHaveClass(/\bon\b/);
 await expect(page.locator('#status')).toContainText('Nothing was sent');
 // A late partial never replaces words the person can now edit; the transcript is only saved as a draft once they edit it.
 await composer.fill('Please summarise: the meeting notes from today');
 await receive({session:first,state:'capturing',text:'late partial',message:'late'});await expect(composer).toHaveValue('Please summarise: the meeting notes from today');
 await expect.poll(async()=>{const rect=(await composer.boundingBox())!;return [rect.x,rect.y+rect.height];}).toEqual([box.x,box.y+box.height]);
 await composer.press('Enter');
 await expect.poll(()=>messages.filter(m=>m.kind==='submit').length).toBe(1);
 expect(messages.find(m=>m.kind==='submit').payload.request).toBe('Please summarise: the meeting notes from today');
 // Cancellation, focus loss and native lifecycle signals forget the speech and put back exactly what was typed.
 await composer.fill('Keep my typed draft.');
 for(const ending of ['escape','native','hidden','blur','talk']){
  const previous=latest();await talk.click();await expect.poll(latest).not.toBe(previous);const id=latest();
  await receive({session:id,state:'capturing',text:'Do not send this partial.',message:'Fixture partial'});
  await expect(composer).toHaveValue('Keep my typed draft. Do not send this partial.');
  if(ending==='escape')await page.keyboard.press('Escape');
  if(ending==='native')await page.evaluate(session=>(window as any).pipReceive({kind:'dictationCancelled',payload:{session}}),id);
  if(ending==='hidden'){await page.evaluate(()=>(window as any).pipReceive({kind:'popupHidden',payload:{}}));await expect(page.locator('#win')).toHaveCSS('opacity','0');await page.evaluate(()=>(window as any).pipReceive({kind:'summon',payload:{}}));}
  if(ending==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  if(ending==='talk'){await talk.click();await expect.poll(()=>messages.filter(m=>m.kind==='dictation.stop').at(-1)?.payload.session).toBe(id);await receive({session:id,state:'review',text:'',message:'No speech.'});await expect(page.locator('#status')).toContainText('No speech was recognised');}
  await expect(composer).toHaveValue('Keep my typed draft.');await expect(composer).toBeEditable();
  await receive({session:id,state:'review',text:'stale completion',message:'late'});await expect(composer).toHaveValue('Keep my typed draft.');
 }
 expect(messages.filter(m=>m.kind==='submit').length).toBe(1);
 expect(messages.filter(m=>m.kind==='saveComposer').some(m=>m.payload.text.includes('Do not send')||m.payload.text.includes('late partial')||m.payload.text.includes('stale'))).toBe(false);
});

// Intent: ELF-8 truthful unavailable states; a web view is not a speech engine.
test('without the native bridge Talk explains unavailable capture and typing still works',async({page})=>{
 await page.goto('/');await page.locator('#composer').fill('Read the document behind Pip.');
 await page.getByRole('button',{name:'Talk',exact:true}).click();
 await expect(page.locator('#status')).toContainText('needs the native Pip app');
 await expect(page.getByRole('button',{name:'Talk',exact:true})).toBeEnabled();
 await expect(page.locator('#composer')).toBeEditable();
 await page.locator('#composer').press('End');await page.locator('#composer').pressSequentially(' Keep it short.');
 await expect(page.locator('#composer')).toHaveValue('Read the document behind Pip. Keep it short.');
});

// Intent: ELF-8 truthful failure: an unresponsive start stays unconfirmed, the typed draft is kept, and a long dictation grows the message box
// to six lines inside the window's requested height instead of opening a second panel.
test('an unresponsive start stays unconfirmed and a long transcript fits the window the host is asked for',async({page})=>{
 const messages:any[]=[];await page.setViewportSize({width:756,height:720});
 await page.clock.install();await page.exposeFunction('pipTestBridge',(m:any)=>messages.push(m));await page.goto('/');
 await page.evaluate(()=>(window as any).pipReceive({kind:'nativeStatus',payload:{hotkey:'⌘⇧E',visibleHeight:720}}));
 await page.locator('#composer').fill('Keep my draft.');await page.getByRole('button',{name:'Talk',exact:true}).click();
 await expect.poll(()=>messages.find(m=>m.kind==='dictation.start')?.payload.session).toBeTruthy();
 const id=messages.find(m=>m.kind==='dictation.start').payload.session;
 await page.clock.fastForward(5001);
 await expect(page.locator('#status')).toContainText('could not confirm capture status');
 await expect.poll(()=>messages.some(m=>m.kind==='dictation.cancel'&&m.payload.session===id)).toBe(true);
 await expect(page.locator('#composer')).toHaveValue('Keep my draft.');expect(messages.some(m=>m.kind==='submit')).toBe(false);
 await page.getByRole('button',{name:'Talk',exact:true}).click();
 await expect.poll(()=>messages.filter(m=>m.kind==='dictation.start').at(-1)?.payload.session).not.toBe(id);
 const next=messages.filter(m=>m.kind==='dictation.start').at(-1).payload.session;
 await page.evaluate(payload=>(window as any).pipReceive({kind:'dictation',payload}),{session:next,state:'review',text:'one\ntwo\nthree\nfour\nfive',message:'Fixture stopped transcript.'});
 await expect(page.locator('#composer')).toBeEditable();
 const requested=messages.filter(m=>m.kind==='resize').at(-1).payload.windowHeight;
 await page.setViewportSize({width:756,height:Math.round(requested)+8});
 await expect(page.locator('#composer')).toBeInViewport({ratio:1});await expect(page.getByRole('button',{name:'Send',exact:true})).toBeInViewport({ratio:1});
});
