'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Results } = require('../lib/results');
const { tempDir } = require('./helpers');

const task = { file: '/reviews/spec.json', title: 'Spec audit', items: [{ id: 'a' }, { id: 'b' }] };
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('a new results file starts empty and is written on the first answer', (t) => {
  const file = path.join(tempDir(t), 'nested', 'spec.results.json');
  const r = Results.open(file, task);
  assert.equal(r.data.done, false);
  assert.equal(r.data.total, 2);
  assert.equal(r.data.title, 'Spec audit');
  assert.ok(!fs.existsSync(file), 'nothing is written until there is something to save');

  r.answer('a', { value: 'error', label: 'Real error', note: '', index: 0 });
  const saved = read(file);
  assert.equal(saved.answers.a.value, 'error');
  assert.match(saved.answers.a.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(saved.updatedAt);
  assert.equal(saved.done, false);
  assert.ok(!fs.existsSync(`${file}.tmp`), 'the temp file is renamed away');
});

test('finish marks the review done, and a later answer or clear reopens it', (t) => {
  const file = path.join(tempDir(t), 'spec.results.json');
  const r = Results.open(file, task);
  r.answer('a', { value: 1 });
  r.answer('b', { value: 2 });
  r.finish();
  assert.equal(read(file).done, true);
  assert.ok(read(file).finishedAt);

  r.clear('b');
  assert.equal(read(file).done, false);
  assert.equal(read(file).finishedAt, null);
  assert.deepEqual(Object.keys(read(file).answers), ['a']);

  r.answer('b', { value: 3 });
  r.finish();
  r.answer('a', { value: 4 });
  assert.equal(read(file).done, false);
});

test('reopening an existing file keeps its answers and refreshes the total', (t) => {
  const file = path.join(tempDir(t), 'spec.results.json');
  Results.open(file, task).answer('a', { value: 'yes' });

  const again = Results.open(file, { ...task, items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
  assert.equal(again.data.answers.a.value, 'yes');
  assert.equal(again.data.total, 3);
  assert.equal(again.data.startedAt, read(file).startedAt);
});
