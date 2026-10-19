const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createSceneDeletionController } = require('../src/scenes/sceneDeletionController');

function createHarness({ responses = [], deleteFile, details: detailsOverride } = {}) {
  const root = path.resolve('engine', 'Demo');
  const sceneDirectory = path.join(root, 'develop', 'levels', 'demo');
  const scenePath = path.join(sceneDirectory, 'demo.level.blk');
  const exportPath = path.join(root, 'game', 'content', 'outer_space', 'levels', 'demo.blk');
  const project = {
    applicationFile: path.join(root, 'application.blk'),
    label: 'Demo',
    root,
    scenes: [{ uri: { fsPath: scenePath }, label: 'demo' }]
  };
  const details = {
    canDelete: true,
    references: [],
    sceneDirectory,
    exportTargets: [exportPath],
    targets: [sceneDirectory, exportPath],
    ...detailsOverride
  };
  const state = {
    prompts: [],
    errors: [],
    output: [],
    deleteRequests: [],
    refreshes: 0,
    inspected: []
  };
  const vscodeApi = {
    l10n: {
      t(message, args = {}) {
        return message.replace(/\{([\w]+)\}/g, (match, key) => args[key] ?? match);
      }
    },
    Uri: { file: fsPath => ({ fsPath }) },
    window: {
      async showWarningMessage(message, options, ...items) {
        state.prompts.push({ message, options, items });
        return responses.shift();
      },
      showErrorMessage(message) { state.errors.push(message); }
    },
    workspace: {
      fs: {
        async delete(uri, options) {
          state.deleteRequests.push({ uri, options });
          await deleteFile?.(uri.fsPath, options);
        }
      }
    }
  };
  const catalog = {
    projects: [project],
    async refresh() { state.refreshes += 1; }
  };
  const sceneActions = {
    async inspectDeletion(actualProject, actualScenePath) {
      state.inspected.push({ project: actualProject, scenePath: actualScenePath });
      return details;
    }
  };
  const outputChannel = {
    appendLine(line) { state.output.push(line); },
    show() { state.outputVisible = true; }
  };
  return {
    controller: createSceneDeletionController({ vscodeApi, catalog, sceneActions, outputChannel }),
    project,
    scenePath,
    sceneDirectory,
    exportPath,
    state
  };
}

test('scene deletion ignores projects and scenes absent from the current catalog', async () => {
  const harness = createHarness();
  await harness.controller.deleteScene('/engine/other/application.blk', harness.scenePath);
  await harness.controller.deleteScene(harness.project.applicationFile, path.join(harness.project.root, 'missing.level.blk'));

  assert.deepEqual(harness.state.inspected, []);
  assert.deepEqual(harness.state.prompts, []);
  assert.deepEqual(harness.state.deleteRequests, []);
});

test('scene deletion leaves files untouched when confirmation is cancelled', async () => {
  const harness = createHarness({ responses: ['Cancel'] });
  await harness.controller.deleteScene(harness.project.applicationFile, harness.scenePath);

  assert.equal(harness.state.inspected.length, 1);
  assert.equal(harness.state.prompts.length, 1);
  assert.deepEqual(harness.state.deleteRequests, []);
  assert.equal(harness.state.refreshes, 0);
});

test('scene deletion leaves trash failures in place when permanent fallback is cancelled', async () => {
  const harness = createHarness({
    responses: ['Delete Scene', 'Cancel'],
    async deleteFile(_fsPath, options) {
      if (options?.useTrash) throw new Error('Recycle bin unavailable');
    }
  });
  await harness.controller.deleteScene(harness.project.applicationFile, harness.scenePath);

  assert.deepEqual(harness.state.deleteRequests.map(request => request.options), [
    { recursive: true, useTrash: true },
    { recursive: true, useTrash: true }
  ]);
  assert.equal(harness.state.refreshes, 0);
  assert.ok(harness.state.output.some(line => line.includes('Permanent deletion was cancelled')));
  assert.ok(harness.state.prompts.at(-1).message.includes('only partially deleted'));
});

test('scene deletion asks before permanent fallback and reports remaining paths', async () => {
  const harness = createHarness({
    responses: ['Delete Scene', 'Permanently Delete'],
    async deleteFile(fsPath, options) {
      if (options?.useTrash || fsPath === path.resolve('engine', 'Demo', 'game', 'content', 'outer_space', 'levels', 'demo.blk')) {
        throw new Error('Recycle bin unavailable');
      }
    }
  });
  await harness.controller.deleteScene(harness.project.applicationFile, harness.scenePath);

  assert.deepEqual(harness.state.deleteRequests.map(request => request.options), [
    { recursive: true, useTrash: true },
    { recursive: true, useTrash: true },
    { recursive: true },
    { recursive: true }
  ]);
  assert.equal(harness.state.refreshes, 1);
  assert.ok(harness.state.output.some(line => line.includes('Scene deletion partially completed')));
  assert.ok(harness.state.prompts.at(-1).message.includes('only partially deleted'));
});
