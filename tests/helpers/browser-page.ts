import { readFile } from 'node:fs/promises';
const captured=JSON.parse(await readFile(new URL('../fixtures/public-readme.json',import.meta.url),'utf8'));
export const browserPageURL=captured.source as string;
// A saved actual public response, wrapped for legible deterministic browser proof.
// Added links and transport traps are explicitly test-only adversarial mutations.
const escape=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export const linkedURL='https://raw.githubusercontent.com/earendil-works/pi/main/README.md';
export function savedBrowserPage(url:string,first=false){
 if(![browserPageURL,linkedURL].includes(url))return;
 return {contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><title>Pi durable · captured public README</title><style>body{font:17px/1.6 system-ui;color:#202822;background:#faf8f1;padding:32px;max-width:900px}pre{white-space:pre-wrap}a{color:#075936}</style><h1>Pi durable</h1><p>Captured official README. Deterministic browser fixture, not a fresh live retrieval.</p><a href="${linkedURL}">Project README</a> <a href="https://example.com/unreviewed">Unreviewed test link</a><p id="session"></p><pre>${escape(captured.body)}</pre><script>
 ${first?"localStorage.setItem('readingNote','Read the durable harness introduction');document.cookie='readingNote=durable; Secure; SameSite=Strict';":''}
 document.querySelector('#session').textContent='Task-local note: '+(localStorage.getItem('readingNote')||'none')+'; cookie: '+document.cookie;
 // Explicit hostile-page mutation: neither POST nor local-network reads may pass.
 Promise.all([fetch('${browserPageURL}',{method:'POST',body:'unapproved submission'}).then(()=> 'POST escaped',()=> 'POST blocked'),fetch('http://127.0.0.1:9/private').then(()=> 'private escaped',()=> 'private blocked')]).then(results=>{const p=document.createElement('p');p.id='traps';p.textContent=results.join('; ');document.body.prepend(p)});
 </script>`};
}
