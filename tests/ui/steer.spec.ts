import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openHost, type Host } from '../../runtime/pi-durable-adapter.js';
import { trackerRecords } from '../../runtime/tracker.js';
import { repliesOf } from '../../runtime/reply.js';
import { composer } from '../helpers/chat-page.js';
import { fauxEngine, said, held } from '../helpers/faux-engine.js';

// Intent: the captain's ask for the Steer box (ELF-65 spec): typing while Pip works shows an accent Steer button and "Tell Pip to change
// course"; Return redirects Pip without stopping him; an empty box keeps the neutral Stop. Fixture: Pip's real page and host with a
// scripted model that waits until the test lets it answer, so the working state is real, not painted.
test.use({ viewport: { width: 756, height: 800 } });
let host: Host, page: Page;
const sent: any[] = [];
async function receive() {
 if (!host) return;
 const state = await host.snapshot();
 await page.evaluate(message => (window as any).pipReceive(message), { kind: 'state', payload: { state, replies: repliesOf(state.works), workViews: trackerRecords(state, 'work') } });
}
async function start(browserPage: Page, models: Parameters<ReturnType<typeof fauxEngine>['faux']['setResponses']>[0], steerBridge: (m: any) => Promise<void> | void = m => host.steer(m.payload.workId, m.payload.request)) {
 page = browserPage; sent.length = 0;
 const base = process.env.PIP_TEST_ROOT ?? path.join(os.tmpdir(), 'pip-ui-fixtures'); await mkdir(base, { recursive: true });
 const home = await mkdtemp(path.join(base, 'pip-')); await writeFile(path.join(home, '.pip-test-home'), 'pip-test-only');
 const { faux, engine } = fauxEngine(); faux.setResponses(models);
 host = await openHost({ home, fixture: true, engine, retry: { maxRetries: 0 }, changed: () => { void receive().catch(() => {}); } });
 let line = Promise.resolve();
 await page.exposeFunction('pipTestBridge', (m: any) => { line = line.then(async () => {
  sent.push(m); const p = m.payload;
  if (m.kind === 'submit') await host.submit(m.id, p.request, p.contextWorkId);
  if (m.kind === 'saveComposer') await host.saveComposer(p.text);
  if (m.kind === 'cancel') await host.cancel(p.id);
  if (m.kind === 'stop') await host.stop();
  if (m.kind === 'snapshot') await receive();
  if (m.kind === 'steer') {
   try { await steerBridge(m); } catch (error) { await page.evaluate(message => (window as any).pipReceive(message), { id: m.id, kind: 'error', payload: { message: (error as Error).message } }); }
  }
 }); return line; });
 await page.goto('/'); await page.evaluate(() => (window as any).pipReceive({ kind: 'nativeStatus', payload: { hotkey: '⌘⇧E', visibleHeight: 800 } }));
}
const send = (page: Page) => page.locator('#send');

test('typing while Pip works turns Stop into an accent Steer, and Return redirects him without stopping him', async ({ page: browserPage }) => {
 const hold = held();
 await start(browserPage, [hold.step, said('Friday: dentist at 11:00, then two clear hours from 8:00.')]);
 try {
  await composer(page).fill('Plan my Friday around the dentist.'); await composer(page).press('Enter');
  await hold.entered;
  await expect(page.locator('#workStatus')).toContainText('Working');
  // Empty box: the neutral Stop, and the placeholder invites a change of course.
  await expect(composer(page)).toHaveAttribute('placeholder', 'Tell Pip to change course');
  await expect(send(page)).toHaveAttribute('data-mode', 'stop');
  await expect(send(page)).toHaveAccessibleName('Stop');
  // Typing: the accent Steer, and the bottom row says what Return does.
  await composer(page).fill('Mornings only, please.');
  await expect(send(page)).toHaveAttribute('data-mode', 'steer');
  await expect(send(page)).toHaveText('Steer');
  await expect(send(page)).toHaveAccessibleName('Steer Pip');
  expect(await send(page).evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await page.evaluate(() => { const probe = document.createElement('i'); probe.style.background = 'var(--ac)'; document.body.append(probe); const color = getComputedStyle(probe).backgroundColor; probe.remove(); return color; }));
  await expect(page.locator('#shortcut')).toHaveText('Return redirects Pip · Esc stops');
  await composer(page).press('Enter');
  // The steer is in the conversation as the person's own message, the box is empty again, and Pip is still on the same ask.
  await expect(page.locator('#cv [data-steer]')).toHaveText('Mornings only, please.');
  await expect(composer(page)).toHaveValue('');
  expect(sent.filter(m => m.kind === 'steer').map(m => m.payload.request)).toEqual(['Mornings only, please.']);
  expect(sent.filter(m => m.kind === 'stop')).toEqual([]);
  expect((await host.snapshot()).works.map(w => w.status)).toEqual(['Working']);
  hold.release('Friday looks open from 2 pm.');
  await expect(page.locator('#cv')).toContainText('Friday: dentist at 11:00');
  expect((await host.snapshot()).works.length).toBe(1);
  await expect(page.locator('#cv [data-steer]')).toHaveText('Mornings only, please.');
 } finally { await host.close(); }
});

test('an empty box while Pip works keeps Stop, and Stop does stop him', async ({ page: browserPage }) => {
 const hold = held();
 await start(browserPage, [hold.step]);
 try {
  await composer(page).fill('Plan my Friday.'); await composer(page).press('Enter'); await hold.entered;
  await send(page).click();
  await expect.poll(async () => (await host.snapshot()).works[0].status).toBe('Stopped');
  expect(sent.filter(m => m.kind === 'steer')).toEqual([]);
 } finally { await host.close(); }
});

test('if Pip had just finished, the steer is refused and the words come back to the message box', async ({ page: browserPage }) => {
 const hold = held();
 await start(browserPage, [hold.step], () => { throw new Error('Pip is not working on that any more. Send it as a new message.'); });
 try {
  await composer(page).fill('Plan my Friday.'); await composer(page).press('Enter'); await hold.entered;
  await composer(page).fill('Mornings only, please.'); await composer(page).press('Enter');
  await expect(composer(page)).toHaveValue('Mornings only, please.');
  await expect(page.locator('#status')).toContainText('not working on that any more');
  await expect(page.locator('#cv [data-steer]')).toHaveCount(0);
 } finally { await host.close(); }
});

test('at a paused step, telling Pip instead cancels the step and steers the same ask', async ({ page: browserPage }) => {
 const { faux, engine } = fauxEngine();
 page = browserPage; sent.length = 0;
 const base = process.env.PIP_TEST_ROOT ?? path.join(os.tmpdir(), 'pip-ui-fixtures'); await mkdir(base, { recursive: true });
 const home = await mkdtemp(path.join(base, 'pip-')); await writeFile(path.join(home, '.pip-test-home'), 'pip-test-only');
 const { calls } = await import('../helpers/faux-engine.js');
 faux.setResponses([calls(['send_message', { channel: 'email', to: 'ana@example.com', subject: 'Friday', text: 'Dinner is at 8.' }]), said('I left Ana out and planned the evening.')]);
 const natives: string[] = [];
 host = await openHost({ home, fixture: true, engine, retry: { maxRetries: 0 }, native: p => { natives.push(p.action.type); }, changed: () => { void receive().catch(() => {}); } });
 let line = Promise.resolve();
 await page.exposeFunction('pipTestBridge', (m: any) => { line = line.then(async () => {
  sent.push(m); const p = m.payload;
  if (m.kind === 'submit') await host.submit(m.id, p.request, p.contextWorkId);
  if (m.kind === 'saveComposer') await host.saveComposer(p.text);
  if (m.kind === 'cancel') await host.cancel(p.id);
  if (m.kind === 'steer') await host.steer(p.workId, p.request);
  if (m.kind === 'snapshot') await receive();
 }); return line; });
 await page.goto('/'); await page.evaluate(() => (window as any).pipReceive({ kind: 'nativeStatus', payload: { hotkey: '⌘⇧E', visibleHeight: 800 } }));
 try {
  await composer(page).fill('Plan dinner for Friday.'); await composer(page).press('Enter');
  await expect(page.getByRole('group', { name: 'Paused step' })).toBeVisible();
  await expect(composer(page)).toHaveAttribute('placeholder', 'Or tell Pip what to do instead');
  await composer(page).fill('Do not message anyone, just plan the evening.'); await composer(page).press('Enter');
  await expect(page.locator('#cv')).toContainText('I left Ana out');
  expect(natives).toEqual([]);
  expect((await host.snapshot()).works.length).toBe(1);
  await expect(page.locator('#cv [data-steer]')).toHaveText('Do not message anyone, just plan the evening.');
 } finally { await host.close(); }
});
