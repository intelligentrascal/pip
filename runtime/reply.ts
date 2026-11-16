/** Splits one finished reply into the blocks the page draws: markdown text, and parts parsed by OpenUI's library.
 * Parsing and checking happen here, never in the page, so the page receives plain data it draws with text nodes only.
 * A block the library cannot parse or check is kept as plain text, so no words are ever lost. */
import { createParser, type ElementNode } from '@openuidev/lang-core';
import { PART_KINDS, partsSchema } from './parts.js';

export type Part = {kind: string; [prop: string]: unknown};
export type Block = {type: 'text'; text: string} | {type: 'parts'; parts: Part[]};

const FENCE = /^```openui-lang[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm;
const LIMITS = {text: 4000, items: 60, parts: 12, picture: 1_500_000};
let parser: ReturnType<typeof createParser> | undefined;

const clip = (value: unknown) => String(value).slice(0, LIMITS.text);
const isElement = (value: unknown): value is ElementNode => !!value && typeof value === 'object' && (value as {type?: unknown}).type === 'element';
const publicUrl = (value: unknown) => {
 if (typeof value !== 'string') return undefined;
 try { const url = new URL(value); return url.protocol === 'https:' && url.username === '' && url.password === '' ? url.href : undefined; } catch { return undefined; }
};
const pictureSource = (value: unknown) => typeof value === 'string' && value.length <= LIMITS.picture && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : undefined;

/** An element becomes {kind, ...props}; its children are normalised the same way. */
function plain(value: unknown): unknown {
 if (isElement(value)) {
  const out: Part = {kind: ''};
  for (const [name, prop] of Object.entries(value.props)) {
   const next = plain(prop);
   if (next !== undefined) out[name] = next;
  }
  // Set last, so no prop of the part can ever replace which part it is.
  out.kind = value.typeName.toLowerCase();
  return out;
 }
 if (Array.isArray(value)) return value.slice(0, LIMITS.items).map(plain).filter(item => item !== null && item !== undefined);
 if (typeof value === 'string') return clip(value);
 if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
 if (typeof value === 'boolean') return value;
 return undefined;
}

/** Last checks the schema cannot express: rows as wide as their columns, public https links, picture data. */
function check(part: Part): Part | undefined {
 if (!PART_KINDS.map(kind => kind.toLowerCase()).includes(part.kind)) return undefined;
 const list = (name: string) => Array.isArray(part[name]) ? part[name] as Part[] : [];
 if (part.kind === 'table') {
  const columns = (part.columns as string[] | undefined) ?? [];
  if (!columns.length) return undefined;
  part.rows = ((part.rows as string[][] | undefined) ?? []).map(row => columns.map((_, index) => String(row?.[index] ?? '')));
 }
 if (part.kind === 'chart') { part.bars = list('bars').filter(bar => typeof bar.value === 'number'); if (!(part.bars as Part[]).length) return undefined; }
 if (part.kind === 'plan' && !list('steps').length) return undefined;
 if (part.kind === 'choice') { part.options = list('options').slice(0, 5); if (!(part.options as Part[]).length) return undefined; }
 if (part.kind === 'figure' && !((part.stops as unknown[] | undefined)?.length)) return undefined;
 if (part.kind === 'sources') {
  part.items = list('items').map(item => { const url = publicUrl(item.url); const {url: _drop, ...rest} = item; return url ? {...rest, url} : rest; });
  if (!(part.items as Part[]).length) return undefined;
 }
 if (part.kind === 'pictures') {
  part.items = list('items').slice(0, 6).map(item => { const src = pictureSource(item.src); const {src: _drop, ...rest} = item; return src ? {...rest, src} : rest; });
  if (!(part.items as Part[]).length) return undefined;
 }
 return part;
}

/** The parts in one fenced block, or undefined when the library cannot draw it whole. */
export function parseParts(source: string): Part[] | undefined {
 parser ??= createParser(partsSchema(), 'Parts');
 let result;
 try { result = parser.parse(source); } catch { return undefined; }
 if (!result.root || result.meta.incomplete || result.meta.errors.length || result.meta.unresolved.length) return undefined;
 const children = result.root.props.children;
 if (!Array.isArray(children)) return undefined;
 const parts = (children.slice(0, LIMITS.parts).map(plain) as Part[]).map(check);
 return parts.length && parts.every(Boolean) ? parts as Part[] : undefined;
}

export function splitReply(reply: string): Block[] {
 const blocks: Block[] = [];
 const words = (text: string) => { const trimmed = text.replace(/^\s*\n/, '').replace(/\s+$/, ''); if (trimmed) blocks.push({type: 'text', text: trimmed}); };
 let last = 0;
 for (const match of reply.matchAll(FENCE)) {
  words(reply.slice(last, match.index));
  const parts = parseParts(match[1]);
  // A block that cannot be drawn is kept as the code it is, so the person still reads what Pip wrote.
  if (parts) blocks.push({type: 'parts', parts}); else blocks.push({type: 'text', text: '```\n' + match[1] + '\n```'});
  last = match.index + match[0].length;
 }
 words(reply.slice(last));
 return blocks;
}

/** The blocks of a reply that is still arriving. A fenced part block is drawn as soon as its closing fence has arrived and the library can
 * draw it whole; the lines of a fence still being written are held back, so the person never watches code stream past. The words keep their
 * order, and a prefix only ever grows: each earlier block is the same on the next call, so the page can add to what it has drawn. */
const OPEN = '```openui-lang';
const partCache = new Map<string, Part[] | undefined>();
export function liveBlocks(words: string): Block[] {
 // A trailing line that could still become the opening fence is not words yet.
 const tail = words.slice(words.lastIndexOf('\n') + 1);
 const unfinishedOpen = tail.length > 0 && (OPEN.startsWith(tail.trimEnd()) && tail.startsWith('`') || tail.startsWith(OPEN));
 let shown = unfinishedOpen ? words.slice(0, words.length - tail.length) : words;
 // A fence that has opened and not closed: hold everything from its opening line.
 const opens = [...shown.matchAll(/^```openui-lang[ \t]*\r?$/gm)], closed = [...shown.matchAll(FENCE)];
 const lastOpen = opens.at(-1);
 if (lastOpen && !closed.some(match => match.index === lastOpen.index)) shown = shown.slice(0, lastOpen.index);
 const blocks: Block[] = [];
 const words2 = (text: string) => { const trimmed = text.replace(/^\s*\n/, '').replace(/\s+$/, ''); if (trimmed) blocks.push({type: 'text', text: trimmed}); };
 let last = 0;
 for (const match of shown.matchAll(FENCE)) {
  words2(shown.slice(last, match.index));
  let parts = partCache.get(match[1]);
  if (!partCache.has(match[1])) { parts = parseParts(match[1]); partCache.set(match[1], parts); if (partCache.size > 200) partCache.delete(partCache.keys().next().value!); }
  if (parts) blocks.push({type: 'parts', parts}); else blocks.push({type: 'text', text: '```\n' + match[1] + '\n```'});
  last = match.index + match[0].length;
 }
 words2(shown.slice(last));
 return blocks;
}

// A finished reply is split once, however many times the state is sent; the page receives blocks it can draw, never markup to parse.
const splits = new Map<string, Block[]>();
export function repliesOf(works: readonly {id: string; result?: {text?: string} | null}[]): Record<string, Block[]> {
 const replies: Record<string, Block[]> = {};
 for (const work of works) {
  const reply = work.result?.text; if (!reply) continue;
  let blocks = splits.get(reply);
  if (!blocks) { blocks = splitReply(reply); splits.set(reply, blocks); if (splits.size > 200) splits.delete(splits.keys().next().value!); }
  replies[work.id] = blocks;
 }
 return replies;
}
