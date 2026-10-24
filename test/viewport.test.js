'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PRESETS, CYCLE, isFit, normalizeViewport, layoutFor, mobileUserAgent, describe } = require('../lib/viewport');

test('fit and nothing both mean "no emulation"', () => {
  assert.equal(normalizeViewport(undefined), null);
  assert.equal(normalizeViewport(null), null);
  assert.equal(normalizeViewport('fit'), null);
  assert.equal(normalizeViewport('FIT'), null);
  assert.ok(isFit(null));
  assert.ok(isFit(PRESETS.fit));
  assert.ok(!isFit(PRESETS.phone));
});

test('presets are returned as copies, case-insensitively', () => {
  const v = normalizeViewport('Phone');
  assert.deepEqual(v, PRESETS.phone);
  assert.notEqual(v, PRESETS.phone);
  for (const name of CYCLE) assert.ok(name in PRESETS, `${name} is a preset`);
});

test('a custom size infers mobile from its width unless told otherwise', () => {
  assert.deepEqual(normalizeViewport({ width: 600, height: 900 }), { name: 'custom', label: 'Custom', width: 600, height: 900, mobile: true, dpr: 2 });
  assert.deepEqual(normalizeViewport({ width: 1600, height: 900 }), { name: 'custom', label: 'Custom', width: 1600, height: 900, mobile: false, dpr: 0 });
  assert.equal(normalizeViewport({ width: 600, height: 900, mobile: false, dpr: 1 }).mobile, false);
  assert.equal(normalizeViewport({ width: '800', height: '600' }).width, 800);
});

test('nonsense sizes are rejected with the field name', () => {
  for (const bad of [{ width: 50, height: 500 }, { width: 500 }, { width: 9000, height: 500 }, { width: 100.5, height: 500 }, 42]) {
    assert.throws(() => normalizeViewport(bad, 'item 3: pane.viewport'), /item 3: pane.viewport/);
  }
});

test('layoutFor fills the area for fit and scales a large viewport down, centred', () => {
  const area = { x: 10, y: 20, width: 700, height: 500 };
  assert.deepEqual(layoutFor(null, area), { bounds: area, scale: 1 });

  const phone = layoutFor(PRESETS.phone, area);
  assert.ok(phone.scale < 1, 'a phone is taller than the area, so it shrinks');
  assert.equal(phone.bounds.height, 500);
  assert.equal(phone.bounds.width, Math.round(390 * phone.scale));
  assert.equal(phone.bounds.x, 10 + Math.floor((700 - phone.bounds.width) / 2));

  const laptop = layoutFor(PRESETS.laptop, { x: 0, y: 0, width: 1400, height: 900 });
  assert.equal(laptop.scale, 1, 'a viewport that fits is not scaled');
  assert.deepEqual(laptop.bounds, { x: 60, y: 50, width: 1280, height: 800 });

  const desktop = layoutFor(PRESETS.desktop, area);
  assert.ok(desktop.bounds.width <= area.width && desktop.bounds.height <= area.height);
  assert.ok(desktop.bounds.x >= area.x && desktop.bounds.y >= area.y);
});

test('describe and the mobile user agent read as expected', () => {
  assert.equal(describe(null, 1), 'fit');
  assert.equal(describe(PRESETS.desktop, 1), '1440×900');
  assert.equal(describe(PRESETS.phone, 0.5), '390×844 mobile · 50%');
  assert.match(mobileUserAgent('140.0.0.0'), /Android.*Chrome\/140\.0\.0\.0 Mobile Safari/);
});
