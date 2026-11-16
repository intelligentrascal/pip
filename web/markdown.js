// A small, safe markdown drawer for replies: headings, paragraphs, lists, quotes, code, pipe tables, bold, italic, code and https links.
// It builds elements with textContent only; a link is a button that asks the host to open it, and nothing is ever run.
const { node } = window.pipDom;
const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*|\[[^\]\n]+\]\(https:\/\/[^)\s]+\))/;
function inline(parent, text, openUrl) {
 for (const piece of text.split(INLINE)) {
  if (!piece) continue;
  if (piece.startsWith('`') && piece.length > 2) parent.append(node('code', piece.slice(1, -1)));
  else if (piece.startsWith('**') && piece.length > 4) parent.append(node('strong', piece.slice(2, -2)));
  else if (piece.startsWith('*') && piece.length > 2) parent.append(node('em', piece.slice(1, -1)));
  else if (piece.startsWith('[') && piece.includes('](')) {
   const at = piece.lastIndexOf(']('), label = piece.slice(1, at), url = piece.slice(at + 2, -1);
   const link = node('button', label, 'lk'); link.type = 'button'; link.title = url; link.onclick = () => openUrl?.(url); parent.append(link);
  } else parent.append(document.createTextNode(piece));
 }
}
const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
window.pipMarkdown = function (source, openUrl) {
 const root = node('div', undefined, 'md'), lines = source.replace(/\r/g, '').split('\n');
 for (let i = 0; i < lines.length;) {
  const line = lines[i];
  if (!line.trim()) { i++; continue; }
  const fence = line.match(/^```(.*)$/);
  if (fence) { const body = []; for (i++; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i]); i++; const pre = node('pre'); pre.append(node('code', body.join('\n'))); pre.tabIndex = 0; root.append(pre); continue; }
  const heading = line.match(/^(#{1,6})\s+(.*)$/);
  if (heading) { const h = node('h3'); inline(h, heading[2], openUrl); root.append(h); i++; continue; }
  if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
   const head = cells(line), rows = []; for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) rows.push(cells(lines[i]));
   const wrap = node('div', undefined, 'sx'), table = node('table'), thead = node('tr'); wrap.tabIndex = 0;
   for (const cell of head) { const th = node('th'); inline(th, cell, openUrl); thead.append(th); } table.append(thead);
   for (const row of rows) { const tr = node('tr'); head.forEach((_, c) => { const td = node('td'); inline(td, row[c] ?? '', openUrl); tr.append(td); }); table.append(tr); }
   wrap.append(table); root.append(wrap); continue;
  }
  const list = line.match(/^\s*([-*•]|\d+[.)])\s+/);
  if (list) {
   const ordered = /\d/.test(list[1]), el = node(ordered ? 'ol' : 'ul');
   for (; i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]); i++) { const li = node('li'); inline(li, lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ''), openUrl); el.append(li); }
   root.append(el); continue;
  }
  if (line.startsWith('>')) { const q = node('blockquote'); const body = []; for (; i < lines.length && lines[i].startsWith('>'); i++) body.push(lines[i].replace(/^>\s?/, '')); inline(q, body.join(' '), openUrl); root.append(q); continue; }
  const paragraph = []; for (; i < lines.length && lines[i].trim() && !/^(```|#{1,6}\s|>|\s*([-*•]|\d+[.)])\s)/.test(lines[i]); i++) paragraph.push(lines[i]);
  const p = node('p'); inline(p, paragraph.join('\n'), openUrl); root.append(p);
 }
 return root;
};
