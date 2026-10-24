'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A fresh temp directory per test; tasks and results are written into it.
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rorschach-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeTask(dir, name, task) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof task === 'string' ? task : JSON.stringify(task));
  return file;
}

module.exports = { tempDir, writeTask };
