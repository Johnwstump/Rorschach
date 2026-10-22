'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rorshachCompare', {
  ready: () => ipcRenderer.send('overlay-ready'),
  hotkey: (key) => ipcRenderer.send('overlay-hotkey', key),
  action: (name) => ipcRenderer.send('overlay-action', name),
  position: (p) => ipcRenderer.send('overlay-position', p),
  onCompare: (fn) => ipcRenderer.on('compare', (_e, data) => fn(data)),
});
