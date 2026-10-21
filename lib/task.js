'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normalizeViewport } = require('./viewport');

const KINDS = new Set(['url', 'image', 'snapshot']);
const DEFAULT_OPTIONS = [
  { label: 'Yes', value: 'yes', key: '1' },
  { label: 'No', value: 'no', key: '2' },
  { label: "Can't tell", value: 'unsure', key: '3' },
];
const KEYS = '123456789abcdefgijklmpqstuwxyz'; // skips the navigation keys h, n, o, r, v

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
    if (!KINDS.has(pane.kind)) throw new Error(`${where}: pane.kind must be "url", "image" or "snapshot".`);
    if (!pane.src) throw new Error(`${where}: pane.src is required.`);
    const id = String(it.id || `item-${i + 1}`);
    if (ids.has(id)) throw new Error(`${where}: duplicate id "${id}".`);
    ids.add(id);
    return {
      id,
      header: it.header || pane.src,
      detail: it.detail || '',
      pane: {
        kind: pane.kind,
        src: pane.src,
        focus: pane.focus || null,
        caption: pane.caption || null,
        viewport: pane.viewport !== undefined ? normalizeViewport(pane.viewport, `${where}: pane.viewport`) : defaultViewport,
      },
      options: it.options ? normalizeOptions(it.options, where) : defaultOptions,
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
