import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openHost, type Host } from '../../runtime/pi-durable-adapter.js';
import { trackerRecords } from '../../runtime/tracker.js';
import { repliesOf } from '../../runtime/reply.js';
import { composer } from '../helpers/chat-page.js';
import { fauxEngine, routed, said, calls } from '../helpers/faux-engine.js';

// Intent: Pip's Lantern chat window as the captain approved it (ELF-65 design language and screen; built in ELF-60): the ten part kinds drawn
// from OpenUI blocks, a 600 pt window that grows from a fixed bottom up to 70% of the screen, readable type in both schemes and in the
// solid mode, and a Chats list. Fixtures: a real host with a scripted model, replies split by the production splitter (runtime/reply.ts).
test.use({ viewport: { width: 756, height: 800 } });
const partsReply = readFile(new URL('../fixtures/reply-parts.md', import.meta.url), 'utf8');
const messages: any[] = [];
let host: Host, page: Page;

async function receive() {
 if (!host) return;
 const state = await host.snapshot(), replies = repliesOf(state.works);
 await page.evaluate(message => (window as any).pipReceive(message), { kind: 'state', payload: { state, replies, workViews: trackerRecords(state, 'work') } });
}
async function start(browserPage: Page, route: (request: string) => ReturnType<typeof said>, native: Parameters<typeof openHost>[0]['native'] = undefined) {
 page = browserPage; messages.length = 0;
 const base = process.env.PIP_TEST_ROOT ?? path.join(os.tmpdir(), 'pip-ui-fixtures'); await mkdir(base, { recursive: true });
 const home = await mkdtemp(path.join(base, 'pip-')); await writeFile(path.join(home, '.pip-test-home'), 'pip-test-only');
 const { faux, engine } = fauxEngine(); routed(faux, route);
 host = await openHost({ home, fixture: true, engine, native, changed: () => { void receive().catch(() => {}); } });
 await page.exposeFunction('pipTestBridge', async (m: any) => {
  messages.push(m); const p = m.payload;
  if (m.kind === 'submit') await host.submit(m.id, p.request, p.contextWorkId);
  if (m.kind === 'saveComposer') await host.saveComposer(p.text);
  if (m.kind === 'cancel') await host.cancel(p.id);
  if (m.kind === 'approve') await host.approve(p.id, p.revision, p.digest);
  if (m.kind === 'snapshot') await receive();
 });
 // The host reports the screen's visible height; the cap is a share of it, whatever the preview's viewport is.
 await page.goto('/'); await page.evaluate(() => (window as any).pipReceive({ kind: 'nativeStatus', payload: { hotkey: '⌘⇧E', visibleHeight: 800 } }));
}
const ask = async (text: string) => { await composer(page).fill(text); await composer(page).press('Enter'); };
const box = async (selector: string) => (await page.locator(selector).boundingBox())!;

test('the ten part kinds are drawn from one reply and nothing in them sends anything', async ({ page: p }) => {
 const reply = await partsReply;
 await start(p, request => request.startsWith('Plan') ? said(reply) : said('Noted, Monday it is.'));
 try {
  await ask('Plan my Friday around the dentist.');
  const cv = page.locator('#cv');
  await expect(cv.getByRole('heading', { name: 'Friday around the dentist' })).toBeVisible();
  const plan = cv.getByRole('region', { name: 'Plan' });
  await expect(plan.locator('.pr')).toHaveCount(4); await expect(plan).toContainText('2 of 4 done');
  await expect(plan.locator('[aria-current=step]')).toContainText('Tax letter, two clear hours');
  const table = cv.getByRole('region', { name: 'Costs this month' });
  await expect(table.locator('th')).toHaveText(['Item', 'Euros']); await expect(table.locator('tr').last()).toContainText('97');
  const chart = cv.getByRole('img', { name: /^Spending: Rent 900, Food 310, Travel 74$/ });
  const widths = await chart.locator('.ct i').evaluateAll(fills => fills.map(fill => (fill as HTMLElement).style.width));
  expect(widths).toEqual(['100%', '34%', '8%']);
  const choice = cv.getByRole('group', { name: 'When should the tax letter go out?' });
  await expect(choice.getByRole('button')).toHaveCount(2); await expect(choice.locator('.sg')).toContainText('Today');
  const sources = cv.getByRole('region', { name: 'Sources' });
  await expect(sources.locator('button')).toHaveCount(1); await expect(sources).toContainText('example.com'); await expect(sources).toContainText('File');
  await expect(cv.getByRole('figure', { name: 'School run: Home, then Dentist, then School' }).locator('li')).toHaveCount(3);
  const fold = cv.locator('details.pt-fold'); await expect(fold).not.toHaveAttribute('open', ''); await fold.locator('summary').click();
  await expect(fold.locator('strong')).toHaveText('40 minutes');
  const pictures = cv.getByRole('region', { name: 'Pictures' });
  await expect(pictures.locator('img')).toHaveCount(1); await expect(pictures.locator('img')).toHaveAttribute('alt', 'A one pixel test image'); await expect(pictures).toContainText('No image');
  await expect(cv.getByRole('note')).toContainText('Nothing here was sent.');
  const draft = cv.getByRole('region', { name: 'Draft' });
  await expect(draft).toContainText('Email, not sent'); await expect(draft).toContainText('Tax office'); await expect(draft).toContainText('Dear Sir or Madam');
  expect(messages.filter(m => m.kind === 'submit')).toHaveLength(1);
  // A choice is an answer the person gives: picking it sends that label as the next message, once, and locks the others.
  await choice.getByRole('button', { name: /^Monday/ }).click();
  await expect.poll(() => messages.filter(m => m.kind === 'submit').map(m => m.payload.request)).toEqual(['Plan my Friday around the dentist.', 'Monday']);
  await expect(choice.getByRole('button').first()).toBeDisabled();
 } finally { await host.close(); }
});

test('the window is 600 wide, starts at 163 high, grows from a fixed bottom to 70% of the screen and keeps the message box 30 above the bottom', async ({ page: p }) => {
 const reply = await partsReply;
 await start(p, () => said(reply));
 try {
  const gap = async () => { const win = await box('#win'), input = await box('#ask'); return Math.round(win.y + win.height - (input.y + input.height)); };
  const win = await box('#win');
  expect([win.width, Math.round(win.height)]).toEqual([600, 163]);
  expect(await gap()).toBe(30);
  await expect.poll(() => messages.filter(m => m.kind === 'resize').at(-1)?.payload).toEqual({ windowHeight: 163 });
  const bottom = win.y + win.height;
  await ask('Plan my Friday around the dentist.');
  await expect(page.locator('#cv').getByRole('region', { name: 'Draft' })).toBeVisible();
  // 70% of the 800 pt the host reported.
  await expect.poll(async () => Math.round((await box('#win')).height)).toBe(560);
  expect(await gap()).toBe(30); expect(Math.round((await box('#win')).y + (await box('#win')).height)).toBe(Math.round(bottom));
  await expect.poll(() => messages.filter(m => m.kind === 'resize').at(-1)?.payload).toEqual({ windowHeight: 560 });
  expect(await page.locator('#cv').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
 } finally { await host.close(); }
});

// WCAG 2.2 contrast of every drawn piece of text against what is behind it, as drawn, in each scheme and in each way the window is filled.
const contrastSweep = (under: string) => page.evaluate(base => {
 const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
 const rgba = (css: string): [number, number, number, number] => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
 const over = (top: number[], below: number[]) => [0, 1, 2].map(i => top[i] * top[3] + below[i] * (1 - top[3]));
 const light = (c: number[]) => { const [r, g, b] = c.map(v => { const s = v / 255; return s <= .03928 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
 const ratio = (a: number[], b: number[]) => { const [x, y] = [light(a), light(b)].sort((m, n) => n - m); return (x + .05) / (y + .05); };
 const backdrop = rgba(base);
 const behind = (el: Element) => { const chain: Element[] = []; for (let n: Element | null = el; n; n = n.parentElement) chain.unshift(n); let c = backdrop.slice(0, 3); for (const n of chain) { const b = rgba(getComputedStyle(n).backgroundColor); if (b[3] > 0) c = over(b, c); } return c; };
 const worst: { text: string; selector: string; ratio: number }[] = []; let counted = 0;
 const check = (el: Element, color: string, text: string) => {
  const fg = rgba(color), bg = behind(el), solid = over(fg, bg); const r = ratio(solid, bg); counted++;
  if (r < 4.5) worst.push({ text: text.slice(0, 40), selector: el.tagName.toLowerCase() + '.' + (el as HTMLElement).className, ratio: Math.round(r * 100) / 100 });
 };
 for (const el of document.querySelectorAll('#win *')) {
  const style = getComputedStyle(el); if (style.visibility === 'hidden' || style.display === 'none' || !(el as HTMLElement).getClientRects().length) continue;
  const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent!.trim()).map(n => n.textContent!.trim()).join(' ');
  if (own && !el.closest('.sr')) check(el, style.color, own);
 }
 const input = document.getElementById('composer')!; check(input, getComputedStyle(input, '::placeholder').color, 'placeholder');
 return { counted, worst };
}, under);

for (const scheme of ['dark', 'light'] as const) for (const [fill, under] of [['see-through over a dark window behind', '#000000'], ['see-through over a light window behind', '#ffffff'], ['solid', '#808080']] as const) {
 test(`every piece of text reaches 4.5:1 in ${scheme}, ${fill}`, async ({ page: p }) => {
  const reply = await partsReply;
  await start(p, request => request.startsWith('Look') ? calls(['send_message', { channel: 'email', to: 'bookings@tasca.example', subject: 'Booking', text: 'Table for two on Saturday at 8.' }]) : said(reply), p2 => { setTimeout(() => void host.receipt(p2.id, 'succeeded', 'Sent.'), 1); });
  try {
   await p.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
   if (fill === 'solid') await p.evaluate(() => (window as any).pipReceive({ kind: 'nativeStatus', payload: { hotkey: '⌘⇧E', visibleHeight: 800, solid: true } }));
   await ask('Plan my Friday around the dentist.'); await expect(page.locator('#cv').getByRole('region', { name: 'Draft' })).toBeVisible();
   await page.locator('#cv details.pt-fold summary').click();
   const answer = await contrastSweep(under); expect(answer.counted).toBeGreaterThan(60); expect(answer.worst).toEqual([]);
   await ask('Look at the tasca page for a table on Saturday'); await expect(page.getByRole('group', { name: 'Paused step' })).toBeVisible();
   const paused = await contrastSweep(under); expect(paused.counted).toBeGreaterThan(20); expect(paused.worst).toEqual([]);
  } finally { await host.close(); }
 });
}

test('the window is see-through by default and solid when the Mac asks for less transparency, more contrast, or the host says so', async ({ page: p }) => {
 await start(p, () => said('Hello.'));
 try {
  const alpha = async () => page.locator('#win').evaluate(el => { const c = document.createElement('canvas').getContext('2d')!; c.fillStyle = getComputedStyle(el).backgroundColor; c.fillRect(0, 0, 1, 1); return +(c.getImageData(0, 0, 1, 1).data[3] / 255).toFixed(2); });
  expect(await alpha()).toBe(0.92);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  expect(await alpha()).toBe(1);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] });
  expect(await alpha()).toBe(0.92);
  await page.emulateMedia({ contrast: 'more' }); expect(await alpha()).toBe(1); await page.emulateMedia({ contrast: 'no-preference' });
  await page.evaluate(() => (window as any).pipReceive({ kind: 'nativeStatus', payload: { hotkey: '⌘⇧E', visibleHeight: 800, solid: true } }));
  expect(await alpha()).toBe(1);
  await page.evaluate(() => (window as any).pipReceive({ kind: 'nativeStatus', payload: { hotkey: '⌘⇧E', visibleHeight: 800, solid: false } }));
  expect(await alpha()).toBe(0.92);
 } finally { await host.close(); }
});

test('Chats lists each conversation once, searches them, and opens one with its replies', async ({ page: p }) => {
 await start(p, request => said(request.startsWith('Plan') ? 'Friday is planned.' : 'The dentist is at 11:00.'));
 try {
  await ask('Plan my Friday'); await expect(page.locator('#cv')).toContainText('Friday is planned.');
  await ask('Move it to Monday'); await expect(page.locator('#cv')).toContainText('The dentist is at 11:00.');
  await page.getByRole('button', { name: 'New chat', exact: true }).click(); await expect(page.locator('#cv')).toBeHidden();
  await ask('Where is the dentist?'); await expect.poll(async () => (await host.snapshot()).works.length).toBe(3);
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  const rows = page.locator('#tl [data-chat]'); await expect(rows).toHaveCount(2);
  await expect(page.locator('#title')).toHaveText('Chats');
  await page.getByRole('searchbox', { name: 'Search chats' }).fill('friday'); await expect(rows).toHaveCount(1); await expect(rows).toContainText('Plan my Friday');
  await page.getByRole('searchbox', { name: 'Search chats' }).fill('nothing like this'); await expect(page.getByText('No chat matches.')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search chats' }).fill(''); await rows.filter({ hasText: 'Plan my Friday' }).click();
  await expect(page.locator('#cv')).toContainText('Friday is planned.'); await expect(page.locator('#cv')).toContainText('The dentist is at 11:00.');
  await expect(page.locator('#cv')).not.toContainText('Where is the dentist?');
 } finally { await host.close(); }
});

// Intent (kept from the retired Emberweave tests, ELF-18/ELF-20): the input meter follows only the measured level of the session the
// person started, and shows nothing before capture is reported; Close fades the window out and then hides it, and a second request hides at once.
test('the input meter follows only the measured level of the live dictation session', async ({ page: p }) => {
 await start(p, () => said('Hello.'));
 try {
  await page.getByRole('button', { name: 'Talk', exact: true }).click();
  await expect.poll(() => messages.filter(m => m.kind === 'dictation.start').length).toBe(1);
  const session = messages.find(m => m.kind === 'dictation.start').payload.session;
  const receiveDictation = (payload: object) => page.evaluate(payload => (window as any).pipReceive({ kind: 'dictation', payload }), payload);
  const heights = () => page.locator('#level i').evaluateAll(bars => bars.map(bar => parseFloat((bar as HTMLElement).style.height)));
  await expect(page.locator('#level')).toBeHidden(); // starting is not listening
  await receiveDictation({ session, state: 'capturing', text: '', message: 'Listening on this Mac.' });
  await expect(page.locator('#level')).toBeVisible(); await expect(page.locator('#workStatus')).toHaveText('Listening');
  await receiveDictation({ session, state: 'level', level: 0 }); expect((await heights()).every(h => h === 3)).toBe(true);
  await receiveDictation({ session, state: 'level', level: 0.9 }); const loud = await heights(); expect(Math.max(...loud)).toBeGreaterThan(10);
  await receiveDictation({ session: 'someone-else', state: 'level', level: 0 }); expect(await heights()).toEqual(loud);
  await receiveDictation({ session, state: 'review', text: 'hello', message: 'Review' }); await expect(page.locator('#level')).toBeHidden();
 } finally { await host.close(); }
});

test('Close fades the window out before the host hides it, and Escape twice hides at once', async ({ page: p }) => {
 await start(p, () => said('Hello.'));
 try {
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('body')).toHaveClass(/\bout\b/); expect(messages.some(m => m.kind === 'hide')).toBe(false);
  await expect.poll(() => messages.some(m => m.kind === 'hide'), { timeout: 2000 }).toBe(true);
  await page.evaluate(() => (window as any).pipReceive({ kind: 'popupHidden', payload: {} })); await expect(page.locator('#win')).toHaveCSS('opacity', '0');
  await page.evaluate(() => (window as any).pipReceive({ kind: 'summon', payload: {} })); await expect(page.locator('#win')).toHaveCSS('opacity', '1');
  messages.length = 0; await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await expect.poll(() => messages.filter(m => m.kind === 'hide').length, { timeout: 300 }).toBeGreaterThan(0);
 } finally { await host.close(); }
});
