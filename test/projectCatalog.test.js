const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const test = require('node:test');

class FakeVscodeEventEmitter extends EventEmitter {
  fire(value) { this.emit('change', value); }
  event(listener) {
    this.on('change', listener);
    return { dispose: () => this.off('change', listener) };
  }
}
const vscode = { EventEmitter: FakeVscodeEventEmitter };
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return originalLoad.call(this, request, parent, isMain);
};
const { ProjectCatalog } = require('../src/projects/projectCatalog');
Module._load = originalLoad;

test('keeps discovered projects visible until a refresh finishes', async () => {
  const catalog = new ProjectCatalog();
  const existingProject = { applicationFile: 'engine/Demo/application.blk', scenes: [{ label: 'first' }, { label: 'second' }] };
  const refreshedProject = { ...existingProject, scenes: [{ label: 'second' }] };
  catalog.projects = [existingProject];

  let completeDiscovery;
  catalog.discoverProjects = () => new Promise(resolve => { completeDiscovery = resolve; });
  const refreshPromise = catalog.refresh();
  await Promise.resolve();

  assert.deepEqual(catalog.projects, [existingProject]);

  completeDiscovery([refreshedProject]);
  await refreshPromise;

  assert.deepEqual(catalog.projects, [refreshedProject]);
});
