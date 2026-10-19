const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { isPathWithin } = require('../src/utils/pathUtils');

test('path containment accepts the directory and descendants', () => {
  const directory = path.resolve('engine', 'project');
  assert.equal(isPathWithin(directory, directory), true);
  assert.equal(isPathWithin(directory, path.join(directory, 'develop', 'levels', 'demo')), true);
});

test('path containment rejects sibling prefixes, parent traversal, and outside absolute paths', () => {
  const directory = path.resolve('engine', 'project');
  assert.equal(isPathWithin(directory, path.resolve('engine', 'project-assets')), false);
  assert.equal(isPathWithin(directory, path.resolve(directory, '..', 'other')), false);
  assert.equal(isPathWithin(directory, path.resolve('outside', 'level.blk')), false);
});
