import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openHost } from '../runtime/pi-durable-adapter.js';
import { fauxEngine, said, calls } from './helpers/faux-engine.js';
import { testHome, until, finished } from './helpers/ask.js';

// Intent: ELF-65's agreed design says finished work reopens on its steps ("Worked 9 seconds, 3 steps"); ELF-73 found that the steps lived only
// in the page's memory, so a saved chat opened with none. Fixture: a real host with a scripted model that really runs two tools, then a
// second host opened on the same home, the way a restart reads it.
test('a finished ask keeps the steps it took, in the words the page showed, and they survive a restart', async () => {
 const home = await testHome('pip-steps-'); const { faux, engine } = fauxEngine();
 faux.setResponses([calls(['write', { path: 'notes/tea.txt', content: 'Two sugars.' }]), calls(['read', { path: 'notes/tea.txt' }]), said('Saved and read back.')]);
 const first = await openHost({ home, fixture: true, engine, retry: { maxRetries: 0 } });
 try {
  await first.submit('tea', 'Write down how I take my tea, then read it back.');
  const work = (await until(first, finished('tea'))).works[0];
  assert.equal(work.status, 'Done');
  assert.deepEqual(work.steps?.map(step => [step.label, step.state]), [['Wrote tea.txt', 'done'], ['Read tea.txt', 'done']]);
  assert.ok(work.steps!.every(step => typeof step.milliseconds === 'number'), 'each step keeps how long it took');
 } finally { await first.close(); }
 const second = await openHost({ home, fixture: true, engine, retry: { maxRetries: 0 } });
 try { assert.deepEqual((await second.snapshot()).works[0].steps?.map(step => step.label), ['Wrote tea.txt', 'Read tea.txt']); } finally { await second.close(); }
});

test('an ask that took no steps keeps none, and the next ask does not inherit the last ask\'s steps', async () => {
 const home = await testHome('pip-steps-'); const { faux, engine } = fauxEngine();
 faux.setResponses([calls(['write', { path: 'a.txt', content: 'x' }]), said('Wrote it.'), said('Hello.')]);
 const host = await openHost({ home, fixture: true, engine, retry: { maxRetries: 0 } });
 try {
  await host.submit('one', 'Write a.txt.'); await until(host, finished('one'));
  await host.submit('two', 'Say hello.');
  const state = await until(host, finished('two'));
  assert.equal(state.works.find(w => w.id === 'one')!.steps?.length, 1);
  assert.equal(state.works.find(w => w.id === 'two')!.steps, undefined);
 } finally { await host.close(); }
});
