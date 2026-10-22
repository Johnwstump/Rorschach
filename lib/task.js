'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normalizeViewport } = require('./viewport');
const { MAX_SOURCES, LETTERS, MODES, optionsFromSources } = require('./compare');

const KINDS = new Set(['url', 'image', 'snapshot', 'compare']);
const SOURCE_KINDS = new Set(['url', 'image', 'snapshot']);
const DEFAULT_OPTIONS = [
  { label: 'Yes', value: 'yes', key: '1' },
  { label: 'No', value: 'no', key: '2' },
  { label: "Can't tell", value: 'unsure', key: '3' },
];
const KEYS = '123456789abdeijklmpqtuxyz'; // skips the panel's own keys: c, f, g, h, n, o, r, s, v, w

function normalizeOptions(list, where) {
  if (!Array.isArray(list) || list.length === 0) throw new Error(`${where}: "options" must be a non-empty array.`);
  const used = new Set();
  return list.map((o, j) => {
    const opt = typeof o === 'string' ? { label: o } : { ...o };
    if (!opt.label) throw new Error(`${where}: option ${j + 1} has no label.`);
    if (opt.value === undefined) opt.value = opt.label;
    if (!opt.key) opt.key = [...KEYS].find((k) => !used.has(k)) || '';
    opt.key = String(opt.key).toLowerCase();
    used.add(opt.key);
    return opt;
  });
}

function loadTask(file) {
  const abs = path.resolve(file);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    throw new Error(`${abs}\n${e.message}`);
  }
  if (!raw || !Array.isArray(raw.items) || raw.items.length === 0) {
    throw new Error('A task needs a non-empty "items" array.');
  }
  const defaults = raw.defaults || {};
  const defaultOptions = defaults.options ? normalizeOptions(defaults.options, 'defaults') : DEFAULT_OPTIONS;
  const defaultViewport = normalizeViewport(defaults.viewport, 'defaults.viewport');
  const ids = new Set();

  const items = raw.items.map((it, i) => {
    const where = `Item ${i + 1}`;
    const pane = it.pane || {};
    if (!KINDS.has(pane.kind)) throw new Error(`${where}: pane.kind must be "url", "image", "snapshot" or "compare".`);
    let sources = null;
    let mode = null;
    if (pane.kind === 'compare') {
      if (!Array.isArray(pane.sources) || pane.sources.length < 2) throw new Error(`${where}: a compare pane needs at least 2 sources.`);
      if (pane.sources.length > MAX_SOURCES) throw new Error(`${where}: a compare pane takes at most ${MAX_SOURCES} sources.`);
      sources = pane.sources.map((s, j) => {
        const src = typeof s === 'string' ? { src: s } : { ...s };
        if (!src.src) throw new Error(`${where}: source ${j + 1} has no src.`);
        src.kind = src.kind || (/\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?|$)/i.test(src.src) ? 'image' : 'url');
        if (!SOURCE_KINDS.has(src.kind)) throw new Error(`${where}: source ${j + 1} kind must be "url", "image" or "snapshot".`);
        src.label = String(src.label || LETTERS[j]);
        return { kind: src.kind, src: src.src, label: src.label };
      });
      mode = pane.mode || defaults.mode || 'grid';
      if (!MODES.includes(mode)) throw new Error(`${where}: pane.mode must be ${MODES.map((m) => `"${m}"`).join(', ')}.`);
    } else if (!pane.src) {
      throw new Error(`${where}: pane.src is required.`);
    }
    const id = String(it.id || `item-${i + 1}`);
    if (ids.has(id)) throw new Error(`${where}: duplicate id "${id}".`);
    ids.add(id);
    return {
      id,
      header: it.header || pane.src || `${sources.map((s) => s.label).join(' vs ')}`,
      detail: it.detail || '',
      pane: {
        kind: pane.kind,
        src: pane.src || null,
        sources,
        mode,
        focus: pane.focus || null,
        caption: pane.caption || null,
        viewport: pane.viewport !== undefined ? normalizeViewport(pane.viewport, `${where}: pane.viewport`) : defaultViewport,
      },
      options: it.options ? normalizeOptions(it.options, where) : (sources ? optionsFromSources(sources) : defaultOptions),
      note: it.note !== undefined ? Boolean(it.note) : defaults.note !== undefined ? Boolean(defaults.note) : true,
      meta: it.meta || null,
    };
  });

  return {
    file: abs,
    title: raw.title || path.basename(abs, '.json'),
    description: raw.description || '',
    items,
  };
}

module.exports = { loadTask };
