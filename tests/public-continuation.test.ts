import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readPublicURL } from '../runtime/public-web.js';
import { withPublicPage, type PublicPageFixture } from './helpers/public-page.js';
const captured=JSON.parse(await readFile(new URL('./fixtures/public-readme-complete.json',import.meta.url),'utf8')) as PublicPageFixture;

// Intent: V1-SPEC research returns bounded source text with a continuation reference,
// rather than making the unread remainder inaccessible. The fixture is a real full README.
test('A5 bounded public-source pages reconstruct the genuine plain-text document',async()=>{
 await withPublicPage({...captured},async()=>{
  const expected=captured.body.replace(/\s+/g,' ').trim();
  let page=await readPublicURL(captured.source);const parts=[page.text];
  assert.equal(typeof page.continuation,'string','The unread remainder needs a continuation reference');
  assert.equal(page.offset,0);assert.equal(page.truncated,true);assert.equal(page.totalCharacters,expected.length);
  while(page.continuation){
   const next=await readPublicURL(captured.source,page.continuation);
   assert.equal(next.offset,(page.offset??0)+page.text.length);
   assert.ok(next.text.length>0);parts.push(next.text);page=next;
  }
  assert.equal(page.truncated,false);
  assert.equal(parts.join(''),expected,'No skipped text, repeated chunks or stripped plain-text angle brackets');
 });
});

test('A5 a continuation cannot silently join changed content or a different source',async()=>{
 const fixture={...captured};
 await withPublicPage(fixture,async getCalls=>{
  const first=await readPublicURL(fixture.source);assert.ok(first.continuation);
  const calls=getCalls();
  await assert.rejects(readPublicURL('https://github.com/deepseek-ai/dsh-superagent-prototype',first.continuation),/source|URL/i);
  assert.equal(getCalls(),calls,'Reject a mismatched reference before another connection');
  // Explicit stale-response variant: the genuine document was shortened after page one.
  fixture.body=fixture.body.slice(0,-100);
  await assert.rejects(readPublicURL(fixture.source,first.continuation),/changed/i);
 });
});
