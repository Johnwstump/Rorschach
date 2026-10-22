'use strict';

// Layout and option helpers for compare items: several sources shown together.

const MAX_SOURCES = 6;
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const MODES = ['grid', 'fade', 'wipe'];
const GAP = 6;

// Chooses the column count that gives the largest cells, judged against the shape
// the cells should ideally have (the emulated viewport, or the area itself), and
// returns one rectangle per source.
function gridLayout(n, area, target, gap = GAP) {
  const want = target && target.width && target.height
    ? target.width / target.height
    : (area.height ? area.width / area.height : 1.5);
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = (area.width - gap * (cols - 1)) / cols;
    const cellH = (area.height - gap * (rows - 1)) / rows;
    if (cellW <= 0 || cellH <= 0) continue;
    // The size a `want`-shaped box would reach inside this cell.
    const fit = Math.min(cellW, cellH * want);
    if (!best || fit > best.fit) best = { cols, rows, cellW, cellH, fit };
  }
  if (!best) best = { cols: n, rows: 1, cellW: Math.max(1, area.width / n), cellH: Math.max(1, area.height) };
  const cells = [];
  for (let i = 0; i < n; i++) {
    const c = i % best.cols;
    const r = Math.floor(i / best.cols);
    cells.push({
      x: Math.round(area.x + c * (best.cellW + gap)),
      y: Math.round(area.y + r * (best.cellH + gap)),
      width: Math.max(1, Math.floor(best.cellW)),
      height: Math.max(1, Math.floor(best.cellH)),
    });
  }
  return { cols: best.cols, rows: best.rows, cells };
}

// The answer buttons a compare item gets when the task file does not spell them out:
// one per source, then "No preference".
function optionsFromSources(sources) {
  const opts = sources.map((s, i) => ({ label: `${LETTERS[i]} · ${s.label}`, value: LETTERS[i], key: String(i + 1) }));
  opts.push({ label: 'No preference', value: 'none', key: '0' });
  return opts;
}

module.exports = { MAX_SOURCES, LETTERS, MODES, GAP, gridLayout, optionsFromSources };
