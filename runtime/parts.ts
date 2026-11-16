/** Pip's own list of answer parts, written once and drawn by the OpenUI library (lang-core) in the page.
 * The model may write any of these inside a fenced `openui-lang` block of its reply; anything else stays plain text.
 * The page needs only the generated schema (web/parts-schema.js, see scripts/build-parts.ts), never this file or zod. */
import { createLibrary, defineComponent, type Library } from '@openuidev/lang-core';
import { z } from 'zod/v4';

// The library asks its maker to stay quiet; its anonymous usage counts are opt-in and Pip never opts in.
process.env.OPENUI_TELEMETRY_DISABLED = '1';

const step = defineComponent({name: 'Step', description: 'One line of a plan. state is "done", "current" or "next". time is optional, such as "09:00".',
 props: z.object({text: z.string(), state: z.enum(['done', 'current', 'next']).optional(), time: z.string().optional()}), component: null});
const plan = defineComponent({name: 'Plan', description: 'Ordered steps with their progress, such as a day plan or a list of things to do.',
 props: z.object({title: z.string().optional(), steps: z.array(step.ref)}), component: null});
const table = defineComponent({name: 'Table', description: 'Rows and columns. Every row has one cell per column; the last row may be a total.',
 props: z.object({title: z.string().optional(), columns: z.array(z.string()), rows: z.array(z.array(z.string())), note: z.string().optional()}), component: null});
const bar = defineComponent({name: 'Bar', description: 'One bar of a chart: a label and a number.',
 props: z.object({label: z.string(), value: z.number()}), component: null});
const chart = defineComponent({name: 'Chart', description: 'A bar chart of a few labelled numbers. unit is shown beside the title, such as "euros a month".',
 props: z.object({title: z.string().optional(), unit: z.string().optional(), bars: z.array(bar.ref), note: z.string().optional()}), component: null});
const option = defineComponent({name: 'Option', description: 'One answer the person can pick. suggested marks the one Pip would pick; detail is a short second line.',
 props: z.object({label: z.string(), detail: z.string().optional(), suggested: z.boolean().optional()}), component: null});
const choice = defineComponent({name: 'Choice', description: 'A question with two to five answers. Picking one sends that label as the person\'s next message.',
 props: z.object({question: z.string(), options: z.array(option.ref)}), component: null});
const source = defineComponent({name: 'Source', description: 'A page or file Pip opened. url is a public https address, optional for a file.',
 props: z.object({title: z.string(), url: z.string().optional()}), component: null});
const sources = defineComponent({name: 'Sources', description: 'The pages and files the answer rests on. Cite only what you opened.',
 props: z.object({items: z.array(source.ref)}), component: null});
const figure = defineComponent({name: 'Figure', description: 'A route or flow drawn as connected stops, such as a journey or a process. caption is one sentence.',
 props: z.object({title: z.string().optional(), stops: z.array(z.string()), caption: z.string().optional()}), component: null});
const fold = defineComponent({name: 'Fold', description: 'Detail that stays folded to one line until the person opens it, such as how you worked something out.',
 props: z.object({title: z.string(), body: z.string()}), component: null});
const picture = defineComponent({name: 'Picture', description: 'One picture. src must be a data: address of a PNG, JPEG or WebP; without one the page shows the description.',
 props: z.object({description: z.string(), src: z.string().optional()}), component: null});
const pictures = defineComponent({name: 'Pictures', description: 'One to six pictures in a row.',
 props: z.object({items: z.array(picture.ref)}), component: null});
const note = defineComponent({name: 'Note', description: 'One short remark set apart from the text. tone is "info", "ok" or "warn".',
 props: z.object({text: z.string(), tone: z.enum(['info', 'ok', 'warn']).optional()}), component: null});
const field = defineComponent({name: 'Field', description: 'A labelled line of a draft, such as To or Subject.',
 props: z.object({name: z.string(), value: z.string()}), component: null});
const draft = defineComponent({name: 'Draft', description: 'A piece of writing for the person to edit, copy or save. label says what it is, such as "Email, not sent". Nothing is sent by showing it.',
 props: z.object({label: z.string(), fields: z.array(field.ref).optional(), body: z.string()}), component: null});

const PARTS = [plan, table, chart, choice, sources, figure, fold, pictures, note, draft] as const;
const parts = defineComponent({name: 'Parts', description: 'The root of every block: the parts, in the order they should appear.',
 props: z.object({children: z.array(z.union(PARTS.map(part => part.ref) as [typeof plan.ref, typeof table.ref]))}), component: null});

/** The ten part kinds the captain chose. Text, the live activity rows and the paused step are drawn by the page itself. */
export const PART_KINDS = PARTS.map(part => part.name);
export const partsLibrary: Library = createLibrary({
 components: [parts, ...PARTS, step, bar, option, source, picture, field],
 componentGroups: [
  {name: 'Parts', components: ['Parts'], notes: ['Write exactly one Parts(...) per block. Put nothing else in the block.']},
  {name: 'Content', components: PART_KINDS, notes: ['Use a part only when it shows the answer better than a sentence would. Say the point in plain text as well.']},
  {name: 'Pieces', components: ['Step', 'Bar', 'Option', 'Source', 'Picture', 'Field']}],
 root: 'Parts', id: 'pip-parts'});

/** What the page's parser is given: the library's own JSON schema, so the two never differ. */
export const partsSchema = () => partsLibrary.toJSONSchema();

const PIP_WAY = `## How Pip uses parts

Write the answer as plain text or markdown. When a plan, a table, a chart, a choice, sources, a route, a fold, pictures, a note or a draft shows it better than a sentence, add that part as one fenced block inside the reply:

\`\`\`openui-lang
root = Parts([plan])
plan = Plan("Friday", [Step("Call with Marta", "done", "09:00"), Step("Tax letter", "current", "13:30")])
\`\`\`

Say the point in words as well, because a part the page cannot draw is shown as plain text. Never put a part inside a draft or a question the person must answer in words. A part is only a picture of the answer: showing a Draft sends nothing, and a Choice only offers answers.`;

/** Added to Pip's standing instructions. The reply stays plain markdown; a part is a fenced block inside it. */
export const PARTS_INSTRUCTIONS = (() => {
 const full = partsLibrary.prompt({inlineMode: true});
 const from = full.indexOf('## Inline Mode'), to = full.indexOf('## Important Rules');
 if (from < 0 || to < from) throw new Error('The OpenUI prompt changed shape; update PARTS_INSTRUCTIONS.');
 return full.slice(0, from) + PIP_WAY + '\n' + full.slice(to);
})();
