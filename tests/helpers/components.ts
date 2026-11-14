import type {Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
// One owner for standalone component resource routing under the shipping CSP.
export async function componentPage(page:Page,body:string,script:string){
 for(const name of ['living-ink','feedback','tracker','popup','character'])for(const extension of ['js','css']){
  const file=`${name}.${extension}`;
  await page.route(`**/${file}`,async route=>route.fulfill({contentType:extension==='js'?'text/javascript':'text/css',body:await readFile(path.join('web',file),'utf8')}));
 }
 await page.route('**/curious-hearth/*.png',async route=>route.fulfill({contentType:'image/png',body:await readFile(path.join('assets/curious-hearth',path.basename(new URL(route.request().url()).pathname)))}));
 await page.route('**/component-fixture.css',route=>route.fulfill({contentType:'text/css',body:'body{background:#203A31;margin:24px;color:#F6EAD4;font:15px/1.5 -apple-system,system-ui}.motion-stage{display:flex;align-items:end;gap:16px}.motion-request{display:block;margin-top:16px}.motion-request input{display:block;width:272px;height:44px;box-sizing:border-box;background:#142923;color:#F6EAD4;border:1px solid #4C6354;border-radius:10px;font:inherit;padding:8px}'}));
 await page.route('**/component-check.js',route=>route.fulfill({contentType:'text/javascript',body:script}));
 const built=await readFile('build/Pip.app/Contents/Resources/web/index.html','utf8');
 const template=built.match(/<template id="pip-character-rig">[\s\S]*?<\/template>/)?.[0];
 if(!template)throw Error('Build Pip before running the selected character journey');
 await page.route('**/component-check',route=>route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'"},body:`<!doctype html><html lang="en"><meta charset="utf-8"><title>Pip independent components</title><link rel="stylesheet" href="/component-fixture.css"><body>${template}${body}<script type="module" src="/component-check.js"></script></body></html>`}));
 await page.goto('/component-check');
}
