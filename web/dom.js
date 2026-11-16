// Small helpers every page module shares. Text only ever goes in through textContent, never as markup.
const ICONS = {
 ok: '<path d="M3.5 8.5l3 3 6-7"/>', x: '<path d="M4 4l8 8M12 4l-8 8"/>', plus: '<path d="M8 3v10M3 8h10"/>', up: '<path d="M8 13V3M3.5 7.5L8 3l4.5 4.5"/>',
 mic: '<rect x="6" y="2" width="4" height="7.5" rx="2"/><path d="M3.5 8a4.5 4.5 0 009 0M8 12.5V14"/>', chev: '<path d="M6 4l4 4-4 4"/>', down: '<path d="M4 6l4 4 4-4"/>',
 list: '<path d="M3 4.5h10M3 8h10M3 11.5h6"/>', more: '<path d="M3.5 8h.1M8 8h.1M12.5 8h.1" stroke-width="2.4"/>', copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-1h-8v8h1"/>',
 redo: '<path d="M13 8a5 5 0 11-1.6-3.7M13 2.5v3h-3"/>', stop: '<rect x="4" y="4" width="8" height="8" rx="1.5"/>', find: '<circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/>',
 warn: '<path d="M8 3l5.5 9.5h-11zM8 7v2.5M8 11.2v.1"/>', info: '<circle cx="8" cy="8" r="5.5"/><path d="M8 7.5v3.5M8 5.3v.1"/>'
};
const SVG = 'http://www.w3.org/2000/svg';
window.pipDom = {
 node(tag, content, cls) { const e = document.createElement(tag); if (content !== undefined) e.textContent = content; if (cls) e.className = cls; return e; },
 button(label, action, cls = '') { const b = window.pipDom.node('button', label, cls); b.type = 'button'; b.onclick = action; return b; },
 // The icons are fixed strings in this file, so setting their markup is safe.
 icon(name) { const s = document.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('class', 'i'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = ICONS[name]; return s; },
 iconButton(name, label, action, cls = '') { const b = window.pipDom.button(undefined, action, 'ib ' + cls); b.append(window.pipDom.icon(name)); b.setAttribute('aria-label', label); b.title = label; return b; },
 seconds(ms) { const s = Math.max(0, Math.round(ms / 100) / 10); return s < 10 ? s.toFixed(1) + ' s' : Math.round(s) + ' s'; },
 clock(ms) { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); },
 hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } }
};
