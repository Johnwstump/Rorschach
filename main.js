'use strict';

const { app, BaseWindow, WebContentsView, ipcMain, shell, dialog, nativeTheme } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { loadTask } = require('./lib/task');
const { Results } = require('./lib/results');
const { highlightScript } = require('./lib/highlight');

const PANEL_WIDTH = 420;
const HIGHLIGHT_TRIES = 12;      // pages that render late get a few chances
const HIGHLIGHT_DELAY_MS = 600;

let win = null;
let panel = null;   // the control panel (our UI)
let pane = null;    // the thing being reviewed (a page, an image, a snapshot)

let task = null;
let results = null;
let index = 0;
let highlightRun = 0;            // bumped whenever a new item loads, so stale retries stop
let lastHighlight = null;
let paneState = { loading: false, url: '', title: '', error: null };

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- arguments ----------

function parseArgs(argv) {
  // dev:      electron . task.json --out results.json
  // packaged: Rorshach.exe task.json --out results.json
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

// ---------- window ----------

function createWindow() {
  win = new BaseWindow({
    width: 1560,
    height: 980,
    minWidth: 900,
    minHeight: 600,
    title: 'Rorshach',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14181d' : '#f4f5f7',
  });

  panel = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The pane shows third-party content. It gets no preload, no Node, a sandbox,
  // and its own persistent session so logins survive between runs.
  pane = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'persist:rorshach-pane',
    },
  });

  win.contentView.addChildView(panel);
  win.contentView.addChildView(pane);

  const layout = () => {
    const { width, height } = win.getContentBounds();
    panel.setBounds({ x: 0, y: 0, width: PANEL_WIDTH, height });
    pane.setBounds({ x: PANEL_WIDTH, y: 0, width: Math.max(0, width - PANEL_WIDTH), height });
  };
  win.on('resize', layout);
  layout();
  win.on('closed', () => { win = null; });

  const wc = pane.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    wc.loadURL(url).catch(() => {});       // popups stay in the pane
    return { action: 'deny' };
  });
  wc.on('did-start-loading', () => sendPane({ loading: true, error: null }));
  wc.on('did-stop-loading', () => sendPane({ loading: false, url: wc.getURL(), title: wc.getTitle() }));
  wc.on('page-title-updated', (_e, title) => sendPane({ title }));
  wc.on('did-finish-load', () => { runHighlight(); });
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) sendPane({ loading: false, error: `${desc} (${code})`, url });
  });
  // Alt+<key> works even while the page has keyboard focus.
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.alt || input.control || input.meta) return;
    panel.webContents.send('hotkey', input.key);
    event.preventDefault();
  });

  panel.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      pane.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
  panel.webContents.loadFile(path.join(__dirname, 'panel', 'index.html'));
}

function sendPane(patch) {
  paneState = { ...paneState, ...patch };
  if (panel) panel.webContents.send('pane', paneState);
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
    highlight: lastHighlight,
    pane: paneState,
  });
}

function resolveTarget(item) {
  const base = path.dirname(task.file);
  const p = item.pane;
  const local = (src) => (/^[a-z][a-z0-9+.-]*:/i.test(src) ? src : pathToFileURL(path.resolve(base, src)).href);
  if (p.kind === 'url') return p.src;
  if (p.kind === 'snapshot') return local(p.src);
  if (p.kind === 'image') {
    const u = pathToFileURL(path.join(__dirname, 'viewer', 'image.html'));
    u.searchParams.set('src', local(p.src));
    if (p.caption) u.searchParams.set('caption', p.caption);
    return u.href;
  }
  return 'about:blank';
}

async function showItem(i, { force = false } = {}) {
  if (!task) return;
  index = Math.max(0, Math.min(task.items.length - 1, i));
  const item = currentItem();
  lastHighlight = null;
  highlightRun++;
  const url = resolveTarget(item);
  const wc = pane.webContents;
  if (force || wc.getURL() !== url) {
    sendPane({ loading: true, error: null, url, title: '' });
    wc.loadURL(url).catch(() => {});
  } else {
    runHighlight();
  }
  sendState();
}

async function runHighlight() {
  const item = currentItem();
  if (!item) return;
  const focus = item.pane && item.pane.focus;
  const run = highlightRun;
  if (!focus) { lastHighlight = { found: null }; sendState(); return; }
  for (let t = 0; t < HIGHLIGHT_TRIES && run === highlightRun; t++) {
    let res = null;
    try { res = await pane.webContents.executeJavaScript(highlightScript(focus), true); } catch { res = null; }
    if (run !== highlightRun) return;
    if (res && res.found) { lastHighlight = res; sendState(); return; }
    await delay(HIGHLIGHT_DELAY_MS);
  }
  if (run === highlightRun) { lastHighlight = { found: false, focus }; sendState(); }
}

async function openTask(file, resultsFile) {
  try {
    task = loadTask(file);
  } catch (e) {
    dialog.showErrorBox('Could not load the task file', e.message);
    return false;
  }
  results = Results.open(resultsFile || defaultResultsPath(task.file), task);
  win.setTitle(`${task.title} · Rorshach`);
  const start = firstUnansweredFrom(0);
  await showItem(start === -1 ? 0 : start, { force: true });
  return true;
}

// ---------- ipc ----------

ipcMain.on('panel-ready', () => { sendState(); sendPane({}); });

ipcMain.on('answer', (_e, { value, label, note }) => {
  const item = currentItem();
  if (!item) return;
  results.answer(item.id, { value, label, note: note || '', index });
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
  const url = pane.webContents.getURL();
  if (/^https?:/i.test(url)) shell.openExternal(url);
});
ipcMain.on('rehighlight', () => { highlightRun++; runHighlight(); });
ipcMain.on('reload', () => showItem(index, { force: true }));
ipcMain.on('reveal-results', () => { if (results) shell.showItemInFolder(results.file); });
ipcMain.on('open-task', async () => {
  const file = await pickTaskFile();
  if (file) openTask(file, null);
});

// ---------- lifecycle ----------

app.whenReady().then(async () => {
  createWindow();
  const { taskFile, resultsFile } = parseArgs(process.argv);
  const file = taskFile || await pickTaskFile();
  if (!file) { app.quit(); return; }
  const ok = await openTask(file, resultsFile);
  if (!ok) app.quit();
});

app.on('window-all-closed', () => app.quit());
