'use strict';

// The blend overlay: every source as an image in one frame, with either a crossfade
// slider (fade) or draggable curtains (wipe). Both work past two sources: fade walks
// a timeline A→B→C with a crossfade between neighbours (Space blinks between whole
// sources), and wipe gives N sources N-1 dividers, each region showing the next one.

const api = window.rorshachCompare;
const $ = (id) => document.getElementById(id);
const stage = $('stage');
const slider = $('slider');

let data = null;      // { mode, images: [{letter, label, url}], position }
let imgs = [];        // <img> elements in source order
let frame = null;     // where images are drawn; every image uses the same scale
let dividers = [];    // wipe: ascending fractions of the frame width
let active = 0;       // wipe: the divider the arrow keys move
let t = 0;            // fade: 0 .. n-1

function fitFrame() {
  const sw = stage.clientWidth, sh = stage.clientHeight;
  const nat = imgs.map((i) => ({ w: i.naturalWidth || 1, h: i.naturalHeight || 1 }));
  const maxW = Math.max(...nat.map((n) => n.w));
  const maxH = Math.max(...nat.map((n) => n.h));
  const scale = Math.min(sw / maxW, sh / maxH, 1 / (window.devicePixelRatio || 1));
  const w = maxW * scale, h = maxH * scale;
  frame = { x: (sw - w) / 2, y: (sh - h) / 2, w, h, scale };
  imgs.forEach((img, i) => {
    // Same scale for every image; a smaller one sits centred in the frame.
    const iw = nat[i].w * scale, ih = nat[i].h * scale;
    img.style.left = `${frame.x + (w - iw) / 2}px`;
    img.style.top = `${frame.y + (h - ih) / 2}px`;
    img.style.width = `${iw}px`;
    img.style.height = `${ih}px`;
  });
}

function clearStage() {
  for (const el of stage.querySelectorAll('.badge, .divider')) el.remove();
}

function badge(letter, label, x, y) {
  const b = document.createElement('div');
  b.className = 'badge';
  const strong = document.createElement('b');
  strong.textContent = letter;
  if (letter) b.appendChild(strong);
  b.appendChild(document.createTextNode(label));
  b.style.left = `${x}px`;
  b.style.top = `${y}px`;
  stage.appendChild(b);
}

// ---------- wipe ----------

function renderWipe() {
  clearStage();
  const n = imgs.length;
  if (dividers.length !== n - 1) dividers = Array.from({ length: n - 1 }, (_, i) => (i + 1) / n);
  const bounds = [0, ...dividers, 1];
  imgs.forEach((img, i) => {
    img.classList.add('on');
    img.style.opacity = '';
    img.style.zIndex = '1';
    const left = frame.x + bounds[i] * frame.w;
    const right = frame.x + bounds[i + 1] * frame.w;
    const imgL = parseFloat(img.style.left), imgW = parseFloat(img.style.width);
    // clip-path insets are relative to the image box.
    const insetL = Math.max(0, left - imgL);
    const insetR = Math.max(0, (imgL + imgW) - right);
    img.style.clipPath = `inset(0 ${insetR}px 0 ${insetL}px)`;
    badge(data.images[i].letter, data.images[i].label, left + 8, frame.y + 8);
  });
  dividers.forEach((f, i) => {
    const d = document.createElement('div');
    d.className = `divider${i === active ? ' active' : ''}`;
    d.style.left = `${frame.x + f * frame.w}px`;
    const hit = document.createElement('div'); hit.className = 'hit';
    const grip = document.createElement('div'); grip.className = 'grip'; grip.textContent = '⇔';
    d.append(hit, grip);
    d.addEventListener('pointerdown', (e) => {
      active = i;
      d.setPointerCapture(e.pointerId);
      const left = stage.getBoundingClientRect().left;
      const move = (ev) => setDivider(i, (ev.clientX - left - frame.x) / frame.w);
      const up = () => { d.removeEventListener('pointermove', move); d.removeEventListener('pointerup', up); report(); };
      d.addEventListener('pointermove', move);
      d.addEventListener('pointerup', up);
      e.preventDefault();
    });
    stage.appendChild(d);
  });
  $('hint').textContent = n === 2
    ? 'Drag the divider. ← → nudge it, Shift for fine steps.'
    : `${n - 1} dividers. Drag any; ← → nudge the highlighted one, Tab picks the next.`;
  $('pos').textContent = dividers.map((f) => `${Math.round(f * 100)}%`).join(' · ');
}

function setDivider(i, f) {
  const lo = i > 0 ? dividers[i - 1] + 0.01 : 0;
  const hi = i < dividers.length - 1 ? dividers[i + 1] - 0.01 : 1;
  dividers[i] = Math.min(hi, Math.max(lo, f));
  renderWipe();
}

// ---------- fade ----------

function renderFade() {
  clearStage();
  const n = imgs.length;
  const lo = Math.max(0, Math.min(n - 1, Math.floor(t)));
  const hi = Math.min(n - 1, lo + 1);
  const frac = t - lo;
  imgs.forEach((img, i) => {
    img.style.clipPath = '';
    if (i === lo) { img.classList.add('on'); img.style.opacity = '1'; img.style.zIndex = '1'; }
    else if (i === hi && frac > 0) { img.classList.add('on'); img.style.opacity = String(frac); img.style.zIndex = '2'; }
    else img.classList.remove('on');
  });
  const label = frac === 0 || lo === hi
    ? `${data.images[lo].letter} · ${data.images[lo].label}`
    : `${data.images[lo].letter} ${Math.round((1 - frac) * 100)}% · ${data.images[hi].letter} ${Math.round(frac * 100)}%`;
  badge('', label, frame.x + 8, frame.y + 8);
  slider.max = String(n - 1);
  slider.value = String(t);
  $('pos').textContent = label;
  $('hint').textContent = 'Space blinks to the next source. ← → crossfade, Shift for fine steps.';
}

function setT(v) {
  t = Math.min(imgs.length - 1, Math.max(0, v));
  renderFade();
}

// ---------- shared ----------

function render() {
  if (!data || !frame) return;
  slider.hidden = data.mode !== 'fade';
  $('mode').textContent = data.mode;
  if (data.mode === 'wipe') renderWipe(); else renderFade();
}

function report() {
  if (!data) return;
  api.position(data.mode === 'wipe'
    ? { dividers: dividers.map((f) => Math.round(f * 1000) / 1000) }
    : { t: Math.round(t * 1000) / 1000 });
}

function load(d) {
  data = d;
  for (const img of imgs) img.remove();
  imgs = [];
  $('empty').hidden = false;
  $('empty').textContent = 'Loading…';
  let pending = d.images.length;
  d.images.forEach((src) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = img.onerror = () => { if (--pending === 0) { $('empty').hidden = true; fitFrame(); render(); } };
    img.src = src.url;
    stage.appendChild(img);
    imgs.push(img);
  });
  const p = d.position || {};
  dividers = (d.mode === 'wipe' && Array.isArray(p.dividers) && p.dividers.length === d.images.length - 1) ? p.dividers.slice() : [];
  t = (d.mode === 'fade' && typeof p.t === 'number') ? p.t : 0;
  active = 0;
  stage.focus();
}

slider.addEventListener('input', () => setT(Number(slider.value)));
slider.addEventListener('change', report);
$('recapture').addEventListener('click', () => api.action('recapture'));
$('grid').addEventListener('click', () => api.action('grid'));
window.addEventListener('resize', () => { if (imgs.length) { fitFrame(); render(); } });

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) return;
  if (data && imgs.length) {
    const fine = e.shiftKey;
    if (data.mode === 'wipe') {
      if (e.key === 'ArrowLeft') { setDivider(active, dividers[active] - (fine ? 0.005 : 0.03)); report(); e.preventDefault(); return; }
      if (e.key === 'ArrowRight') { setDivider(active, dividers[active] + (fine ? 0.005 : 0.03)); report(); e.preventDefault(); return; }
      if (e.key === 'Tab' && dividers.length > 1) { active = (active + 1) % dividers.length; renderWipe(); e.preventDefault(); return; }
    } else {
      if (e.key === 'ArrowLeft') { setT(t - (fine ? 0.02 : 0.1)); report(); e.preventDefault(); return; }
      if (e.key === 'ArrowRight') { setT(t + (fine ? 0.02 : 0.1)); report(); e.preventDefault(); return; }
      if (e.key === ' ') { const next = Math.floor(t) + 1; setT(next > imgs.length - 1 ? 0 : next); report(); e.preventDefault(); return; }
      if (e.key === 'Home') { setT(0); report(); e.preventDefault(); return; }
      if (e.key === 'End') { setT(imgs.length - 1); report(); e.preventDefault(); return; }
    }
  }
  // Everything else (answers, mode keys, navigation) belongs to the panel.
  api.hotkey(e.key);
  e.preventDefault();
});

api.onCompare(load);
api.ready();
