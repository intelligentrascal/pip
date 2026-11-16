// The ten parts the library can draw. Each gets plain data checked in the runtime (runtime/reply.ts) and is built here with text nodes only.
// A part that arrives in a shape this file does not know is drawn as plain text, never dropped.
const { node, button, icon } = window.pipDom;
const label = (name, status) => { const h = node('div', undefined, 'ph'); h.append(node('b', name)); if (status) h.append(node('span', status)); return h; };
const shell = (kind, name, status) => { const el = node('section', undefined, 'pl pt-' + kind); el.setAttribute('aria-label', name); el.append(label(name, status)); return el; };
const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value : '';

const draw = {
 plan(part) {
  const steps = list(part.steps), done = steps.filter(s => s.state === 'done').length, timed = steps.some(s => text(s.time));
  const el = shell('plan', 'Plan', `${done} of ${steps.length} done`); if (text(part.title)) el.append(node('b', part.title, 'pt'));
  for (const step of steps) {
   const row = node('div', undefined, 'pr ' + ({ done: 'dn', current: 'cu' }[step.state] ?? '') + (timed ? '' : ' nt'));
   row.append(step.state === 'done' ? icon('ok') : node('i', undefined, 'rg'));
   if (timed) row.append(node('time', text(step.time)));
   row.append(node('span', text(step.text)));
   if (step.state === 'current') row.setAttribute('aria-current', 'step');
   el.append(row);
  }
  return el;
 },
 table(part) {
  const columns = list(part.columns), rows = list(part.rows), el = shell('table', 'Table', `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`);
  if (text(part.title)) el.append(node('b', part.title, 'pt'));
  const wrap = node('div', undefined, 'sx'), table = node('table'), head = node('tr'); wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', text(part.title) || 'Table');
  for (const c of columns) head.append(node('th', text(c))); table.append(head);
  for (const row of rows) { const tr = node('tr'); for (const cell of list(row)) tr.append(node('td', text(cell))); table.append(tr); }
  wrap.append(table); el.append(wrap); if (text(part.note)) el.append(node('p', part.note, 'pn'));
  return el;
 },
 chart(part) {
  const bars = list(part.bars).filter(b => Number.isFinite(b.value)), max = Math.max(1, ...bars.map(b => Math.abs(b.value)));
  const el = shell('chart', 'Chart', text(part.unit)); if (text(part.title)) el.append(node('b', part.title, 'pt'));
  const body = node('div', undefined, 'ch'); body.setAttribute('role', 'img'); body.setAttribute('aria-label', (text(part.title) || 'Chart') + ': ' + bars.map(b => `${text(b.label)} ${b.value}`).join(', '));
  for (const bar of bars) {
   const row = node('div', undefined, 'cr'), track = node('span', undefined, 'ct'), fill = node('i'); fill.style.width = Math.max(1, Math.round(Math.abs(bar.value) / max * 100)) + '%'; track.append(fill);
   row.append(node('span', text(bar.label), 'cl'), track, node('span', String(bar.value), 'cn')); body.append(row);
  }
  el.append(body); if (text(part.note)) el.append(node('p', part.note, 'pn'));
  return el;
 },
 choice(part, ctx) {
  const el = shell('choice', 'Choice', 'Pick one'); el.append(node('h4', text(part.question)));
  const group = node('div', undefined, 'op'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', text(part.question));
  for (const option of list(part.options)) {
   const b = node('button', undefined, 'bt op1' + (option.suggested ? ' sg' : '')); b.type = 'button'; b.append(node('b', text(option.label)));
   if (text(option.detail)) b.append(node('span', option.detail)); if (option.suggested) b.append(node('em', 'Suggested'));
   b.onclick = () => { for (const other of group.querySelectorAll('button')) other.disabled = true; b.classList.add('picked'); ctx.choose?.(text(option.label)); };
   group.append(b);
  }
  // Already answered, such as after a redraw: the picked one stays marked and none can be sent again.
  const picked = [...group.querySelectorAll('button')].find((b, i) => ctx.picked && ctx.picked === text(list(part.options)[i]?.label));
  if (picked) { picked.classList.add('picked'); for (const b of group.querySelectorAll('button')) b.disabled = true; }
  el.append(group); return el;
 },
 sources(part, ctx) {
  const items = list(part.items), el = shell('sources', 'Sources', `${items.length} ${items.length === 1 ? 'page' : 'pages'}`);
  items.forEach((item, index) => {
   const row = node(text(item.url) ? 'button' : 'div', undefined, 'sr1'); if (row.tagName === 'BUTTON') { row.type = 'button'; row.onclick = () => ctx.openUrl?.(item.url); row.title = item.url; }
   row.append(node('b', String(index + 1)), node('span', text(item.title)), node('small', text(item.url) ? window.pipDom.hostOf(item.url) : 'File')); el.append(row);
  });
  return el;
 },
 figure(part) {
  const stops = list(part.stops), el = shell('figure', 'Route', `${stops.length} stops`); if (text(part.title)) el.append(node('b', part.title, 'pt'));
  const fig = node('figure', undefined, 'fg'); fig.setAttribute('aria-label', (text(part.title) || 'Route') + ': ' + stops.map(text).join(', then '));
  const ol = node('ol'); stops.forEach((stop, i) => { const li = node('li', text(stop)); li.dataset.end = i === 0 ? 'first' : i === stops.length - 1 ? 'last' : ''; ol.append(li); }); fig.append(ol);
  if (text(part.caption)) fig.append(node('figcaption', part.caption)); el.append(fig); return el;
 },
 fold(part, ctx) {
  const el = node('details', undefined, 'pl pt-fold'), s = node('summary'); s.append(icon('chev'), node('span', text(part.title))); el.append(s, window.pipMarkdown(text(part.body), ctx.openUrl)); return el;
 },
 pictures(part) {
  const items = list(part.items), el = shell('pictures', items.length === 1 ? 'Picture' : 'Pictures', `${items.length}`), row = node('div', undefined, 'pc');
  for (const item of items) {
   const fig = node('figure');
   if (text(item.src).startsWith('data:image/')) { const img = node('img'); img.src = item.src; img.alt = text(item.description); fig.append(img); } else fig.append(node('div', 'No image', 'ph0'));
   fig.append(node('figcaption', text(item.description))); row.append(fig);
  }
  el.append(row); return el;
 },
 note(part) {
  const tone = ['ok', 'warn', 'info'].includes(part.tone) ? part.tone : 'info', el = node('p', undefined, 'nt nt-' + tone); el.setAttribute('role', 'note');
  el.append(icon(tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : 'info'), node('span', text(part.text))); return el;
 },
 draft(part, ctx) {
  const el = shell('draft', 'Draft', text(part.label)), fields = list(part.fields);
  if (fields.length) { const fl = node('div', undefined, 'fl'); for (const f of fields) fl.append(node('span', text(f.name)), node('span', text(f.value))); el.append(fl); }
  el.append(node('div', text(part.body), 'db')); el.append(window.pipDraftActions(text(part.body), ctx)); return el;
 }
};
window.pipDraftActions = (body, ctx) => { const row = node('div', undefined, 'rw'); row.append(button('Save note', () => ctx.proposal?.({ type: 'note.save', text: body }), 'bt'), button('Copy', () => ctx.proposal?.({ type: 'clipboard.copy', text: body }), 'bt')); return row; };
window.pipParts = {
 kinds: Object.keys(draw),
 render(part, ctx = {}) {
  try { if (part && draw[part.kind]) return draw[part.kind](part, ctx); } catch { /* falls through to plain text */ }
  return node('p', JSON.stringify(part ?? '').slice(0, 2000), 'pl plain');
 }
};
