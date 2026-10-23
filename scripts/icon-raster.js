'use strict';

// Renders build/icon.svg to PNGs and a Windows ICO using Electron's own Chromium, so
// the icon matches what the browser preview showed, SVG filters included.
// Usage: electron scripts/icon-raster.js
// Writes build/icon.png (1024), build/icon-512.png, build/icon-256.png, build/icon.ico.

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const BUILD = path.join(__dirname, '..', 'build');
const SVG = path.join(BUILD, 'icon.svg');
const RENDER = 1024;
const ICO_SIZES = [256, 128, 64, 48, 32, 16];

// An ICO is a tiny directory of images; Windows accepts PNG-encoded entries.
function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir[o] = size >= 256 ? 0 : size;        // 0 means 256
    dir[o + 1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, o + 4);            // colour planes
    dir.writeUInt16LE(32, o + 6);           // bits per pixel
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

app.whenReady().then(async () => {
  if (!fs.existsSync(SVG)) throw new Error(`${SVG} is missing; run "node scripts/icon-svg.js" first.`);
  const win = new BrowserWindow({
    width: RENDER, height: RENDER, show: false, transparent: true, frame: false,
    webPreferences: { offscreen: true, sandbox: true },
  });
  // A file:// page can load the file:// SVG (a data: page could not). The page sizes
  // the SVG in CSS pixels; the capture is scaled back to RENDER regardless of the
  // display's device pixel ratio.
  const wrapper = path.join(BUILD, '.icon-render.html');
  fs.writeFileSync(wrapper, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}img{display:block;width:${RENDER}px;height:${RENDER}px}</style><img src="${pathToFileURL(SVG).href}">`);
  await win.loadFile(wrapper);
  await new Promise((r) => setTimeout(r, 800));       // let the filter settle
  let img = await win.webContents.capturePage();
  fs.unlinkSync(wrapper);
  if (img.getSize().width !== RENDER) img = img.resize({ width: RENDER, height: RENDER, quality: 'best' });

  fs.writeFileSync(path.join(BUILD, 'icon.png'), img.toPNG());
  for (const s of [512, 256]) fs.writeFileSync(path.join(BUILD, `icon-${s}.png`), img.resize({ width: s, height: s, quality: 'best' }).toPNG());
  const entries = ICO_SIZES.map((size) => ({ size, png: img.resize({ width: size, height: size, quality: 'best' }).toPNG() }));
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), ico(entries));
  console.log(`wrote build/icon.png (${RENDER}), icon-512.png, icon-256.png, icon.ico (${ICO_SIZES.join('/')})`);
  app.quit();
}).catch((e) => { console.error(e.message); app.exit(1); });
