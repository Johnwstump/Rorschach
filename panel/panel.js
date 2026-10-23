'use strict';

const $ = (id) => document.getElementById(id);
const api = window.rorschach;

let state = null;
let noteItemId = null;   // which item the textarea currently belongs to

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function render() {
  if (!state) return;
  const { title, index, total, answered, item, answer, done, highlight, pane } = state;
  $('task-title').textContent = title;
  $('task-title').title = title;
  $('bar-fill').style.width = total ? `${(answered / total) * 100}%` : '0';
  $('progress-text').textContent = `${answered}/${total}`;

  $('item').hidden = done;
  $('done').hidden = !done;

  if (done) {
    renderDone();
    return;
  }

  $('item-index').textContent = `${index + 1} of ${total}`;
  $('item-id').textContent = item.id;
  $('item-header').textContent = item.header;
  $('item-detail').textContent = item.detail;
  $('item-detail').hidden = !item.detail;
  $('pane-kind').textContent = item.pane.kind === 'compare' ? `compare · ${item.pane.sources.length} sources` : item.pane.kind;
  renderCompare(state.compare);

  const hs = $('highlight-status');
  if (!item.pane.focus) { hs.hidden = true; }
  else if (!highlight) { hs.hidden = false; hs.className = 'chip'; hs.textContent = `looking for “${item.pane.focus}”…`; }
  else if (highlight.compare) { hs.hidden = false; hs.className = `chip ${highlight.found ? 'ok' : 'bad'}`; hs.textContent = highlight.text; hs.title = ''; }
  else if (highlight.found) { hs.hidden = false; hs.className = 'chip ok'; hs.textContent = `found: ${highlight.text || item.pane.focus}`; hs.title = highlight.exact ? 'Exact match' : 'Partial match'; }
  else { hs.hidden = false; hs.className = 'chip bad'; hs.textContent = `not found: “${item.pane.focus}”`; }

  renderPane(pane);
  renderViewport(state.viewport);

  const opts = $('options');
  opts.innerHTML = item.options.map((o) =>
    `<button class="option${answer && answer.value === o.value ? ' selected' : ''}" data-value="${esc(o.value)}" data-label="${esc(o.label)}">
       <span class="key">${esc(o.key.toUpperCase())}</span><span>${esc(o.label)}</span></button>`).join('');

  $('note-wrap').hidden = !item.note;
  if (noteItemId !== item.id) {
    $('note').value = answer ? answer.note || '' : '';
    noteItemId = item.id;
  }

  const a = $('answered');
  if (answer) {
    a.hidden = false;
    a.innerHTML = `<span>Answered: <b>${esc(answer.label)}</b></span><button id="clear-answer" class="ghost">Clear</button>`;
  } else {
    a.hidden = true;
    a.innerHTML = '';
  }
  $('back').disabled = index === 0;
  $('skip').disabled = index >= total - 1;
}

function renderPane(pane) {
  if (!pane) return;
  const isCompare = state && state.item && state.item.pane.kind === 'compare';
  $('pane-loading').hidden = isCompare || !pane.loading;
  const u = $('pane-url');
  const shown = isCompare ? '' : pane.url && pane.url.startsWith('file:') && pane.url.includes('/viewer/image.html') ? decodeURIComponent((pane.url.split('src=')[1] || '').split('&')[0]) : pane.url || '';
  u.textContent = shown;
  u.title = shown;
  u.hidden = isCompare;
  $('pane-error').hidden = isCompare || !pane.error;
  $('pane-error').textContent = pane.error ? `The pane could not load this: ${pane.error}` : '';
}

function renderCompare(c) {
  $('cmp').hidden = !c;
  if (!c) return;
  const status = $('cmp-status');
  if (c.loaded < c.n) { status.className = 'chip loading'; status.textContent = `loading ${c.loaded}/${c.n}`; }
  else if (c.blend) { status.className = 'chip ok'; status.textContent = `${c.mode} · captured ${c.capturedAt ? new Date(c.capturedAt).toLocaleTimeString() : ''}`; }
  else { status.className = 'chip'; status.textContent = c.mode === 'grid' ? 'live grid' : `${c.mode} · capturing…`; }
  const modes = [['grid', 'Grid', 'G'], ['fade', 'Fade', 'F'], ['wipe', 'Wipe', 'W']];
  $('cmp-buttons').innerHTML = modes.map(([m, label, k]) =>
    `<button type="button" data-cmp-mode="${m}" class="${c.mode === m ? 'selected' : ''}" title="${label} (${k})">${label}</button>`).join('') +
    `<button type="button" data-cmp-sync="1" class="toggle${c.sync ? ' on' : ''}" title="Scroll every cell together (S)">Sync scroll</button>` +
    `<button type="button" data-cmp-recapture="1" title="Capture the pages again (C)">Recapture</button>`;
  $('cmp-sources').innerHTML = c.sources.map((s) =>
    `<li><b>${esc(s.letter)}</b><span title="${esc(s.src)}">${esc(s.label)} <span class="src">${esc(s.src)}</span></span></li>`).join('');
}

let customOpen = false;

function renderViewport(vp) {
  if (!vp) return;
  const status = $('vp-status');
  status.textContent = vp.text;
  status.className = `chip${vp.effective && vp.scale < 0.995 ? ' warn' : ''}`;
  status.title = vp.effective && vp.scale < 0.995 ? 'Scaled down to fit. Widen the window for 100%.' : '';

  const selected = vp.source === 'task' ? 'task' : (vp.effective ? vp.effective.name : 'fit');
  const buttons = [
    { name: 'task', label: `Task (${vp.task})` },
    ...vp.presets.map((p) => ({ name: p.name, label: p.label })),
    { name: 'custom', label: 'Custom' },
  ];
  $('vp-buttons').innerHTML = buttons.map((b) =>
    `<button type="button" data-vp="${esc(b.name)}" class="${b.name === selected || (b.name === 'custom' && customOpen) ? 'selected' : ''}">${esc(b.label)}</button>`).join('');

  $('vp-custom').hidden = !customOpen;
  if (customOpen && vp.effective && !$('vp-w').value) {
    $('vp-w').value = vp.effective.width;
    $('vp-h').value = vp.effective.height;
    $('vp-mobile').checked = Boolean(vp.effective.mobile);
  }
}

function renderDone() {
  const counts = {};
  // state.answered is a number; the breakdown comes from the labels we have seen.
  for (const a of Object.values(state.answers || {})) counts[a.label] = (counts[a.label] || 0) + 1;
  $('summary').innerHTML = Object.keys(counts).length
    ? Object.entries(counts).map(([k, v]) => `<span>${esc(k)}</span><b>${v}</b>`).join('')
    : `<span>Answers</span><b>${state.answered}</b>`;
  $('results-path').textContent = state.resultsFile;
  $('results-path').title = state.resultsFile;
}

function submit(value, label) {
  if (!state || state.done) return;
  api.answer({ value, label, note: $('note').value.trim() });
}

function handleKey(key, fromPage) {
  if (!state || !state.item) return;
  const k = key.toLowerCase();
  const el = document.activeElement;
  const typing = !fromPage && el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT');
  if (typing) {
    if (k === 'escape') el.blur();
    return;
  }
  const opt = state.item.options.find((o) => o.key === k);
  if (opt && !state.done) { submit(opt.value, opt.label); return true; }
  switch (k) {
    case 'backspace': case 'arrowleft': if (!state.done) api.nav('back'); return true;
    case 'arrowright': if (!state.done) api.nav('next'); return true;
    case 'n': if (state.item.note && !state.done) { $('note').focus(); } return true;
    case 'h': api.rehighlight(); return true;
    case 'r': api.reload(); return true;
    case 'o': api.openExternal(); return true;
    case 'v': api.viewport({ mode: 'cycle' }); return true;
    case 'g': case 'f': case 'w':
      if (state.compare) api.compare({ action: 'mode', mode: { g: 'grid', f: 'fade', w: 'wipe' }[k] });
      return true;
    case 's': if (state.compare) api.compare({ action: 'sync', on: !state.compare.sync }); return true;
    case 'c': if (state.compare) api.compare({ action: 'recapture' }); return true;
    default: return false;
  }
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (handleKey(e.key, false)) e.preventDefault();
});

document.addEventListener('click', (e) => {
  const opt = e.target.closest('.option');
  if (opt) { submit(opt.dataset.value, opt.dataset.label); return; }
  if (e.target.id === 'clear-answer') { api.clearAnswer(); return; }
  const cm = e.target.closest('[data-cmp-mode]');
  if (cm) { api.compare({ action: 'mode', mode: cm.dataset.cmpMode }); return; }
  if (e.target.closest('[data-cmp-sync]')) { api.compare({ action: 'sync', on: !(state.compare && state.compare.sync) }); return; }
  if (e.target.closest('[data-cmp-recapture]')) { api.compare({ action: 'recapture' }); return; }
  const vp = e.target.closest('[data-vp]');
  if (vp) {
    const name = vp.dataset.vp;
    if (name === 'custom') { customOpen = !customOpen; renderViewport(state.viewport); if (customOpen) $('vp-w').focus(); return; }
    customOpen = false;
    api.viewport(name === 'task' ? { mode: 'task' } : { mode: 'preset', name });
  }
});

$('vp-custom').addEventListener('submit', (e) => {
  e.preventDefault();
  const width = Number($('vp-w').value), height = Number($('vp-h').value);
  if (!width || !height) return;
  api.viewport({ mode: 'custom', width, height, mobile: $('vp-mobile').checked });
  $('vp-w').blur();
});

$('back').addEventListener('click', () => api.nav('back'));
$('skip').addEventListener('click', () => api.nav('next'));
$('rehighlight').addEventListener('click', () => api.rehighlight());
$('reload').addEventListener('click', () => api.reload());
$('open-external').addEventListener('click', () => api.openExternal());
$('open-task').addEventListener('click', () => api.openTask());
$('reveal').addEventListener('click', () => api.revealResults());
$('review-again').addEventListener('click', () => api.nav(0));

api.onState((s) => { state = s; render(); });
api.onPane((p) => { if (state) { state.pane = p; renderPane(p); } });
api.onHotkey((k) => handleKey(k, true));
api.ready();
