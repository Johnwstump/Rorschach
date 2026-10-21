'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Results are written after every answer so a half-finished review survives a crash,
// and `done` flips to true once every item has an answer, which gives a watcher
// something simple to look for.
class Results {
  static open(file, task) {
    const r = new Results(file);
    r.load(task);
    return r;
  }

  constructor(file) {
    this.file = path.resolve(file);
    this.data = null;
  }

  load(task) {
    if (fs.existsSync(this.file)) {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data.answers = this.data.answers || {};
      this.data.total = task.items.length;
    } else {
      this.data = {
        task: task.file,
        title: task.title,
        total: task.items.length,
        startedAt: new Date().toISOString(),
        updatedAt: null,
        finishedAt: null,
        done: false,
        answers: {},
      };
    }
  }

  answer(id, a) {
    this.data.answers[id] = { ...a, at: new Date().toISOString() };
    this.data.done = false;
    this.data.finishedAt = null;
    this.save();
  }

  clear(id) {
    delete this.data.answers[id];
    this.data.done = false;
    this.data.finishedAt = null;
    this.save();
  }

  finish() {
    this.data.done = true;
    this.data.finishedAt = new Date().toISOString();
    this.save();
  }

  save() {
    this.data.updatedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Results };
