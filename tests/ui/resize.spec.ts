import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openHost, type Host } from '../../runtime/pi-durable-adapter.js';
import { trackerRecords } from '../../runtime/tracker.js';
import { repliesOf } from '../../runtime/reply.js';
import { openApp } from '../helpers/app-page.js';
import { composer } from '../helpers/chat-page.js';
import { fauxEngine, said } from '../helpers/faux-engine.js';

// Intent: the captain's ask for resizing (ELF-65 spec): dragging the window's left edge sets its width, 420 to 760 pt, dragging its top edge
// sets the most height, both are remembered by the host, and the window does not move (the host's panel keeps its right side and bottom,
// checked in PanelGeometryChecks). ELF-70's bug: a cold launch measured a zero-sized web view and opened 420 pt wide, so the page must
// never send a width unless the person is dragging. Fixture: Pip's real page; the host is a recording stand-in, or a real host for a long answer.
test.use({ viewport: { width: 756, height: 800 } });
const edge = async (page: Page, which: 'left' | 'top', by: number) => {
 const box = (await page.locator('#win').boundingBox())!;
 const from = which === 'left' ? { x: box.x + 2, y: box.y + box.height / 2 } : { x: box.x + box.width / 2, y: box.y + 2 };
 await page.mouse.move(from.x, from.y); await page.mouse.down();
 for (let step = 1; step <= 10; step++) await page.mouse.move(which === 'left' ? from.x - (by * step) / 10 : from.x, which === 'top' ? from.y - (by * step) / 10 : from.y);
 await page.mouse.up();
};
const kinds = (sent: any[], kind: string) => sent.filter(m => m.kind === kind).map(m => m.payload);

test('a cold launch never sends a width: a web view with no size cannot narrow the window to 420 pt', async ({ page }) => {
 await page.setViewportSize({ width: 100, height: 100 });
 const { sent } = await openApp(page);
 await page.setViewportSize({ width: 756, height: 300 });
 await expect.poll(() => kinds(sent, 'resize').length).toBeGreaterThan(0);
 for (const resize of kinds(sent, 'resize')) { expect(resize).not.toHaveProperty('windowWidth'); expect(Number.isFinite(resize.windowHeight)).toBe(true); }
 expect(kinds(sent, 'configureWindow')).toEqual([]);
});

test('dragging the left edge sends the new width, held between 420 and 760 pt, and remembers it when let go', async ({ page }) => {
 const { sent } = await openApp(page, { windowWidth: 600 });
 await edge(page, 'left', 100);
 const widths = kinds(sent, 'resize').map(r => r.windowWidth).filter(Boolean);
 expect(widths.at(-1)).toBe(700);
 expect(widths).toEqual([...widths].sort((a, b) => a - b));
 expect(kinds(sent, 'configureWindow')).toEqual([{ width: 700, most: 0 }]);
 await edge(page, 'left', 400);
 expect(kinds(sent, 'resize').map(r => r.windowWidth).filter(Boolean).at(-1)).toBe(760);
 expect(kinds(sent, 'configureWindow').at(-1)).toEqual({ width: 760, most: 0 });
 await edge(page, 'left', -400);
 expect(kinds(sent, 'configureWindow').at(-1)).toEqual({ width: 420, most: 0 });
 expect(kinds(sent, 'resize').map(r => r.windowWidth).filter(Boolean).at(-1)).toBe(420);
});

test('Pip opens at the remembered width and most height, and the next drag starts from them', async ({ page }) => {
 const { sent } = await openApp(page, { windowWidth: 700, mostHeight: 640 });
 expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--cap'))).toBe('640px');
 await edge(page, 'left', 20);
 expect(kinds(sent, 'configureWindow')).toEqual([{ width: 720, most: 640 }]);
});

test('dragging the top edge sets the most height, held between 320 pt and the top of the screen, and the window settles back to its content', async ({ page }) => {
 const { sent } = await openApp(page);
 const cap = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--cap'));
 expect(await cap()).toBe('560px');
 const empty = Math.round((await page.locator('#win').boundingBox())!.height);
 const grow = (async () => { const box = (await page.locator('#win').boundingBox())!; await page.mouse.move(box.x + box.width / 2, box.y + 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y - 218, { steps: 8 }); })();
 await grow;
 // While dragging, the window follows the pointer even though its content is short.
 expect(Math.round((await page.locator('#win').boundingBox())!.height)).toBe(empty + 220);
 await page.mouse.up();
 expect(await cap()).toBe(`${empty + 220}px`);
 expect(kinds(sent, 'configureWindow').at(-1)).toEqual({ width: expect.any(Number), most: empty + 220 });
 await expect.poll(async () => Math.round((await page.locator('#win').boundingBox())!.height)).toBe(empty);
 expect(kinds(sent, 'resize').some(r => r.mostHeight === empty + 220)).toBe(true);
 await edge(page, 'top', 3000);
 expect(await cap()).toBe('764px');
 await expect.poll(async () => Math.round((await page.locator('#win').boundingBox())!.height)).toBe(empty);
 const top = (await page.locator('#win').boundingBox())!;
 await page.mouse.move(top.x + top.width / 2, top.y + 2); await page.mouse.down(); await page.mouse.move(top.x + top.width / 2, top.y + 3000, { steps: 8 }); await page.mouse.up();
 expect(await cap()).toBe('320px');
});

test('a long conversation grows to the chosen most height and scrolls inside it', async ({ page }) => {
 const base = process.env.PIP_TEST_ROOT ?? path.join(os.tmpdir(), 'pip-ui-fixtures'); await mkdir(base, { recursive: true });
 const home = await mkdtemp(path.join(base, 'pip-')); await writeFile(path.join(home, '.pip-test-home'), 'pip-test-only');
 const { faux, engine } = fauxEngine(); faux.setResponses([said(Array.from({ length: 60 }, (_, i) => `Line ${i + 1} of a long answer.`).join('\n\n'))]);
 let host!: Host;
 const receive = async () => { const state = await host.snapshot(); await page.evaluate(message => (window as any).pipReceive(message), { kind: 'state', payload: { state, replies: repliesOf(state.works), workViews: trackerRecords(state, 'work') } }); };
 host = await openHost({ home, fixture: true, engine, retry: { maxRetries: 0 }, changed: () => { void receive().catch(() => {}); } });
 try {
  await page.exposeFunction('pipTestBridge', async (m: any) => { if (m.kind === 'submit') await host.submit(m.id, m.payload.request); if (m.kind === 'saveComposer') await host.saveComposer(m.payload.text); if (m.kind === 'snapshot') await receive(); });
  await page.goto('/'); await page.evaluate(() => (window as any).pipReceive({ kind: 'nativeStatus', payload: { visibleHeight: 800 } }));
  await composer(page).fill('Write a long answer.'); await composer(page).press('Enter');
  await expect(page.locator('#cv')).toContainText('Line 60');
  await expect.poll(async () => Math.round((await page.locator('#win').boundingBox())!.height)).toBe(560);
  await page.evaluate(() => (window as any).pipReceive({ kind: 'nativeStatus', payload: { visibleHeight: 800, mostHeight: 700 } }));
  await expect.poll(async () => Math.round((await page.locator('#win').boundingBox())!.height)).toBe(700);
  expect(await page.locator('#cv').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
 } finally { await host.close(); }
});
