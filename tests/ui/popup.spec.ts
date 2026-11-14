import {test,expect} from '@playwright/test';
import path from 'node:path';
import {componentPage} from '../helpers/components.js';

test.use({video:process.env.PIP_DEMO_DIR?{mode:'on',size:{width:680,height:720}}:'off'});

// Intent: ELF-8/ELF-10 intent reveal, stationary composer, draft retention and
// truthful background attention. This is browser keyboard proof, not native input.
test('Living ink popup keeps typing stationary and background work cannot reopen it',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error'&&message.text().includes('Content Security Policy'))errors.push(message.text());});
 await componentPage(page,'<pip-popup></pip-popup>',`import '/popup.js';window.requests=[];document.querySelector('pip-popup').addEventListener('pip-request',e=>window.requests.push(e.detail.request));`);
 const popup=page.locator('pip-popup'),composer=popup.getByRole('textbox',{name:'What would you like a hand with?'});
 await expect(composer).toBeFocused();
 const before=await composer.boundingBox();expect(before).not.toBeNull();
 if(process.env.PIP_CAPTURE_DIR)await page.screenshot({path:path.join(process.env.PIP_CAPTURE_DIR,'popup-compact.png')});
 await composer.pressSequentially('Give me a short summary of this document.',{delay:process.env.PIP_DEMO_DIR?110:0});
 await expect(popup.locator('#conversation')).toBeVisible();
 const after=await composer.boundingBox();expect(after!.y).toBe(before!.y);expect(after!.x).toBe(before!.x);
 await composer.press('Enter');expect(await page.evaluate(()=>(window as any).requests)).toEqual(['Give me a short summary of this document.']);
 await page.evaluate(()=>{(document.querySelector('pip-popup') as any).showWork({id:'document-summary',status:'Working',result:'Reading the requested document.'});});
 await expect(popup.getByRole('button',{name:'Stop work'})).toBeVisible();
 await composer.press('Escape');await expect(popup).toBeHidden();
 await page.evaluate(()=>{(document.querySelector('pip-popup') as any).showWork({id:'document-summary',status:'Held/Unknown',result:'The action outcome is held for inspection.'});});
 await expect(popup).toBeHidden();
 await page.evaluate(()=>{(document.querySelector('pip-popup') as any).summon();});
 await expect(composer).toBeFocused();await expect(composer).toHaveValue('Give me a short summary of this document.');
 await expect(popup.locator('#status')).toHaveText('Held/Unknown');
 expect(await page.evaluate(()=>{try{(document.querySelector('pip-popup') as any).showWork({id:'document-summary',status:'Done'});return false;}catch{return true;}})).toBe(true);
 expect(await page.evaluate(()=>{try{(document.querySelector('pip-popup') as any).showWork({id:'document-summary',status:'toString'});return false;}catch{return true;}})).toBe(true);
 await expect(popup.locator('#status')).toHaveText('Held/Unknown');
 await popup.getByRole('button',{name:'Start dictation'}).click();await expect(popup.locator('#boundary')).toContainText('not connected');
 expect(await page.evaluate(()=>(window as any).requests.length)).toBe(1);
 await page.emulateMedia({reducedMotion:'reduce'});
 if(process.env.PIP_CAPTURE_DIR)await page.screenshot({path:path.join(process.env.PIP_CAPTURE_DIR,'popup-expanded.png')});
 console.log(JSON.stringify({scenario:'web-popup-keyboard',composerBefore:before,composerAfter:after,draftPreserved:true,backgroundDidNotReopen:true,unverifiedDoneRefused:true}));
 expect(errors).toEqual([]);
 if(process.env.PIP_DEMO_DIR){const video=page.video();await page.close();await video!.saveAs(path.join(process.env.PIP_DEMO_DIR,'web-popup.webm'));}
});
