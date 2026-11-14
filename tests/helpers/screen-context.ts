import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {screenImageSize,type SharedScreenContext} from '../../runtime/screen-context.js';
// Existing original artwork is real local image input, not a capture/live proof.
export async function screenFixture(mode:'image'|'text'='image'):Promise<SharedScreenContext>{
 const bytes=await readFile(new URL('../../assets/pip-companion.png',import.meta.url));
 const size=screenImageSize(bytes,'image/png');
 return {descriptor:{id:randomUUID(),revision:1,app:'Pip disposable context fixture',capturedAt:new Date().toISOString(),...size,mode},content:mode==='image'?{type:'image',mediaType:'image/png',data:bytes.toString('base64')}:{type:'text',text:await readFile(new URL('../fixtures/context-note.txt',import.meta.url),'utf8')}};
}
