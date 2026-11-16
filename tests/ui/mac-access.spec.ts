import {test,expect,type Page} from '@playwright/test';
import {openMore} from '../helpers/chat-page.js';

// Intent: ELF-56 piece 4, builder spec item 6 — setup asks once for all six macOS permissions. The page shows the
// one setup panel; the native side answers with the six rows. This proves the view and the bridge round trip, never
// a real TCC prompt.
const SIX=[
 {id:'accessibility',label:'Accessibility',why:'Control other apps for you.',state:'granted'},
 {id:'screen-recording',label:'Screen Recording',why:'See a window you choose to share.',state:'notGranted'},
 {id:'automation',label:'Automation (Apple Events)',why:'Let scripts act inside other apps when you ask.',state:'granted'},
 {id:'full-disk-access',label:'Full Disk Access',why:'Read and organise files anywhere you point Pip.',state:'notGranted'},
 {id:'microphone',label:'Microphone',why:'Dictation.',state:'granted'},
 {id:'notifications',label:'Notifications',why:'Alarms and reminders Pip schedules locally.',state:'granted'},
];
const asked:(page:Page,kind:'permissions.setup'|'permissions.status')=>void=async(page,kind)=>{
 const askedAt=kind==='permissions.setup'?'2026-11-15T10:00:00.000Z':'';
 await page.evaluate(({kind,askedAt,permissions})=>(window as any).pipReceive({kind:'permissionsState',payload:{askedAt,permissions}}),{kind,askedAt,permissions:SIX});
};

test('the Mac access panel lists all six permissions and setup asks exactly once',async({page})=>{
 const kinds:string[]=[];
 await page.addInitScript(()=>{window.pipTestBridge=m=>{if(['permissions.setup','permissions.status'].includes(m.kind))(window as any).__kinds.push(m.kind);};});
 await page.goto('/');
 await page.evaluate(()=>{(window as any).__kinds=[];});
 await page.evaluate(message=>(window as any).pipReceive(message),{kind:'permissionsState',payload:{askedAt:'',permissions:[]}});
 await openMore(page,'Settings');
 await page.getByRole('button',{name:'Mac access'}).click();
 await expect(page.getByRole('heading',{name:'What Pip may do on your Mac'})).toBeVisible();
 await expect(page.getByText('Pip has not asked macOS yet.')).toBeVisible();
 await expect(page.getByText('Pip is checking this Mac’s permissions.')).toBeVisible();
 // The native side answers the status ask; the page renders all six, each with plain words.
 await asked(page,'permissions.status');
 for(const permission of SIX){
  const word=permission.state==='granted'?'Allowed':'Not allowed yet';
  await expect(page.getByText(`${permission.label}: ${word}`)).toBeVisible();
  await expect(page.getByText(permission.why)).toBeVisible();
 }
 await page.getByRole('button',{name:'Set up Mac access'}).click();
 await expect.poll(async()=>await page.evaluate(()=>(window as any).__kinds)).toEqual(['permissions.status','permissions.setup']);
 await asked(page,'permissions.setup');
 await expect(page.getByText(/Pip asked macOS on /)).toBeVisible();
 await page.getByRole('button',{name:'Set up Mac access'}).click();
 await expect.poll(async()=>await page.evaluate(()=>(window as any).__kinds)).toEqual(['permissions.status','permissions.setup','permissions.setup'],'setup asks again only by an explicit press');
});
