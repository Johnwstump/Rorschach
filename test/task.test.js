'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadTask } = require('../lib/task');
const { tempDir, writeTask } = require('./helpers');

const SAMPLE = path.join(__dirname, '..', 'samples', 'sample-task.json');

test('the bundled sample loads and its items are filled in', () => {
  const task = loadTask(SAMPLE);
  assert.equal(task.title, 'Sample review');
  assert.equal(task.file, path.resolve(SAMPLE));
  assert.equal(task.items.length, 4);

  const [example, wiki, compare, image] = task.items;
  assert.equal(example.id, 'example-domain');
  assert.deepEqual(example.pane.viewport, { name: 'phone', label: 'Phone', width: 390, height: 844, mobile: true, dpr: 3 });
  assert.deepEqual(example.options.map((o) => [o.label, o.value, o.key]), [
    ['Looks right', 'ok', '1'], ["Something's off", 'problem', '2'], ["Can't tell", 'unsure', '3'],
  ]);
  assert.equal(example.note, true);

  // Item options without keys get free keys; pane.viewport falls back to fit (null).
  assert.deepEqual(wiki.options.map((o) => o.key), ['1', '2']);
  assert.equal(wiki.pane.viewport, null);

  assert.equal(compare.pane.kind, 'compare');
  assert.equal(compare.pane.mode, 'grid');
  assert.deepEqual(compare.pane.sources.map((s) => s.kind), ['url', 'url']);
  assert.deepEqual(compare.options.map((o) => [o.label, o.value, o.key]), [
    ['A · Desktop site', 'A', '1'], ['B · Mobile site', 'B', '2'], ['No preference', 'none', '0'],
  ]);

  assert.equal(image.pane.kind, 'image');
  assert.equal(image.note, false);
});

test('defaults are applied and string options get auto keys', (t) => {
  const dir = tempDir(t);
  const file = writeTask(dir, 'task.json', {
    defaults: { options: ['Real error', 'Not a problem', 'Needs vendor check'], note: false, viewport: 'tablet', mode: 'wipe' },
    items: [
      { pane: { kind: 'url', src: 'https://example.com/' } },
      { id: 'two', header: 'Second', pane: { kind: 'compare', sources: ['https://a.example/', 'shots/b.PNG'] } },
    ],
  });
  const task = loadTask(file);
  assert.equal(task.title, 'task');
  const [one, two] = task.items;
  assert.equal(one.id, 'item-1');
  assert.equal(one.header, 'https://example.com/');
  assert.equal(one.note, false);
  assert.equal(one.pane.viewport.name, 'tablet');
  assert.deepEqual(one.options.map((o) => [o.label, o.value, o.key]), [
    ['Real error', 'Real error', '1'], ['Not a problem', 'Not a problem', '2'], ['Needs vendor check', 'Needs vendor check', '3'],
  ]);
  assert.equal(two.pane.mode, 'wipe');
  assert.deepEqual(two.pane.sources, [
    { kind: 'url', src: 'https://a.example/', label: 'A' },
    { kind: 'image', src: 'shots/b.PNG', label: 'B' },
  ]);
});

test('more than nine string options still get distinct keys, none of them panel keys', (t) => {
  const dir = tempDir(t);
  const labels = Array.from({ length: 14 }, (_, i) => `Option ${i + 1}`);
  const file = writeTask(dir, 'task.json', { items: [{ pane: { kind: 'url', src: 'x' }, options: labels }] });
  const keys = loadTask(file).items[0].options.map((o) => o.key);
  assert.equal(new Set(keys).size, 14);
  for (const k of keys) assert.ok(!'cfghnorsvw'.includes(k), `key ${k} belongs to the panel`);
});

test('an explicit key is lowercased and an explicit value is kept', (t) => {
  const dir = tempDir(t);
  const file = writeTask(dir, 'task.json', { items: [{ pane: { kind: 'url', src: 'x' }, options: [{ label: 'Yes', value: 1, key: 'Y' }] }] });
  assert.deepEqual(loadTask(file).items[0].options, [{ label: 'Yes', value: 1, key: 'y' }]);
});

test('a compare item with no header is named after its sources', (t) => {
  const dir = tempDir(t);
  const file = writeTask(dir, 'task.json', { items: [{ pane: { kind: 'compare', sources: [{ label: 'Old', src: 'a' }, { label: 'New', src: 'b' }] } }] });
  assert.equal(loadTask(file).items[0].header, 'Old vs New');
});

const BAD = [
  ['unreadable JSON', '{not json', /JSON/],
  ['no items', { items: [] }, /non-empty "items"/],
  ['unknown pane kind', { items: [{ pane: { kind: 'video', src: 'x' } }] }, /pane.kind must be/],
  ['missing src', { items: [{ pane: { kind: 'url' } }] }, /pane.src is required/],
  ['duplicate ids', { items: [{ id: 'a', pane: { kind: 'url', src: 'x' } }, { id: 'a', pane: { kind: 'url', src: 'y' } }] }, /duplicate id "a"/],
  ['one compare source', { items: [{ pane: { kind: 'compare', sources: ['x'] } }] }, /at least 2 sources/],
  ['seven compare sources', { items: [{ pane: { kind: 'compare', sources: ['1', '2', '3', '4', '5', '6', '7'] } }] }, /at most 6 sources/],
  ['bad compare mode', { items: [{ pane: { kind: 'compare', mode: 'flip', sources: ['x', 'y'] } }] }, /pane.mode must be/],
  ['bad source kind', { items: [{ pane: { kind: 'compare', sources: [{ kind: 'pdf', src: 'x' }, 'y'] } }] }, /source 1 kind must be/],
  ['empty options', { items: [{ pane: { kind: 'url', src: 'x' }, options: [] }] }, /"options" must be a non-empty array/],
  ['option without label', { items: [{ pane: { kind: 'url', src: 'x' }, options: [{ value: 1 }] }] }, /option 1 has no label/],
  ['unknown viewport preset', { items: [{ pane: { kind: 'url', src: 'x', viewport: 'watch' } }] }, /unknown viewport preset "watch"/],
];

for (const [name, body, pattern] of BAD) {
  test(`rejects a task with ${name}`, (t) => {
    const file = writeTask(tempDir(t), 'bad.json', body);
    assert.throws(() => loadTask(file), pattern);
  });
}

test('a missing task file names the path in the error', () => {
  const missing = path.resolve('no-such-dir', 'task.json');
  assert.throws(() => loadTask(missing), (e) => e.message.includes(missing));
});
