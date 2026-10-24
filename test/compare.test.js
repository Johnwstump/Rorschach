'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MAX_SOURCES, LETTERS, MODES, GAP, gridLayout, optionsFromSources } = require('../lib/compare');

const wide = { x: 0, y: 0, width: 1200, height: 800 };

function checkCells({ cells }, n, area) {
  assert.equal(cells.length, n);
  for (const c of cells) {
    assert.ok(c.x >= area.x && c.y >= area.y, 'cell starts inside the area');
    assert.ok(c.x + c.width <= area.x + area.width + 1 && c.y + c.height <= area.y + area.height + 1, 'cell ends inside the area');
  }
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i];
      const b = cells[j];
      const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
      assert.ok(apart, `cells ${i} and ${j} overlap`);
    }
  }
}

test('the grid picks the column count that gives the largest cells', () => {
  assert.equal(gridLayout(2, wide).cols, 2);
  assert.deepEqual([gridLayout(4, wide).cols, gridLayout(4, wide).rows], [2, 2]);
  assert.equal(gridLayout(6, wide).cols, 3);
  // Phone-shaped targets go side by side: six of them fit in one row of a wide area.
  assert.equal(gridLayout(6, wide, { width: 390, height: 844 }).cols, 6);
  // In a tall area two desktop pages stack.
  assert.equal(gridLayout(2, { x: 0, y: 0, width: 600, height: 1400 }, { width: 1440, height: 900 }).cols, 1);
});

test('cells sit inside the area, do not overlap, and leave the gap between them', () => {
  for (let n = 1; n <= MAX_SOURCES; n++) checkCells(gridLayout(n, wide), n, wide);
  const two = gridLayout(2, wide).cells;
  assert.equal(two[1].x - (two[0].x + two[0].width), GAP);
  const area = { x: 300, y: 40, width: 900, height: 600 };
  const offset = gridLayout(3, area);
  checkCells(offset, 3, area);
  assert.equal(offset.cells[0].x, 300);
});

test('a tiny area still yields usable cells', () => {
  const r = gridLayout(4, { x: 0, y: 0, width: 5, height: 5 });
  assert.equal(r.cells.length, 4);
  for (const c of r.cells) assert.ok(c.width >= 1 && c.height >= 1);
});

test('default compare options are one per source plus "No preference"', () => {
  const opts = optionsFromSources([{ label: 'Old' }, { label: 'New' }, { label: 'Wild' }]);
  assert.deepEqual(opts, [
    { label: 'A · Old', value: 'A', key: '1' },
    { label: 'B · New', value: 'B', key: '2' },
    { label: 'C · Wild', value: 'C', key: '3' },
    { label: 'No preference', value: 'none', key: '0' },
  ]);
  assert.equal(LETTERS.length, MAX_SOURCES);
  assert.deepEqual(MODES, ['grid', 'fade', 'wipe']);
});
