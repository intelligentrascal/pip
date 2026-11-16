import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, idle, reduce, replay } from '../runtime/live.js';

// Intent: Pip's working view draws "one row per step, in plain words, with its time" from the conversation's own events (the captain's
// Lantern working screen, ELF-65). Fixture: events recorded from a real conversation run (two asks, one present_draft tool call);
// the one streamed-words event is built from pi-durable's own MessageChange type, because the recording engine did not stream.
const batches: { events?: Record<string, unknown>[] }[] = JSON.parse(readFileSync(new URL('./fixtures/conversation-events.json', import.meta.url), 'utf8'));
const events = batches.flatMap(batch => batch.events ?? []);
const clock = () => { let now = 1000; return () => (now += 250); };

test('a recorded run becomes one finished step row in the words a person would use', () => {
 const live = replay(events, clock());
 assert.equal(live.running, false);
 assert.deepEqual(live.steps.map(step => [step.label, step.state]), [['Wrote a draft', 'done']]);
 assert.ok((live.steps[0].milliseconds ?? -1) >= 0);
 assert.equal(live.turns, 2, 'the second ask took two model turns: the tool call and the answer');
});

test('a run in progress shows a running row, and the end of the run finishes it', () => {
 const upto = events.findIndex(event => event.type === 'tool_execution_end');
 const mid = replay(events.slice(0, upto), clock());
 assert.equal(mid.running, true);
 assert.equal(mid.steps[0].state, 'running');
 const ended = reduce(mid, { type: 'run_end' }, 99999);
 assert.equal(ended.running, false);
 assert.equal(ended.steps[0].state, 'done');
});

test('streamed words accumulate and start again with the next model turn', () => {
 let live = reduce(idle(), { type: 'run_start' }, 1);
 live = reduce(live, { type: 'message_start', message: { role: 'assistant' } }, 2);
 live = reduce(live, { type: 'message_update', changes: [{ type: 'text_delta', contentIndex: 0, delta: 'Looking ' }, { type: 'thinking_delta', contentIndex: 1, delta: 'private' }, { type: 'text_delta', contentIndex: 0, delta: 'at Friday' }] }, 3);
 assert.equal(live.words, 'Looking at Friday', 'only text, never thinking');
 live = reduce(live, { type: 'message_start', message: { role: 'assistant' } }, 4);
 assert.equal(live.words, '');
 assert.equal(live.turns, 2);
});

test('a tool is named by what it did, never by its tool name', () => {
 assert.equal(describe('read', { path: '/Users/ana/notes/friday.txt' }), 'Read friday.txt');
 assert.equal(describe('read_public_url', { url: 'https://example.com/hours?x=1' }), 'Read example.com');
 assert.equal(describe('send_message', {}), 'Sent a message');
 assert.equal(describe('some_new-tool', {}), 'Some new tool');
});
