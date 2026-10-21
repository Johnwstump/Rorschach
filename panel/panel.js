'use strict';

const $ = (id) => document.getElementById(id);
const api = window.rorshach;

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
  $('pane-kind').textContent = item.pane.kind;

  const hs = $('highlight-status');
  if (!item.pane.focus) { hs.hidden = true; }
  else if (!highlight) { hs.hidden = false; hs.className = 'chip'; hs.textContent = `looking for “${item.pane.focus}”…`; }
  else if (highlight.found) { hs.hidden = false; hs.className = 'chip ok'; hs.textContent = `found: ${highlight.text || item.pane.focus}`; hs.title = highlight.exact ? 'Exact match' : 'Partial match'; }
  else { hs.hidden = false; hs.className = 'chip bad'; hs.textContent = `not found: “${item.pane.focus}”`; }

  renderPane(pane);

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
  $('pane-loading').hidden = !pane.loading;
  const u = $('pane-url');
  const shown = pane.url && pane.url.startsWith('file:') && pane.url.includes('/viewer/image.html') ? decodeURIComponent((pane.url.split('src=')[1] || '').split('&')[0]) : pane.url || '';
  u.textContent = shown;
  u.title = shown;
  $('pane-error').hidden = !pane.error;
  $('pane-error').textContent = pane.error ? `The pane could not load this: ${pane.error}` : '';
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
  const inNote = !fromPage && document.activeElement === $('note');
  if (inNote) {
    if (k === 'escape') $('note').blur();
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
