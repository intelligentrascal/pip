import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitReply, parseParts } from '../runtime/reply.js';
import { PART_KINDS, PARTS_INSTRUCTIONS } from '../runtime/parts.js';

// Intent: the captain chose "the ten part kinds, drawn through OpenUI's library, no hand-written parts" for Pip's answers (ELF-65, ELF-60).
// Fixture: one reply with a fenced openui-lang block holding every kind, written the way the prompt teaches the model to write it.
const reply = readFileSync(new URL('./fixtures/reply-parts.md', import.meta.url), 'utf8');

test('a reply with a block of all ten kinds becomes text, the ten parts in order, then text', () => {
 const blocks = splitReply(reply);
 assert.deepEqual(blocks.map(block => block.type), ['text', 'parts', 'text']);
 const parts = (blocks[1] as { parts: { kind: string }[] }).parts;
 assert.deepEqual(parts.map(part => part.kind), PART_KINDS.map(kind => kind.toLowerCase()));
 const byKind = Object.fromEntries(parts.map(part => [part.kind, part])) as Record<string, any>;
 assert.deepEqual(byKind.plan.steps.map((step: any) => step.state), ['done', 'done', 'current', 'next']);
 assert.equal(byKind.draft.label, 'Email, not sent', 'a draft names itself without losing which part it is');
 assert.deepEqual(byKind.draft.fields.map((field: any) => field.name), ['To', 'Subject']);
 assert.equal(byKind.choice.options[0].suggested, true);
 assert.equal(byKind.sources.items[0].url, 'https://example.com/hours');
 assert.equal(byKind.sources.items[1].url, undefined, 'a source without an address stays a file');
 assert.match(byKind.pictures.items[0].src, /^data:image\/png;base64,/);
 assert.equal(byKind.pictures.items[1].src, undefined);
});

test('the example in the instructions Pip is given parses to the part it shows', () => {
 const example = PARTS_INSTRUCTIONS.match(/```openui-lang\n([\s\S]*?)\n```/)![1];
 const parts = parseParts(example)!;
 assert.equal(parts[0].kind, 'plan');
 assert.equal((parts[0].steps as unknown[]).length, 2);
});

test('a block the library cannot draw is kept as code so no words are lost', () => {
 const broken = 'Before.\n\n```openui-lang\nroot = Parts([Plan(\n```\n\nAfter.';
 const blocks = splitReply(broken);
 assert.deepEqual(blocks.map(block => block.type), ['text', 'text', 'text']);
 assert.match((blocks[1] as { text: string }).text, /^```\nroot = Parts\(\[Plan\(\n```$/);
 const unknown = splitReply('```openui-lang\nroot = Parts([Button("Run it")])\nButton = 1\n```');
 assert.equal(unknown[0].type, 'text', 'a kind outside the ten is never drawn');
});

test('links and pictures are limited to what is safe to draw', () => {
 const parts = parseParts([
  'root = Parts([sources, pictures, table])',
  'sources = Sources([Source("Plain page", "https://example.com/a"), Source("Script", "javascript:alert(1)"), Source("Login in the address", "https://user:secret@example.com/"), Source("Insecure", "http://example.com/")])',
  'pictures = Pictures([Picture("Remote", "https://example.com/x.png"), Picture("Script", "data:text/html;base64,PGI+")])',
  'table = Table("Short row", ["A", "B", "C"], [["1"], ["1", "2", "3", "4"]])'
 ].join('\n'))!;
 const [sources, pictures, table] = parts as any[];
 assert.deepEqual(sources.items.map((item: any) => item.url), ['https://example.com/a', undefined, undefined, undefined]);
 assert.deepEqual(pictures.items.map((item: any) => item.src), [undefined, undefined]);
 assert.deepEqual(table.rows, [['1', '', ''], ['1', '2', '3']], 'every row is as wide as its columns');
});
