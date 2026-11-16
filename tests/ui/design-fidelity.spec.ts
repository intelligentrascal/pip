import { test, expect } from '@playwright/test';
import { composer } from '../helpers/chat-page.js';
import { openApp } from '../helpers/app-page.js';
import { initialState, type State, type Work } from '../../runtime/domain.js';
import { liveBlocks, splitReply } from '../../runtime/reply.js';

// Intent: Pip must match the design the captain settled in ELF-65, as ELF-73's audit found it did not: parts drawn while the reply arrives, a message
// box that grows to six lines, Increase Contrast borders, a clock that rests while the window is hidden, and saved chats that reopen on their steps.
// Fixture: Pip's real page; the host's own message shapes (state, live, nativeStatus, popupHidden); live blocks come from the runtime's own splitter.
test.use({ viewport: { width: 756, height: 720 } });
const now = () => Date.now();
const work = (over: Partial<Work> = {}): Work => ({ id: 'w1', request: 'Plan my Friday around the dentist.', status: 'Working', result: null, error: '', taskId: 1, createdAt: new Date(now() - 60000).toISOString(), updatedAt: new Date().toISOString(), threadId: 'c1', sessionId: 's', usage: { attempts: 1, activeMilliseconds: 9000 }, ...over });
const state = (works: Work[]): State => ({ ...initialState(), works });
const limits = { turns: 24, milliseconds: 600000 };
const live = (words: string, steps: any[] = []) => ({ running: true, startedAt: now() - 3000, turns: 1, steps, words, blocks: liveBlocks(words), limits, now: now() });
const reply = 'Here is the day.\n\n```openui-lang\nroot = Parts([plan, note])\nplan = Plan("Friday", [Step("Call with Marta", "done", "09:00"), Step("Tax letter", "current", "13:30")])\nnote = Note("Nothing here was sent.", "ok")\n```\n\nThe afternoon is free.';

test('parts draw as soon as their block arrives, never as notation, and are not drawn again when the work ends', async ({ page }) => {
 const app = await openApp(page);
 await app.receive({ kind: 'state', payload: { state: state([work()]), workViews: [], replies: {} } }); await app.receive({ kind: 'summon', payload: {} });
 const cv = page.locator('#cv');
 const fence = reply.indexOf('```openui-lang'), closed = reply.indexOf('```', fence + 3) + 3;
 for (let length = 20; length <= reply.length; length += 25) {
  await app.receive({ kind: 'live', payload: live(reply.slice(0, length)) });
  const text = await cv.innerText();
  expect(text, `at ${length}`).not.toMatch(/openui-lang|root = Parts/);
  expect(await cv.locator('.pt-plan').count(), `at ${length}`).toBe(length >= closed ? 1 : 0);
 }
 await expect(cv.getByRole('region', { name: 'Plan' }).locator('.pr')).toHaveCount(2);
 await expect(cv.locator('.live-words').first()).toHaveText('Here is the day.');
 // The finished answer replaces the live rows with the same parts, which do not arrive a second time.
 await page.evaluate(() => { (window as any).__arrivals = 0; const original = (window as any).PipMagic.prototype.part; (window as any).PipMagic.prototype.part = function (el: any) { (window as any).__arrivals++; return original.call(this, el); }; });
 const done = work({ status: 'Done', result: { kind: 'answer', title: '', text: reply, sources: [], model: 'fixture', sessionId: 's' } });
 await app.receive({ kind: 'state', payload: { state: state([done]), workViews: [], replies: { w1: splitReply(reply) } } });
 await expect(cv.locator('.pt-plan')).toHaveCount(1);
 await page.waitForTimeout(300);
 expect(await page.evaluate(() => (window as any).__arrivals)).toBe(0);
 expect(await cv.locator('.pt-plan.ar').count()).toBe(0);
});

test('the message box grows to six lines before it scrolls, and its bottom does not move', async ({ page }) => {
 await openApp(page);
 const box = composer(page); await box.focus();
 const bottom = async () => { const b = (await box.boundingBox())!; return Math.round(b.y + b.height); };
 await page.waitForTimeout(450);
 const start = await bottom(), lineHeight = await box.evaluate(c => parseFloat(getComputedStyle(c).lineHeight));
 expect(lineHeight).toBeCloseTo(21.42, 1);
 for (let lines = 1; lines <= 7; lines++) {
  await box.fill(Array.from({ length: lines }, (_, i) => `Line ${i + 1}`).join('\n')); await page.waitForTimeout(450);
  const { height, scrolls } = await box.evaluate(c => ({ height: c.getBoundingClientRect().height, scrolls: c.scrollHeight > c.clientHeight + 1 }));
  if (lines <= 6) { expect(scrolls, `${lines} lines do not scroll`).toBe(false); expect(height).toBeGreaterThanOrEqual(lines * lineHeight); }
  else { expect(scrolls, 'a seventh line scrolls').toBe(true); expect(height).toBeLessThan(7 * lineHeight); }
  expect(await bottom(), `${lines} lines`).toBe(start);
 }
});

test('Increase Contrast turns the window and both line colours into the secondary text colour, solid', async ({ page }) => {
 const app = await openApp(page);
 await app.receive({ kind: 'state', payload: { state: state([work({ status: 'Done', result: { kind: 'answer', title: '', text: reply, sources: [], model: 'fixture', sessionId: 's' } })]), workViews: [], replies: { w1: splitReply(reply) } } });
 await app.receive({ kind: 'summon', payload: {} });
 const colours = () => page.evaluate(() => {
  (document.activeElement as HTMLElement | null)?.blur();
  const probe = document.createElement('i'); probe.style.color = 'var(--t2)'; document.body.append(probe); const secondary = getComputedStyle(probe).color; probe.remove();
  const border = (selector: string) => getComputedStyle(document.querySelector(selector)!).borderTopColor;
  return { secondary, window: border('#win'), part: border('.pl'), ask: border('#ask'), bg: getComputedStyle(document.getElementById('win')!).backgroundColor };
 });
 const normal = await colours();
 expect(normal.window).not.toBe(normal.secondary);
 await page.emulateMedia({ contrast: 'more' });
 const more = await colours();
 expect([more.window, more.part, more.ask]).toEqual([more.secondary, more.secondary, more.secondary]);
 expect(more.bg).toMatch(/^rgb\(/);
 // The host reports the same preference to the page, for a web view that does not.
 await page.emulateMedia({ contrast: 'no-preference' });
 await app.receive({ kind: 'nativeStatus', payload: { hotkey: '⌘⇧E', visibleHeight: 800, solid: true, contrast: true } });
 const reported = await colours();
 expect([reported.window, reported.part]).toEqual([reported.secondary, reported.secondary]);
});

test('the clock and the running row rest while the window is hidden, and read the true time when it returns', async ({ page }) => {
 const app = await openApp(page);
 await app.receive({ kind: 'state', payload: { state: state([work()]), workViews: [], replies: {} } }); await app.receive({ kind: 'summon', payload: {} });
 const started = now() - 3000;
 await app.receive({ kind: 'live', payload: { running: true, startedAt: started, turns: 1, steps: [{ id: 's1', label: 'Read the calendar', state: 'running', startedAt: started }], words: '', blocks: [], limits, now: now() } });
 const status = page.locator('#status');
 await expect.poll(async () => (await status.innerText())).toMatch(/0:0[3-5]/);
 await page.evaluate(() => { (window as any).__writes = 0; new MutationObserver(() => (window as any).__writes++).observe(document.getElementById('status')!, { childList: true, characterData: true, subtree: true }); });
 await app.receive({ kind: 'popupHidden', payload: {} });
 await page.waitForTimeout(1600);
 expect(await page.evaluate(() => (window as any).__writes), 'nothing is redrawn while hidden').toBe(0);
 await app.receive({ kind: 'summon', payload: {} });
 await expect.poll(async () => (await status.innerText())).toMatch(/0:0[5-9]/);
 const after = await page.evaluate(() => (window as any).__writes);
 await page.waitForTimeout(1100);
 expect(await page.evaluate(() => (window as any).__writes), 'it ticks again once shown').toBeGreaterThan(after);
});

test('a saved chat reopens on its steps, listed in the order they ran', async ({ page }) => {
 const app = await openApp(page);
 const steps = [{ label: 'Read the calendar', state: 'done', milliseconds: 1300 }, { label: 'Searched for “tax letter hours”', state: 'done', milliseconds: 2400 }, { label: 'Read example.com', state: 'failed', milliseconds: 3100 }];
 const done = work({ status: 'Done', steps: steps as Work['steps'], result: { kind: 'answer', title: '', text: 'The tax office opens at 9.', sources: [], model: 'fixture', sessionId: 's' } });
 await app.receive({ kind: 'state', payload: { state: state([done]), workViews: [], replies: {} } });
 await app.receive({ kind: 'summon', payload: {} });
 const fold = page.locator('#cv button.ac');
 await expect(fold).toContainText('Worked 9.0 s, 3 steps');
 await fold.click();
 await expect(page.locator('#cv .acs .acs .ac')).toHaveCount(3);
 await expect(page.locator('#cv .acs .acs .ac span')).toHaveText(['Read the calendar', 'Searched for “tax letter hours”', 'Read example.com']);
 await expect(page.locator('#cv .acs .acs .ac.bad')).toHaveCount(1);
});
