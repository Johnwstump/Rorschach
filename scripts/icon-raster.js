'use strict';

// Renders build/icon.svg to PNGs, a Windows ICO and the GitHub social preview using
// Electron's own Chromium, so the icon matches what the browser preview showed, SVG
// filters included.
// Usage: electron scripts/icon-raster.js
// Writes build/icon.png (1024), build/icon-512.png, build/icon-256.png, build/icon.ico
// and build/social-preview.png (1280×640).

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const BUILD = path.join(__dirname, '..', 'build');
const SVG = path.join(BUILD, 'icon.svg');
const FONT = path.join(BUILD, 'fonts', 'Anton-Regular.ttf');   // fetched by icon-svg.js
const RENDER = 1024;
const ICO_SIZES = [256, 128, 64, 48, 32, 16];
const SOCIAL = { width: 1280, height: 640 };

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

// Loads a page of the given size offscreen and captures it. One window is reused for
// every render: destroying an offscreen window makes the next one's load fail. The
// page is written to a file in build/ because a file:// page can load the file:// SVG,
// where a data: page could not. The capture is scaled back to the requested size
// regardless of the display's device pixel ratio.
let win = null;
async function render(name, html, { width, height }) {
  if (!win) {
    win = new BrowserWindow({
      width, height, show: false, transparent: true, frame: false,
      webPreferences: { offscreen: true, sandbox: true },
    });
  }
  win.setContentSize(width, height);
  const wrapper = path.join(BUILD, `.icon-render-${name}.html`);
  fs.writeFileSync(wrapper, `<!doctype html><meta charset="utf-8">${html}`);
  try {
    await win.loadFile(wrapper);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => null)');
    await new Promise((r) => setTimeout(r, 800));       // let the filter settle
  } finally {
    fs.unlinkSync(wrapper);
  }
  let img = await win.webContents.capturePage();
  if (img.getSize().width !== width) img = img.resize({ width, height, quality: 'best' });
  return img;
}

function iconPage() {
  return `<style>html,body{margin:0;background:transparent}img{display:block;width:${RENDER}px;height:${RENDER}px}</style>
<img src="${pathToFileURL(SVG).href}">`;
}

// The 1280×640 card GitHub shows when the repository is linked: the mark on ink,
// the name set in the same typeface as the R.
function socialPage() {
  // The font goes in as a data URI: a file:// font in a sandboxed offscreen page fails to load.
  const face = fs.existsSync(FONT) ? `@font-face{font-family:Anton;src:url(data:font/ttf;base64,${fs.readFileSync(FONT).toString('base64')})}` : '';
  return `<style>
${face}
html,body{margin:0;width:${SOCIAL.width}px;height:${SOCIAL.height}px;background:#15181d;overflow:hidden}
body{display:flex;align-items:center;gap:72px;padding:0 112px;box-sizing:border-box;color:#f6f5f0;font-family:system-ui,"Segoe UI",Helvetica,Arial,sans-serif}
img{width:320px;height:320px;flex:none;filter:drop-shadow(0 18px 40px rgba(0,0,0,.45))}
h1{margin:0;font:400 132px/1 Anton,Impact,"Arial Narrow Bold",sans-serif;letter-spacing:.02em;text-transform:uppercase}
p{margin:22px 0 0;font-size:34px;line-height:1.3;color:#b9bcc4;max-width:640px}
</style>
<img src="${pathToFileURL(SVG).href}">
<div><h1>Rorschach</h1><p>A review station. Look at each thing, press a key, move on.</p></div>`;
}

app.whenReady().then(async () => {
  if (!fs.existsSync(SVG)) throw new Error(`${SVG} is missing; run "node scripts/icon-svg.js" first.`);

  const img = await render('icon', iconPage(), { width: RENDER, height: RENDER });
  fs.writeFileSync(path.join(BUILD, 'icon.png'), img.toPNG());
  for (const s of [512, 256]) fs.writeFileSync(path.join(BUILD, `icon-${s}.png`), img.resize({ width: s, height: s, quality: 'best' }).toPNG());
  const entries = ICO_SIZES.map((size) => ({ size, png: img.resize({ width: size, height: size, quality: 'best' }).toPNG() }));
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), ico(entries));

  const social = await render('social', socialPage(), SOCIAL);
  fs.writeFileSync(path.join(BUILD, 'social-preview.png'), social.toPNG());

  console.log(`wrote build/icon.png (${RENDER}), icon-512.png, icon-256.png, icon.ico (${ICO_SIZES.join('/')}), social-preview.png (${SOCIAL.width}×${SOCIAL.height})`);
  app.quit();
}).catch((e) => { console.error(e.message); app.exit(1); });
