'use strict';

const { app, BaseWindow, WebContentsView, ipcMain, shell, dialog, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const { loadTask } = require('./lib/task');
const { Results } = require('./lib/results');
const { highlightScript } = require('./lib/highlight');
const { PRESETS, CYCLE, isFit, normalizeViewport, layoutFor, mobileUserAgent, describe } = require('./lib/viewport');
const { LETTERS, GAP, gridLayout } = require('./lib/compare');

const PANEL_WIDTH = 420;
const HIGHLIGHT_TRIES = 12;      // pages that render late get a few chances
const HIGHLIGHT_DELAY_MS = 600;
const PANE_PARTITION = 'persist:rorschach-pane';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
// RORSCHACH_DEBUG=1 prints item loads, highlight results and answers to stdout.
const debug = process.env.RORSCHACH_DEBUG ? (...a) => console.log('[rorschach]', ...a) : () => {};
const SNAPSHOT_DIR = process.env.RORSCHACH_SNAPSHOT_DIR || null;

let win = null;
let panel = null;      // the control panel (our UI)
let pane = null;       // a single item's page, image or snapshot
let overlay = null;    // the blend view for compare items (fade / wipe)
const cells = [];      // pooled views for compare items, one per source
let overlayReady = false;

let task = null;
let results = null;
let index = 0;
let highlightRun = 0;            // bumped whenever a new item loads, so stale retries stop
let lastHighlight = null;        // single: a result; compare: { cells: [result] }
let paneState = { loading: false, url: '', title: '', error: null };

// Viewport: `undefined` follows the task file, `null` is "fit", an object is a fixed size.
let viewportOverride = undefined;
let currentScale = 1;
let defaultUserAgent = '';

// Compare: state for the current compare item, or null.
let compare = null;
let modeOverride = undefined;    // the mode the user picked; resets when the task changes modes
let lastTaskMode = null;

// Per-webContents bookkeeping: whether its renderer has ever started a load (Chromium
// crashes if device emulation is enabled before that), what emulation it should have,
// whether the DevTools protocol is wired up, and a scroll-sync echo guard.
const wcState = new WeakMap();
function stateOf(wc) {
  let s = wcState.get(wc);
  if (!s) { s = { live: false, emulating: false, bound: false, wanted: { vp: null, scale: 1 }, applied: null, editing: false }; wcState.set(wc, s); }
  return s;
}

// Keys the panel owns. A page view forwards these when no text field in it is focused,
// so hotkeys work wherever the keyboard focus happens to be.
const HOTKEY = /^[0-9a-z]$/i;

// ---------- arguments ----------

function parseArgs(argv) {
  // dev:      electron . task.json --out results.json
  // packaged: Rorschach.exe task.json --out results.json
  const args = argv.slice(app.isPackaged ? 1 : 2).filter((a) => a !== '.' && !a.startsWith('--inspect'));
  const out = { taskFile: null, resultsFile: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' || args[i] === '-o') out.resultsFile = args[++i];
    else if (!args[i].startsWith('-') && !out.taskFile) out.taskFile = args[i];
  }
  return out;
}

function defaultResultsPath(taskFile) {
  const p = path.parse(taskFile);
  return path.join(p.dir, `${p.name}.results.json`);
}

async function pickTaskFile() {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open a review task',
    filters: [{ name: 'Task files', extensions: ['json'] }],
    properties: ['openFile'],
  });
  return r.canceled ? null : r.filePaths[0];
}

// ---------- views ----------

// A view for third-party content: no preload, no Node, sandboxed, and a persistent
// session shared by all of them so logins survive between runs.
function createContentView(cellIndex) {
  const view = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: PANE_PARTITION },
  });
  const wc = view.webContents;
  const st = stateOf(wc);
  const isPane = cellIndex < 0;

  wc.setWindowOpenHandler(({ url }) => {
    wc.loadURL(url).catch(() => {});       // popups stay in the view
    return { action: 'deny' };
  });
  wc.on('did-start-loading', () => {
    st.live = true;
    st.editing = false;
    applyEmulation(wc);
    if (isPane) sendPane({ loading: true, error: null });
  });
  wc.on('did-stop-loading', () => { if (isPane) sendPane({ loading: false, url: wc.getURL(), title: wc.getTitle() }); });
  wc.on('page-title-updated', (_e, title) => { if (isPane) sendPane({ title }); });
  wc.on('did-finish-load', () => { onLoaded(wc, cellIndex); });
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    debug('load failed', url, desc, code);
    if (isPane) sendPane({ loading: false, error: `${desc} (${code})`, url });
  });
  // Hotkeys reach the panel from here too: always with Alt, and bare when the page has
  // no text field focused (arrows and Backspace stay with the page, which scrolls with them).
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.control || input.meta) return;
    if (!input.alt && (st.editing || !HOTKEY.test(input.key))) return;
    panel.webContents.send('hotkey', input.key);
    event.preventDefault();
  });
  wc.debugger.on('message', (_e, method, params) => {
    if (method !== 'Runtime.bindingCalled' || params.name !== '__rorschach') return;
    const [type, value] = String(params.payload).split(':', 2);
    if (type === 'scroll') onCellScroll(cellIndex, value);
    else if (type === 'focus') st.editing = value === '1';
  });
  wc.debugger.on('detach', () => { st.emulating = false; st.bound = false; });
  return view;
}

function createWindow() {
  win = new BaseWindow({
    width: 1560,
    height: 980,
    minWidth: 900,
    minHeight: 600,
    title: 'Rorschach',
    icon: path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14181d' : '#f4f5f7',
  });

  panel = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  pane = createContentView(-1);
  overlay = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'viewer', 'compare-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  win.contentView.addChildView(panel);
  win.contentView.addChildView(pane);
  win.contentView.addChildView(overlay);
  overlay.setVisible(false);
  defaultUserAgent = pane.webContents.getUserAgent();

  win.on('resize', () => layout());
  layout();
  win.on('closed', () => { win = null; });

  panel.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      (compare && compare.blend ? overlay : compare ? cells[0] : pane).webContents.toggleDevTools();
      event.preventDefault();
    }
  });
  panel.webContents.once('did-finish-load', () => panel.webContents.focus());
  panel.webContents.loadFile(path.join(__dirname, 'panel', 'index.html'));
  overlay.webContents.loadFile(path.join(__dirname, 'viewer', 'compare.html'));
}

// Cells are created on demand and kept. A new cell lands on top of the overlay, so the
// overlay is re-added after one; re-adding views otherwise is avoided because it can
// drop the window's keyboard focus.
function ensureCells(n) {
  let added = false;
  while (cells.length < n) {
    const view = createContentView(cells.length);
    cells.push(view);
    win.contentView.addChildView(view);
    added = true;
  }
  if (added) {
    win.contentView.removeChildView(overlay);
    win.contentView.addChildView(overlay);
  }
}

// Where the keyboard should be after an item or mode change: the overlay while
// blending, otherwise the panel.
function focusControls() {
  (compare && compare.blend ? overlay : panel).webContents.focus();
}

function sendPane(patch) {
  paneState = { ...paneState, ...patch };
  if (panel) panel.webContents.send('pane', paneState);
}

// ---------- viewport and emulation ----------

function effectiveViewport() {
  if (viewportOverride !== undefined) return viewportOverride;
  const item = currentItem();
  return item ? item.pane.viewport : null;
}

async function ensureDebugger(wc) {
  const st = stateOf(wc);
  if (!wc.debugger.isAttached()) { wc.debugger.attach('1.3'); st.bound = false; }
  if (st.bound) return;
  st.bound = true;
  try {
    await wc.debugger.sendCommand('Runtime.enable');
    await wc.debugger.sendCommand('Runtime.addBinding', { name: '__rorschach' });
  } catch (e) { debug('binding failed:', e.message); }
}

// Device metrics go through the DevTools protocol rather than
// webContents.enableDeviceEmulation, because the latter ignores a page's viewport
// meta tag in mobile mode and lays everything out at 980px.
async function applyEmulation(wc) {
  const st = stateOf(wc);
  if (!st.live) return;
  const { vp, scale } = st.wanted;
  try {
    if (isFit(vp)) {
      if (st.emulating) {
        await wc.debugger.sendCommand('Emulation.clearDeviceMetricsOverride');
        await wc.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false });
        st.emulating = false;
      }
      return;
    }
    await ensureDebugger(wc);
    await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr || 0, mobile: Boolean(vp.mobile), scale,
    });
    await wc.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: Boolean(vp.mobile), maxTouchPoints: 5 });
    st.emulating = true;
  } catch (e) {
    debug('emulation failed:', e.message);
  }
}

// Records what a view should emulate and sets its user agent. Returns true when the
// user agent changed, which only takes effect on the next load.
function setViewportFor(wc, vp, scale) {
  const st = stateOf(wc);
  st.wanted = { vp, scale };
  if (st.live) applyEmulation(wc);
  const wantUA = vp && vp.mobile ? mobileUserAgent(process.versions.chrome) : defaultUserAgent;
  const changed = wc.getUserAgent() !== wantUA;
  if (changed) wc.setUserAgent(wantUA);
  return changed;
}

// Places every view. Returns true when a user agent changed and the caller should reload.
function layout() {
  if (!win) return false;
  const { width, height } = win.getContentBounds();
  panel.setBounds({ x: 0, y: 0, width: PANEL_WIDTH, height });
  const area = { x: PANEL_WIDTH, y: 0, width: Math.max(0, width - PANEL_WIDTH), height };
  const vp = effectiveViewport();
  let uaChanged = false;

  if (compare) {
    pane.setVisible(false);
    // While capturing for a blend, and under the overlay, every cell is stacked at the
    // full area so the captures are as large as the stage that will show them.
    const stacked = compare.blend || compare.capturing;
    const grid = stacked ? null : gridLayout(compare.n, area, vp ? { width: vp.width, height: vp.height } : null, GAP);
    cells.forEach((cell, i) => {
      if (i >= compare.n) { cell.setVisible(false); return; }
      const { bounds, scale } = layoutFor(vp, stacked ? area : grid.cells[i]);
      cell.setBounds(bounds);
      cell.setVisible(true);              // stays visible under the overlay so it can be captured
      if (i === 0) currentScale = scale;
      uaChanged = setViewportFor(cell.webContents, vp, scale) || uaChanged;
    });
    overlay.setBounds(area);
    overlay.setVisible(compare.blend);
  } else {
    for (const cell of cells) cell.setVisible(false);
    overlay.setVisible(false);
    pane.setVisible(true);
    const { bounds, scale } = layoutFor(vp, area);
    pane.setBounds(bounds);
    currentScale = scale;
    uaChanged = setViewportFor(pane.webContents, vp, scale);
  }
  debug('layout', describe(vp, currentScale), compare ? `compare ${compare.n} cells, ${compare.mode}${compare.blend ? ' (blend)' : ''}` : 'single', uaChanged ? '(user agent changed)' : '');
  return uaChanged;
}

function setViewport(req) {
  if (!task) return;
  const before = effectiveViewport();
  if (!req || req.mode === 'task') viewportOverride = undefined;
  else if (req.mode === 'preset') viewportOverride = normalizeViewport(req.name);
  else if (req.mode === 'custom') viewportOverride = normalizeViewport({ width: req.width, height: req.height, mobile: req.mobile });
  else if (req.mode === 'cycle') {
    // task -> fit -> desktop -> tablet -> phone -> task
    const cur = viewportOverride === undefined ? -1 : CYCLE.indexOf(viewportOverride ? viewportOverride.name : 'fit');
    const next = cur + 1;
    viewportOverride = next >= CYCLE.length ? undefined : normalizeViewport(CYCLE[next]);
  }
  const after = effectiveViewport();
  const uaChanged = layout();
  const mobileFlipped = Boolean(before && before.mobile) !== Boolean(after && after.mobile);
  if (uaChanged || mobileFlipped) showItem(index, { force: true });
  else { highlightRun++; rehighlightAll(); sendState(); }
}

function viewportState() {
  const item = currentItem();
  const vp = effectiveViewport();
  return {
    source: viewportOverride === undefined ? 'task' : 'override',
    effective: vp,
    scale: currentScale,
    text: describe(vp, currentScale),
    task: item ? (item.pane.viewport ? item.pane.viewport.name : 'fit') : 'fit',
    presets: Object.values(PRESETS).map((p) => ({ name: p.name, label: p.label })),
  };
}

// ---------- task flow ----------

function currentItem() {
  return task ? task.items[index] : null;
}

function firstUnansweredFrom(start) {
  for (let i = start; i < task.items.length; i++) {
    if (!results.data.answers[task.items[i].id]) return i;
  }
  return -1;
}

function summarizeHighlight() {
  if (!lastHighlight) return null;
  if (!lastHighlight.cells) return lastHighlight;
  const item = currentItem();
  const found = [], missing = [];
  lastHighlight.cells.forEach((r, i) => {
    if (!r || r.found === null) return;
    (r.found ? found : missing).push(LETTERS[i]);
  });
  if (!found.length && !missing.length) return null;
  const parts = [];
  if (found.length) parts.push(`found in ${found.join(', ')}`);
  if (missing.length) parts.push(`not in ${missing.join(', ')}`);
  return { compare: true, found: found.length > 0, text: `${JSON.stringify(item.pane.focus)} ${parts.join(' · ')}`, focus: item && item.pane.focus };
}

function compareState() {
  if (!compare) return null;
  const item = currentItem();
  return {
    n: compare.n,
    mode: compare.mode,
    blend: compare.blend,
    sync: compare.sync,
    loaded: compare.loaded.size,
    capturedAt: compare.capturedAt,
    sources: item.pane.sources.map((s, i) => ({ letter: LETTERS[i], label: s.label, kind: s.kind, src: s.src })),
  };
}

function sendState() {
  if (!panel || !task) return;
  const item = currentItem();
  panel.webContents.send('state', {
    title: task.title,
    description: task.description,
    index,
    total: task.items.length,
    answered: Object.keys(results.data.answers).length,
    item,
    answer: results.data.answers[item.id] || null,
    done: results.data.done,
    resultsFile: results.file,
    highlight: summarizeHighlight(),
    pane: paneState,
    viewport: viewportState(),
    compare: compareState(),
  });
}

function localUrl(src) {
  const base = path.dirname(task.file);
  return /^[a-z][a-z0-9+.-]*:/i.test(src) ? src : pathToFileURL(path.resolve(base, src)).href;
}

function imageViewerUrl(src, caption, badge, label) {
  const u = pathToFileURL(path.join(__dirname, 'viewer', 'image.html'));
  u.searchParams.set('src', localUrl(src));
  if (caption) u.searchParams.set('caption', caption);
  if (badge) { u.searchParams.set('badge', badge); u.searchParams.set('label', label || ''); }
  return u.href;
}

function resolveTarget(item) {
  const p = item.pane;
  if (p.kind === 'url') return p.src;
  if (p.kind === 'snapshot') return localUrl(p.src);
  if (p.kind === 'image') return imageViewerUrl(p.src, p.caption);
  return 'about:blank';
}

function resolveSource(src, i) {
  if (src.kind === 'url') return src.src;
  if (src.kind === 'snapshot') return localUrl(src.src);
  return imageViewerUrl(src.src, null, LETTERS[i], src.label);
}

async function showItem(i, { force = false } = {}) {
  if (!task) return;
  index = Math.max(0, Math.min(task.items.length - 1, i));
  const item = currentItem();
  lastHighlight = null;
  highlightRun++;

  if (item.pane.kind === 'compare') {
    const n = item.pane.sources.length;
    if (lastTaskMode !== item.pane.mode) { modeOverride = undefined; lastTaskMode = item.pane.mode; }
    compare = {
      n, mode: modeOverride || item.pane.mode, blend: false, capturing: false, sync: compare ? compare.sync : true,
      loaded: new Set(), captureRun: 0, images: null, position: null, capturedAt: null,
    };
    ensureCells(n);
    const uaChanged = layout();
    debug('item', index + 1, 'of', task.items.length, item.id, `compare x${n}`, compare.mode);
    item.pane.sources.forEach((src, k) => {
      const url = resolveSource(src, k);
      const wc = cells[k].webContents;
      if (force || uaChanged || wc.getURL() !== url) wc.loadURL(url).catch(() => {});
      else onLoaded(wc, k);
    });
  } else {
    compare = null;
    const url = resolveTarget(item);
    const wc = pane.webContents;
    const uaChanged = layout();
    debug('item', index + 1, 'of', task.items.length, item.id, '->', url);
    if (force || uaChanged || wc.getURL() !== url) {
      sendPane({ loading: true, error: null, url, title: '' });
      wc.loadURL(url).catch(() => {});
    } else {
      runHighlight(wc, -1);
    }
  }
  focusControls();
  sendState();
}

async function onLoaded(wc, cellIndex) {
  const item = currentItem();
  if (!item) return;
  if (cellIndex < 0) {
    if (item.pane.kind === 'compare') return;
    await installPageHooks(wc, null);
    runHighlight(wc, -1);
    return;
  }
  const c = compare;
  if (!c || cellIndex >= c.n) return;
  c.loaded.add(cellIndex);
  await installPageHooks(wc, `${LETTERS[cellIndex]} · ${item.pane.sources[cellIndex].label}`);
  await runHighlight(wc, cellIndex);
  if (compare !== c || c.loaded.size !== c.n) return;
  if (process.env.RORSCHACH_DEBUG_SELFTEST && !c.selfTested) { c.selfTested = true; c.testing = true; await selfTests(); c.testing = false; }
  if (compare === c && !c.testing && c.mode !== 'grid' && !c.blend) enterBlend();
}

// Debug only. Scroll cell A by script and check that B followed; then send key
// presses into cell A's page and check they reach the panel only when no text field
// is focused there.
async function selfTests() {
  const a = cells[0].webContents;
  try {
    await a.executeJavaScript('scrollTo(0, 600)', true);
    await delay(700);
    const y = await cells[1].webContents.executeJavaScript('scrollY', true);
    debug('self-test scroll sync: A -> 600, B at', y, y > 0 ? 'OK' : 'FAILED');

    const answered = () => Object.keys(results.data.answers).length;
    const before = answered();
    a.focus();                            // as a click into the page would
    await delay(200);
    const focused = await a.executeJavaScript("(() => { const i = document.querySelector('input[type=search], input[type=text], input, textarea'); if (!i) return false; i.focus(); return document.activeElement === i; })()", true);
    await delay(300);
    a.sendInputEvent({ type: 'keyDown', keyCode: '1' });
    await delay(400);
    debug('self-test key while editing:', focused ? (answered() === before ? 'ignored OK' : 'FAILED, answered') : 'no field to focus');
    await a.executeJavaScript('document.activeElement && document.activeElement.blur()', true);
    await delay(300);
    a.sendInputEvent({ type: 'keyDown', keyCode: '1' });
    await delay(400);
    debug('self-test key from page:', answered() > before ? 'answered OK' : 'FAILED, not answered');
  } catch (e) { debug('self-test failed', e.message); }
}

// Hooks run inside a live page: a letter badge in the corner (compare cells), a scroll
// listener so sibling cells can follow, and focus listeners that say whether a text
// field is being edited, so bare hotkeys can be forwarded the rest of the time.
// Pages the app serves itself (the image viewer) are left alone.
async function installPageHooks(wc, badgeText) {
  if (!/^(https?|file):/i.test(wc.getURL()) || wc.getURL().includes('/viewer/image.html')) return;
  await ensureDebugger(wc);
  const script = `(() => {
    const text = ${JSON.stringify(badgeText)};
    let b = document.getElementById('__rorschach_badge');
    if (text) {
      if (!b) { b = document.createElement('div'); b.id = '__rorschach_badge'; document.documentElement.appendChild(b); }
      b.textContent = text;
      b.style.cssText = 'position:fixed;top:8px;left:8px;z-index:2147483647;padding:3px 8px;border-radius:4px;background:rgba(20,24,29,.85);color:#fff;font:600 12px system-ui,sans-serif;pointer-events:none';
    } else if (b) b.remove();
    if (window.__rorschachHooked) return;
    window.__rorschachHooked = true;
    const send = (m) => { if (typeof __rorschach === 'function') __rorschach(m); };
    addEventListener('scroll', () => send('scroll:' + scrollX + ',' + scrollY), { passive: true });
    const editable = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    addEventListener('focusin', (e) => send('focus:' + (editable(e.target) ? '1' : '0')), true);
    addEventListener('focusout', () => send('focus:0'), true);
    send('focus:' + (editable(document.activeElement) ? '1' : '0'));
  })()`;
  try { await wc.executeJavaScript(script, true); } catch (e) { debug('page hooks failed:', e.message); }
}

function onCellScroll(i, payload) {
  if (!compare || !compare.sync || i < 0 || i >= compare.n) return;
  const [x, y] = String(payload).split(',').map(Number);
  const st = stateOf(cells[i].webContents);
  if (st.applied && st.applied.x === x && st.applied.y === y) { st.applied = null; return; }  // our own scrollTo echoing back
  for (let j = 0; j < compare.n; j++) {
    if (j === i) continue;
    const wc = cells[j].webContents;
    stateOf(wc).applied = { x, y };
    wc.executeJavaScript(`scrollTo(${x}, ${y})`, true).catch(() => {});
  }
}

function setHighlight(cellIndex, res) {
  if (cellIndex < 0) lastHighlight = res;
  else {
    if (!lastHighlight || !lastHighlight.cells) lastHighlight = { cells: [] };
    lastHighlight.cells[cellIndex] = res;
  }
  sendState();
}

async function runHighlight(wc, cellIndex) {
  const item = currentItem();
  if (!item) return null;
  const focus = item.pane.focus;
  const kind = cellIndex < 0 ? item.pane.kind : item.pane.sources[cellIndex].kind;
  const tag = cellIndex < 0 ? item.id : `${item.id}/${LETTERS[cellIndex]}`;
  const run = highlightRun;
  if (!focus || (kind !== 'url' && kind !== 'snapshot')) { setHighlight(cellIndex, { found: null }); return null; }
  for (let t = 0; t < HIGHLIGHT_TRIES && run === highlightRun; t++) {
    let res = null;
    try { res = await wc.executeJavaScript(highlightScript(focus), true); } catch (e) { debug('highlight script error:', e.message); }
    if (run !== highlightRun) return null;
    if (res && res.found) { setHighlight(cellIndex, res); debug('highlight', tag, 'found', JSON.stringify(res.text)); await probe(wc, tag); return res; }
    await delay(HIGHLIGHT_DELAY_MS);
  }
  if (run === highlightRun) { setHighlight(cellIndex, { found: false, focus }); debug('highlight', tag, 'NOT found:', focus); await probe(wc, tag); }
  return null;
}

function rehighlightAll() {
  if (compare) cells.slice(0, compare.n).forEach((cell, k) => runHighlight(cell.webContents, k));
  else runHighlight(pane.webContents, -1);
}

// ---------- compare: blend modes ----------

function captureDir() {
  const dir = path.join(app.getPath('temp'), 'rorschach-captures', String(process.pid));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function enterBlend() {
  const c = compare;
  const item = currentItem();
  if (!c || !item) return;
  const run = ++c.captureRun;
  if (!c.blend) { c.capturing = true; layout(); await delay(450); }   // let the pages reflow at full size
  if (compare !== c || run !== c.captureRun) return;
  const images = [];
  for (let k = 0; k < c.n; k++) {
    const src = item.pane.sources[k];
    const base = { letter: LETTERS[k], label: src.label };
    if (src.kind === 'image') { images.push({ ...base, url: localUrl(src.src) }); continue; }
    try {
      const img = await cells[k].webContents.capturePage();
      if (compare !== c || run !== c.captureRun) return;
      const file = path.join(captureDir(), `${Date.now()}-${k}.png`);
      fs.writeFileSync(file, img.toPNG());
      images.push({ ...base, url: pathToFileURL(file).href });
    } catch (e) {
      debug('capture failed', LETTERS[k], e.message);
      images.push({ ...base, url: '' });
    }
  }
  for (let t = 0; t < 10 && !overlayReady; t++) await delay(200);
  if (compare !== c || run !== c.captureRun) return;
  c.images = images;
  c.capturing = false;
  c.blend = true;
  c.capturedAt = new Date().toISOString();
  overlay.webContents.send('compare', { mode: c.mode, images, position: c.position });
  layout();
  focusControls();
  debug('blend', c.mode, images.map((i) => `${i.letter}:${i.url ? 'ok' : 'FAILED'}`).join(' '));
  sendState();
  if (SNAPSHOT_DIR) { await delay(1500); if (compare === c) await snapshot(`${item.id}.blend`, overlay.webContents); }
  if (process.env.RORSCHACH_DEBUG_SELFTEST && c.mode === 'wipe' && compare === c) await dragSelfTest();
}

// Debug only: drag the first wipe divider 300px to the right with synthetic mouse
// events and check that it followed the whole way.
async function dragSelfTest() {
  const ov = overlay.webContents;
  await delay(1500);
  try {
    const r = await ov.executeJavaScript("(() => { const g = document.querySelector('.divider .grip'); if (!g) return null; const b = g.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, pos: document.getElementById('pos').textContent }; })()", true);
    if (!r) { debug('self-test drag: no divider found'); return; }
    ov.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 20; i++) {
      ov.sendInputEvent({ type: 'mouseMove', x: r.x + i * 15, y: r.y, button: 'left', modifiers: ['leftButtonDown'] });
      await delay(16);
    }
    ov.sendInputEvent({ type: 'mouseUp', x: r.x + 300, y: r.y, button: 'left', clickCount: 1 });
    await delay(300);
    const after = await ov.executeJavaScript("document.getElementById('pos').textContent", true);
    debug('self-test drag: before', JSON.stringify(r.pos), 'after', JSON.stringify(after), r.pos !== after ? 'OK' : 'FAILED');
  } catch (e) { debug('self-test drag failed', e.message); }
}

function exitBlend() {
  if (!compare) return;
  compare.blend = false;
  layout();
  focusControls();
  sendState();
}

function setMode(mode) {
  if (!compare) return;
  modeOverride = mode;
  compare.mode = mode;
  if (mode === 'grid') { exitBlend(); return; }
  if (compare.blend && compare.images) {
    overlay.webContents.send('compare', { mode, images: compare.images, position: null });
    focusControls();
    sendState();
  } else if (compare.loaded.size === compare.n) {
    enterBlend();
  } else {
    sendState();                          // blend starts once every cell has loaded
  }
}

async function snapshot(tag, wc) {
  if (!SNAPSHOT_DIR) return;
  try {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    let img;
    try { img = await wc.capturePage(); } catch { await delay(400); img = await wc.capturePage(); }
    const file = path.join(SNAPSHOT_DIR, `${tag.replace(/[\\/:]/g, '_')}.png`);
    fs.writeFileSync(file, img.toPNG());
    debug('snapshot', file, `${img.getSize().width}x${img.getSize().height}`);
    const ui = await panel.webContents.capturePage();
    fs.writeFileSync(path.join(SNAPSHOT_DIR, `${currentItem().id}.panel.png`), ui.toPNG());
    if (compare && compare.blend) {
      const ov = await overlay.webContents.capturePage();
      fs.writeFileSync(path.join(SNAPSHOT_DIR, `${currentItem().id}.blend-${compare.mode}.png`), ov.toPNG());
    }
  } catch (e) { debug('snapshot failed', e.message); }
}

// Debug only: report what the page believes about its viewport, and save snapshots.
async function probe(wc, tag) {
  if (!process.env.RORSCHACH_DEBUG) return;
  try {
    const r = await wc.executeJavaScript(
      '({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, coarse: matchMedia("(pointer: coarse)").matches, ua: navigator.userAgent.slice(0, 70) })', true);
    debug('page sees', tag, JSON.stringify(r));
  } catch (e) { debug('probe failed', e.message); }
  await snapshot(tag, wc);
}

async function openTask(file, resultsFile) {
  try {
    task = loadTask(file);
  } catch (e) {
    dialog.showErrorBox('Could not load the task file', e.message);
    return false;
  }
  results = Results.open(resultsFile || defaultResultsPath(task.file), task);
  win.setTitle(`${task.title} · Rorschach`);
  const start = firstUnansweredFrom(0);
  await showItem(start === -1 ? 0 : start, { force: true });
  return true;
}

// ---------- ipc ----------

ipcMain.on('panel-ready', () => { sendState(); sendPane({}); });
ipcMain.on('overlay-ready', () => { overlayReady = true; });

ipcMain.on('answer', (_e, { value, label, note }) => {
  const item = currentItem();
  if (!item) return;
  debug('answer', item.id, '=', value);
  const vp = effectiveViewport();
  const viewport = vp
    ? { name: vp.name, width: vp.width, height: vp.height, mobile: vp.mobile, scale: Math.round(currentScale * 1000) / 1000 }
    : { name: 'fit' };
  const extra = compare ? { compare: { mode: compare.mode, position: compare.position, capturedAt: compare.capturedAt } } : {};
  results.answer(item.id, { value, label, note: note || '', index, viewport, ...extra });
  let next = firstUnansweredFrom(index + 1);
  if (next === -1) next = firstUnansweredFrom(0);
  if (next === -1) { results.finish(); sendState(); return; }
  showItem(next);
});

ipcMain.on('clear-answer', () => {
  const item = currentItem();
  if (!item) return;
  results.clear(item.id);
  sendState();
});

ipcMain.on('nav', (_e, to) => {
  if (!task) return;
  if (to === 'back') showItem(index - 1);
  else if (to === 'next') showItem(index + 1);
  else if (to === 'first-unanswered') { const n = firstUnansweredFrom(0); showItem(n === -1 ? 0 : n); }
  else if (typeof to === 'number') showItem(to);
});

ipcMain.on('open-external', () => {
  const item = currentItem();
  if (!item) return;
  const urls = item.pane.kind === 'compare'
    ? item.pane.sources.filter((s) => s.kind === 'url').map((s) => s.src)
    : [pane.webContents.getURL()];
  for (const url of urls) if (/^https?:/i.test(url)) shell.openExternal(url);
});
ipcMain.on('rehighlight', () => { highlightRun++; rehighlightAll(); });
ipcMain.on('reload', () => showItem(index, { force: true }));
ipcMain.on('reveal-results', () => { if (results) shell.showItemInFolder(results.file); });
ipcMain.on('open-task', async () => {
  const file = await pickTaskFile();
  if (file) openTask(file, null);
});
ipcMain.on('viewport', (_e, req) => {
  try { setViewport(req); } catch (e) { debug('viewport rejected', e.message); sendState(); }
});
ipcMain.on('compare', (_e, req) => {
  if (!compare || !req) return;
  if (req.action === 'mode') setMode(req.mode);
  else if (req.action === 'sync') { compare.sync = Boolean(req.on); sendState(); }
  else if (req.action === 'recapture') { if (compare.mode === 'grid') setMode('fade'); else enterBlend(); }
});
ipcMain.on('overlay-hotkey', (_e, key) => { panel.webContents.send('hotkey', key); });
ipcMain.on('overlay-action', (_e, name) => {
  if (name === 'grid') setMode('grid');
  else if (name === 'recapture') enterBlend();
});
ipcMain.on('overlay-position', (_e, p) => { if (compare) compare.position = p; });

// ---------- lifecycle ----------

app.whenReady().then(async () => {
  createWindow();
  const { taskFile, resultsFile } = parseArgs(process.argv);
  const file = taskFile || await pickTaskFile();
  if (!file) { app.quit(); return; }
  const ok = await openTask(file, resultsFile);
  if (!ok) app.quit();
});

app.on('will-quit', () => {
  try { fs.rmSync(path.join(app.getPath('temp'), 'rorschach-captures', String(process.pid)), { recursive: true, force: true }); } catch {}
});
app.on('window-all-closed', () => app.quit());
