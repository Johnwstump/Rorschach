'use strict';

// Viewport presets and the shape of a viewport spec.
//
// A viewport is either "fit" (the pane simply fills the space beside the panel and
// the page sees the real size) or a fixed logical size that Chromium emulates,
// scaled down when it does not fit. `mobile` turns on the mobile layout viewport,
// touch events and a mobile user agent.

const PRESETS = {
  fit: { name: 'fit', label: 'Fit' },
  desktop: { name: 'desktop', label: 'Desktop', width: 1440, height: 900, mobile: false, dpr: 0 },
  laptop: { name: 'laptop', label: 'Laptop', width: 1280, height: 800, mobile: false, dpr: 0 },
  tablet: { name: 'tablet', label: 'Tablet', width: 820, height: 1180, mobile: true, dpr: 2 },
  phone: { name: 'phone', label: 'Phone', width: 390, height: 844, mobile: true, dpr: 3 },
};

const CYCLE = ['fit', 'desktop', 'tablet', 'phone'];

function isFit(v) {
  return !v || v.name === 'fit';
}

// Accepts a preset name, or { width, height, mobile?, dpr? }. Returns a normalized
// viewport object, or null for "fit". Throws on nonsense so task files fail early.
function normalizeViewport(v, where = 'viewport') {
  if (v === undefined || v === null || v === 'fit') return null;
  if (typeof v === 'string') {
    const p = PRESETS[v.toLowerCase()];
    if (!p) throw new Error(`${where}: unknown viewport preset "${v}". Use ${Object.keys(PRESETS).join(', ')}, or {width, height}.`);
    return isFit(p) ? null : { ...p };
  }
  if (typeof v !== 'object') throw new Error(`${where}: viewport must be a preset name or an object.`);
  const width = Number(v.width);
  const height = Number(v.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 100 || height < 100 || width > 8000 || height > 8000) {
    throw new Error(`${where}: viewport width and height must be whole numbers between 100 and 8000.`);
  }
  const mobile = v.mobile !== undefined ? Boolean(v.mobile) : width < 768;
  const dpr = v.dpr !== undefined ? Number(v.dpr) : (mobile ? 2 : 0);
  return { name: v.name || 'custom', label: v.label || 'Custom', width, height, mobile, dpr };
}

// Given a viewport and the pixel area available for the pane, work out where the
// pane goes and how much Chromium must shrink the emulated page to fit.
function layoutFor(viewport, area) {
  if (isFit(viewport)) return { bounds: { ...area }, scale: 1 };
  const scale = Math.min(1, area.width / viewport.width, area.height / viewport.height);
  const width = Math.max(1, Math.round(viewport.width * scale));
  const height = Math.max(1, Math.round(viewport.height * scale));
  return {
    bounds: {
      x: area.x + Math.floor((area.width - width) / 2),
      y: area.y + Math.floor((area.height - height) / 2),
      width,
      height,
    },
    scale,
  };
}

function mobileUserAgent(chromeVersion) {
  return `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Mobile Safari/537.36`;
}

function describe(viewport, scale) {
  if (isFit(viewport)) return 'fit';
  const pct = scale < 0.995 ? ` · ${Math.round(scale * 100)}%` : '';
  return `${viewport.width}×${viewport.height}${viewport.mobile ? ' mobile' : ''}${pct}`;
}

module.exports = { PRESETS, CYCLE, isFit, normalizeViewport, layoutFor, mobileUserAgent, describe };
