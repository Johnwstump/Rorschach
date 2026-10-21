'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rorshach', {
  ready: () => ipcRenderer.send('panel-ready'),
  answer: (a) => ipcRenderer.send('answer', a),
  clearAnswer: () => ipcRenderer.send('clear-answer'),
  nav: (to) => ipcRenderer.send('nav', to),
  openExternal: () => ipcRenderer.send('open-external'),
  rehighlight: () => ipcRenderer.send('rehighlight'),
  viewport: (req) => ipcRenderer.send('viewport', req),
  reload: () => ipcRenderer.send('reload'),
  revealResults: () => ipcRenderer.send('reveal-results'),
  openTask: () => ipcRenderer.send('open-task'),
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
  onPane: (fn) => ipcRenderer.on('pane', (_e, p) => fn(p)),
  onHotkey: (fn) => ipcRenderer.on('hotkey', (_e, k) => fn(k)),
});
