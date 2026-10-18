const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Module = require('node:module');
const childProcess = require('node:child_process');
const test = require('node:test');
const { afterEach } = test;
const extensionManifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));

const commands = new Map();
const executedCommands = [];
const errors = [];
const messages = [];
const launches = [];
const providers = new Map();
const contextKeys = new Map();
const deleteRequests = [];
const roots = [];
const watcherPatterns = [];
const quickPicks = [];
let workspaceRoot;
let toolsDirectory;
let sceneFiles = [];
let applicationFiles = [];
let outputChannel;
let fakeChild;
let webviewView;
let fakeTerminal;
let quickPickSelection;
let inputBoxValue = 'NewDemo';
let modalChoice;
let warningPrompts = [];
const warningResponses = [];
let deleteTrashError;
const terminals = [];
const openedDocuments = [];
const shownDocuments = [];

class FakeEventEmitter {
  listeners = [];
  event = listener => {
    this.listeners.push(listener);
    return { dispose() {} };
  };
  fire(value) { this.listeners.forEach(listener => listener(value)); }
  dispose() {}
}

class FakeOutputChannel {
  lines = [];
  visible = false;
  appendLine(line) { this.lines.push(line); }
  append(text) { this.lines.push(text); }
  show() { this.visible = true; }
}

const vscode = {
  EventEmitter: FakeEventEmitter,
  Uri: { file: fsPath => ({
    scheme: 'file',
    fsPath,
    toString: () => pathToFileURL(fsPath).toString()
  }) },
  RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
  commands: {
    executeCommand(command, key, value) {
      executedCommands.push({ command, key, value });
      if (command === 'setContext') contextKeys.set(key, value);
      const registeredCommand = commands.get(command);
      if (registeredCommand) return Promise.resolve(registeredCommand(key, value));
      return Promise.resolve();
    },
    registerCommand(name, callback) {
      commands.set(name, callback);
      return { dispose() {} };
    }
  },
  workspace: {
    workspaceFolders: roots,
    fs: {
      async delete(uri, options) {
        deleteRequests.push({ uri, options });
        if (options.useTrash && deleteTrashError) {
          const error = deleteTrashError;
          deleteTrashError = undefined;
          throw error;
        }
        if (path.extname(uri.fsPath).toLowerCase() === '.cmd') {
          fs.rmSync(uri.fsPath, { force: true });
        }
        applicationFiles = applicationFiles.filter(file => !file.startsWith(`${uri.fsPath}${path.sep}`));
        sceneFiles = sceneFiles.filter(file => !file.startsWith(`${uri.fsPath}${path.sep}`));
      }
    },
    getWorkspaceFolder() { return { uri: { fsPath: workspaceRoot } }; },
    getConfiguration() {
      return { get: key => ({
        toolsDirectory,
        daEditorExecutable: 'daEditor3x-dev.exe',
        daViewerExecutable: 'assetViewer2-dev.exe',
        blkEditorExecutable: 'blkEditor-dev.exe',
        pythonExecutable: 'python'
      })[key] };
    },
    async findFiles(pattern) {
      const files = pattern instanceof vscode.RelativePattern
        ? pattern.pattern === '**/application.blk' ? applicationFiles : sceneFiles
        : sceneFiles;
      return files
        .filter(file => !pattern.base || path.resolve(file).startsWith(`${path.resolve(pattern.base)}${path.sep}`))
        .map(fsPath => ({ scheme: 'file', fsPath }));
    },
    async openTextDocument(fileUri) {
      const document = { uri: fileUri };
      openedDocuments.push(document);
      return document;
    },
    createFileSystemWatcher(pattern) {
      watcherPatterns.push(pattern);
      return {
        onDidCreate: () => ({ dispose() {} }),
        onDidDelete: () => ({ dispose() {} }),
        onDidChange: () => ({ dispose() {} }),
        dispose() {}
      };
    },
    onDidChangeWorkspaceFolders() { return { dispose() {} }; }
  },
  window: {
    showErrorMessage(message) { errors.push(message); },
    showInformationMessage(message) { messages.push(message); },
    async showTextDocument(document) { shownDocuments.push(document); },
    showWarningMessage(message, options, ...items) {
      warningPrompts.push({ message, options, items });
      return Promise.resolve(warningResponses.shift() ?? modalChoice);
    },
    showQuickPick(items, options) {
      quickPicks.push({ items, options });
      return Promise.resolve(items.find(item => item.label === quickPickSelection) || items[0]);
    },
    showInputBox() { return Promise.resolve(inputBoxValue); },
    createOutputChannel() {
      outputChannel = new FakeOutputChannel();
      return outputChannel;
    },
    createTerminal(options) {
      fakeTerminal = {
        options,
        shown: false,
        sent: [],
        show(preserveFocus) { this.shown = true; this.preserveFocus = preserveFocus; },
        sendText(text, addNewLine) { this.sent.push({ text, addNewLine }); }
      };
      terminals.push(fakeTerminal);
      return fakeTerminal;
    },
    registerWebviewViewProvider(viewId, provider) {
      providers.set(viewId, provider);
      webviewView = {
        webview: {
          options: {},
          html: '',
          listeners: [],
          onDidReceiveMessage(listener) { this.listeners.push(listener); return { dispose() {} }; },
          postMessage(message) {
            this.postedMessage = message;
            this.listeners.forEach(listener => listener({ data: message }));
            return Promise.resolve(true);
          },
          async send(message) {
            await Promise.all(this.listeners.map(listener => listener(message)));
          }
        }
      };
      provider.resolveWebviewView(webviewView);
      return { dispose() {} };
    }
  }
};

const originalLoad = Module._load;
const originalSpawn = childProcess.spawn;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return originalLoad.call(this, request, parent, isMain);
};
childProcess.spawn = (executable, args, options) => {
  launches.push({ executable, args, options });
  if (executable === 'taskkill') {
    const stopper = new EventEmitter();
    stopper.unref = () => {};
    fakeChild.stopRequest = { args, options, process: stopper };
    return stopper;
  }
  const child = new EventEmitter();
  child.pid = 12345;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.unref = () => {};
  child.kill = () => { child.killed = true; };
  fakeChild = child;
  return child;
};
const extension = require('../extension');
Module._load = originalLoad;
childProcess.spawn = originalSpawn;

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dagor-blk-extension-'));
workspaceRoot = path.join(tempDirectory, 'project_stalker');
roots.push({ uri: { fsPath: workspaceRoot } });
toolsDirectory = path.join(tempDirectory, 'tools');
const levelsDirectory = path.join(workspaceRoot, 'develop', 'levels');
const progDirectory = path.join(workspaceRoot, 'prog');
const outerSpaceRoot = path.join(workspaceRoot, 'outerSpace');
const outerSpaceLevels = path.join(outerSpaceRoot, 'develop', 'levels');
const outerSpaceProg = path.join(outerSpaceRoot, 'prog');
const gameDirectory = path.join(workspaceRoot, 'game');
const gameSubdirectory = path.join(gameDirectory, 'windows-x86_64');
const deeplyNestedGameDirectory = path.join(gameSubdirectory, 'nested');
fs.mkdirSync(levelsDirectory, { recursive: true });
fs.mkdirSync(progDirectory, { recursive: true });
fs.mkdirSync(outerSpaceLevels, { recursive: true });
fs.mkdirSync(outerSpaceProg, { recursive: true });
fs.mkdirSync(gameDirectory, { recursive: true });
fs.mkdirSync(deeplyNestedGameDirectory, { recursive: true });
fs.mkdirSync(toolsDirectory, { recursive: true });
for (const executable of ['daEditor3x-dev.exe', 'assetViewer2-dev.exe', 'blkEditor-dev.exe']) {
  fs.writeFileSync(path.join(toolsDirectory, executable), '');
}
const applicationFile = path.join(workspaceRoot, 'application.blk');
const outerSpaceApplication = path.join(outerSpaceRoot, 'application.blk');
fs.writeFileSync(applicationFile, '');
fs.writeFileSync(outerSpaceApplication, '');
fs.writeFileSync(path.join(progDirectory, 'build.py'), '');
fs.writeFileSync(path.join(outerSpaceProg, 'build.py'), '');
const levelFile = path.join(levelsDirectory, 'sample.level.blk');
const gameExe = path.join(gameDirectory, 'direct-game.exe');
const subdirectoryGameExe = path.join(gameSubdirectory, 'stalker.exe');
const scriptedGameExe = path.join(gameSubdirectory, 'project_stalker-dev.exe');
const deeplyNestedGameExe = path.join(deeplyNestedGameDirectory, 'ignored.exe');
const directRunCommand = path.join(gameDirectory, 'direct-run-stalker.cmd');
const nestedRunCommand = path.join(gameSubdirectory, 'run-custom.cmd');
fs.writeFileSync(gameExe, '');
fs.writeFileSync(subdirectoryGameExe, '');
fs.writeFileSync(scriptedGameExe, '');
fs.writeFileSync(deeplyNestedGameExe, '');
fs.writeFileSync(directRunCommand, '@start windows-x86_64\\stalker.exe -config:scene:t=gamedata/scenes/test.blk %1 %2');
fs.writeFileSync(nestedRunCommand, '@echo off');
const secondLevelFile = path.join(levelsDirectory, 'another.level.blk');
const outerSpaceLevelFile = path.join(outerSpaceLevels, 'sample.level.blk');
const folderFile = path.join(levelsDirectory, '.folder.blk');
fs.writeFileSync(levelFile, '');
fs.writeFileSync(secondLevelFile, '');
fs.writeFileSync(outerSpaceLevelFile, '');
fs.writeFileSync(folderFile, '');
sceneFiles = [levelFile, secondLevelFile, outerSpaceLevelFile];
applicationFiles = [applicationFile, outerSpaceApplication];

const context = { subscriptions: [], extensionPath: path.resolve(__dirname, '..') };
extension.activate(context);

afterEach(() => {
  errors.length = 0;
  messages.length = 0;
  launches.length = 0;
  outputChannel = undefined;
  fakeChild = undefined;
  fakeTerminal = undefined;
  terminals.length = 0;
  quickPicks.length = 0;
  deleteRequests.length = 0;
  warningPrompts = [];
  modalChoice = undefined;
  warningResponses.length = 0;
  deleteTrashError = undefined;
  executedCommands.length = 0;
  quickPickSelection = undefined;
  inputBoxValue = 'NewDemo';
  openedDocuments.length = 0;
  shownDocuments.length = 0;
});

test.after(() => fs.rmSync(tempDirectory, { recursive: true, force: true }));

test('uses the Dagor Project Manager name and application icons in its metadata', () => {
  assert.equal(extensionManifest.name, 'dagor-project-manager');
  assert.equal(extensionManifest.displayName, 'Dagor Project Manager');
  assert.ok(extensionManifest.activationEvents.includes('onStartupFinished'));
  assert.equal(extensionManifest.contributes.configuration.title, 'Dagor Project Manager');
  assert.equal(extensionManifest.contributes.viewsContainers.activitybar[0].title, 'Dagor Project Manager');
  assert.equal(extensionManifest.contributes.submenus[0].label, 'Dagor Project Manager');
  assert.equal(extensionManifest.icon, 'media/dagor.png');
  assert.equal(extensionManifest.contributes.viewsContainers.activitybar[0].icon, 'media/dagor.svg');

  const iconPath = path.join(__dirname, '..', extensionManifest.icon);
  const icon = fs.readFileSync(iconPath);
  assert.equal(icon.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.equal(icon.readUInt32BE(16), 128);
  assert.equal(icon.readUInt32BE(20), 128);
});

function uri(filePath) {
  return { scheme: 'file', fsPath: filePath };
}

async function refreshCatalog() {
  await commands.get('dagorProjectManager.refreshProjects')();
}

function projectData(applicationPath, rootPath, label, scenes = []) {
  return { applicationFile: applicationPath, root: rootPath, label, scenes };
}

test('registers Explorer commands and the Dagor webview sidebar', () => {
  assert.deepEqual([...commands.keys()], [
    'dagorProjectManager.openWithBlkEditor',
    'dagorProjectManager.openWithDaEditor',
    'dagorProjectManager.openWithDaViewer',
    'dagorProjectManager.revealContextTarget',
    'dagorProjectManager.revealContextTargetInOS',
    'dagorProjectManager.copyContextTargetName',
    'dagorProjectManager.copyContextTargetFullname',
    'dagorProjectManager.deleteContextProject',
    'dagorProjectManager.deleteContextCommand',
    'dagorProjectManager.runSceneInGame',
    'dagorProjectManager.buildAllFromContext',
    'dagorProjectManager.buildCodeFromContext',
    'dagorProjectManager.buildShadersFromContext',
    'dagorProjectManager.buildAssetsFromContext',
    'dagorProjectManager.buildVromfsFromContext',
    'dagorProjectManager.buildGuiFromContext',
    'dagorProjectManager.refreshProjects',
    'dagorProjectManager.openSceneWithDaEditor',
    'dagorProjectManager.openProjectWithDaViewer',
    'dagorProjectManager.buildProject',
    'dagorProjectManager.folderBuildAll',
    'dagorProjectManager.folderOpenDaViewer',
    'dagorProjectManager.folderOpenScene',
    'dagorProjectManager.folderRunGame',
    'dagorProjectManager.folderRunCommand',
    'dagorProjectManager.folderCreateCommand',
    'dagorProjectManager.generateProject'
  ]);
  assert.ok(providers.has('dagorProjectManager.projects'));
  assert.equal(webviewView.webview.options.enableScripts, true);
  assert.ok(watcherPatterns.includes('**/build.py'));
  assert.ok(!extensionManifest.contributes.menus['view/title']?.some(item => item.command === 'dagorProjectManager.refreshProjects'));
  assert.ok(extensionManifest.contributes.menus['explorer/context'].some(item =>
    item.submenu === 'dagorProjectManager.projectFolderContext' &&
    item.when === 'resourceScheme == file && explorerResourceIsFolder && resource in dagorProjectManager.projectFolders'
  ));
  assert.deepEqual(
    extensionManifest.contributes.menus['dagorProjectManager.projectFolderContext'].map(item => item.command),
    [
      'dagorProjectManager.folderBuildAll',
      'dagorProjectManager.folderOpenDaViewer',
      'dagorProjectManager.folderOpenScene',
      'dagorProjectManager.folderRunGame',
      'dagorProjectManager.folderRunCommand',
      'dagorProjectManager.folderCreateCommand'
    ]
  );
  const deleteMenuItem = extensionManifest.contributes.menus['webview/context'].find(item =>
    item.command === 'dagorProjectManager.deleteContextProject'
  );
  assert.equal(deleteMenuItem.when, "webviewId == 'dagorProjectManager.projects' && webviewSection == 'project'");
  assert.match(deleteMenuItem.group, /^z_/);
  const deleteCommandMenuItem = extensionManifest.contributes.menus['webview/context'].find(item =>
    item.command === 'dagorProjectManager.deleteContextCommand'
  );
  assert.equal(deleteCommandMenuItem.when, "webviewId == 'dagorProjectManager.projects' && webviewSection == 'commandItem'");
  assert.match(deleteCommandMenuItem.group, /^z_/);
  const createCommandMenuItem = extensionManifest.contributes.menus['webview/context'].find(item =>
    item.command === 'dagorProjectManager.folderCreateCommand'
  );
  assert.equal(createCommandMenuItem.when, "webviewId == 'dagorProjectManager.projects' && webviewSection == 'command'");
});

test('confirms project deletion and moves its folder to the system trash', async () => {
  await refreshCatalog();
  const originalApplications = [...applicationFiles];
  const originalScenes = [...sceneFiles];
  const provider = providers.get('dagorProjectManager.projects');
  provider.setContextTarget({ kind: 'project', project: applicationFile });
  modalChoice = 'Delete Project';

  await commands.get('dagorProjectManager.deleteContextProject')();

  assert.equal(warningPrompts.length, 1);
  assert.equal(warningPrompts[0].options.modal, true);
  assert.match(warningPrompts[0].message, /project_stalker/);
  assert.deepEqual(warningPrompts[0].items, ['Delete Project', 'Cancel']);
  assert.equal(deleteRequests.length, 1);
  assert.equal(deleteRequests[0].uri.fsPath, workspaceRoot);
  assert.deepEqual(deleteRequests[0].options, { recursive: true, useTrash: true });
  assert.ok(!provider.catalog.projects.some(project => project.root === workspaceRoot));
  applicationFiles.splice(0, applicationFiles.length, ...originalApplications);
  sceneFiles.splice(0, sceneFiles.length, ...originalScenes);
  await refreshCatalog();
});

test('does not delete a project when the confirmation is cancelled', async () => {
  await refreshCatalog();
  const provider = providers.get('dagorProjectManager.projects');
  provider.setContextTarget({ kind: 'project', project: applicationFile });
  modalChoice = 'Cancel';

  await commands.get('dagorProjectManager.deleteContextProject')();

  assert.equal(warningPrompts.length, 1);
  assert.equal(deleteRequests.length, 0);
  assert.ok(provider.catalog.projects.some(project => project.root === workspaceRoot));
});

test('asks separately before permanently deleting when moving the project to trash fails', async () => {
  await refreshCatalog();
  const originalApplications = [...applicationFiles];
  const originalScenes = [...sceneFiles];
  const provider = providers.get('dagorProjectManager.projects');
  provider.setContextTarget({ kind: 'project', project: applicationFile });
  warningResponses.push('Delete Project', 'Permanently Delete');
  deleteTrashError = new Error('Failed to move to the recycle bin (Operation was aborted)');

  await commands.get('dagorProjectManager.deleteContextProject')();

  assert.equal(warningPrompts.length, 2);
  assert.equal(warningPrompts[1].options.modal, true);
  assert.match(warningPrompts[1].message, /could not be moved to the system trash/i);
  assert.match(warningPrompts[1].options.detail, /cannot be undone/i);
  assert.deepEqual(warningPrompts[1].items, ['Permanently Delete', 'Cancel']);
  assert.deepEqual(deleteRequests.map(request => request.options), [
    { recursive: true, useTrash: true },
    { recursive: true }
  ]);
  assert.ok(!provider.catalog.projects.some(project => project.root === workspaceRoot));
  applicationFiles.splice(0, applicationFiles.length, ...originalApplications);
  sceneFiles.splice(0, sceneFiles.length, ...originalScenes);
  await refreshCatalog();
});

test('leaves the project intact when permanent deletion fallback is cancelled', async () => {
  await refreshCatalog();
  const provider = providers.get('dagorProjectManager.projects');
  provider.setContextTarget({ kind: 'project', project: applicationFile });
  warningResponses.push('Delete Project', 'Cancel');
  deleteTrashError = new Error('Failed to move to the recycle bin (Operation was aborted)');

  await commands.get('dagorProjectManager.deleteContextProject')();

  assert.equal(warningPrompts.length, 2);
  assert.equal(deleteRequests.length, 1);
  assert.ok(provider.catalog.projects.some(project => project.root === workspaceRoot));
});

test('confirms deleting the selected command and moves it to the system trash', async () => {
  const commandPath = path.join(gameDirectory, 'delete-me.cmd');
  fs.writeFileSync(commandPath, '@echo off');
  await refreshCatalog();
  const provider = providers.get('dagorProjectManager.projects');
  provider.setContextTarget({ kind: 'command', project: applicationFile, path: commandPath });
  modalChoice = 'Delete Command';

  try {
    await commands.get('dagorProjectManager.deleteContextCommand')();

    assert.equal(warningPrompts.length, 1);
    assert.equal(warningPrompts[0].options.modal, true);
    assert.match(warningPrompts[0].message, /delete command "delete-me"/i);
    assert.deepEqual(warningPrompts[0].items, ['Delete Command', 'Cancel']);
    assert.equal(deleteRequests.length, 1);
    assert.equal(deleteRequests[0].uri.fsPath, commandPath);
    assert.deepEqual(deleteRequests[0].options, { recursive: true, useTrash: true });
    assert.ok(!fs.existsSync(commandPath));
    assert.ok(!provider.catalog.projects.find(project => project.applicationFile === applicationFile)
      ?.gameCommands.some(command => command.command === commandPath));
  } finally {
    fs.rmSync(commandPath, { force: true });
  }
});

test('offers permanent command deletion only after moving it to trash fails', async () => {
  const commandPath = path.join(gameDirectory, 'delete-fallback.cmd');
  fs.writeFileSync(commandPath, '@echo off');
  await refreshCatalog();
  const provider = providers.get('dagorProjectManager.projects');
  provider.setContextTarget({ kind: 'command', project: applicationFile, path: commandPath });
  warningResponses.push('Delete Command', 'Permanently Delete');
  deleteTrashError = new Error('Recycle bin unavailable');

  try {
    await commands.get('dagorProjectManager.deleteContextCommand')();

    assert.equal(warningPrompts.length, 2);
    assert.match(warningPrompts[1].message, /could not be moved to the system trash/i);
    assert.match(warningPrompts[1].options.detail, /cannot be undone/i);
    assert.deepEqual(warningPrompts[1].items, ['Permanently Delete', 'Cancel']);
    assert.deepEqual(deleteRequests.map(request => request.options), [
      { recursive: true, useTrash: true },
      { recursive: true }
    ]);
    assert.ok(!fs.existsSync(commandPath));
  } finally {
    fs.rmSync(commandPath, { force: true });
  }
});

test('places Create Project below the project list, routes it, and refreshes after creation', async () => {
  await refreshCatalog();
  const html = webviewView.webview.html;
  assert.match(html, /<div class="project-list">[\s\S]*?<\/div><div class="add-project-row"><button type="button" id="add-project" class="add-project-button"[^>]*><span class="chevron-icon add-project-spacer" aria-hidden="true"><svg class="icon"[\s\S]*?<\/svg><\/span><span class="project-icon"><svg class="icon"[\s\S]*?<circle cx="18" cy="17" r="4" fill="var\(--vscode-sideBar-background, var\(--vscode-editor-background\)\)"\/><path d="M18 15v4m-2-2h4"\/><\/svg><\/span><span class="add-project-label">Create Project<\/span><\/button><\/div>/);
  assert.match(html, /getElementById\('add-project'\)\.addEventListener\('click'/);

  fs.writeFileSync(path.join(tempDirectory, 'build_all.py'), '# engine marker');
  fs.mkdirSync(path.join(toolsDirectory, 'dagor_cdk'), { recursive: true });
  const catalog = providers.get('dagorProjectManager.projects').catalog;
  let refreshes = 0;
  const refresh = catalog.refresh.bind(catalog);
  catalog.refresh = async (...args) => { refreshes++; return refresh(...args); };
  const project = path.join(tempDirectory, inputBoxValue);
  const generatedApplication = path.join(project, 'application.blk');
  const generatedLevel = path.join(project, 'develop', 'levels', inputBoxValue, `${inputBoxValue}.level.blk`);
  applicationFiles.push(generatedApplication);
  sceneFiles.push(generatedLevel);
  try {
    await webviewView.webview.send({ type: 'addProject' });
    assert.ok(executedCommands.some(item => item.command === 'dagorProjectManager.generateProject'));
    assert.ok(fs.existsSync(path.join(project, 'application.blk')));
    assert.ok(fs.existsSync(generatedLevel));
    assert.equal(path.dirname(project), tempDirectory);
    const generatedProject = catalog.projects.find(item => item.root === project);
    assert.ok(generatedProject?.scenes.some(scene => scene.label === inputBoxValue));
    assert.deepEqual(generatedProject.games, []);
    const shaderBuild = launches.find(launch => launch.args?.[0] === path.join(project, 'prog', 'build.py'));
    assert.ok(shaderBuild, 'expected project creation to start the shader bootstrap build');
    assert.deepEqual(shaderBuild.args.slice(1), ['editor_shaders', 'assets']);
    assert.equal(shaderBuild.options.cwd, path.join(project, 'prog'));
    await webviewView.webview.send({ type: 'selectProject', project: generatedApplication });
    assert.match(webviewView.webview.html, /Build Project[\s\S]*Open Scene[\s\S]*NewDemo/);
    assert.match(webviewView.webview.html, /Run Game[\s\S]*Game executables should be located in game\//);
    assert.ok(refreshes > 0);
    assert.match(messages.at(-1), /NewDemo/);
    assert.equal(extensionManifest.contributes.commands.find(item => item.command === 'dagorProjectManager.generateProject').title,
      'Add Dagor Project');
  } finally {
    fakeChild?.emit('exit', 0);
    applicationFiles.splice(applicationFiles.indexOf(generatedApplication), 1);
    sceneFiles.splice(sceneFiles.indexOf(generatedLevel), 1);
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(path.join(tempDirectory, 'build_all.py'), { force: true });
    fs.rmSync(path.join(toolsDirectory, 'dagor_cdk'), { recursive: true, force: true });
  }
});

test('limits the folder context submenu to discovered Dagor project roots', async () => {
  await refreshCatalog();
  const projectFolders = contextKeys.get('dagorProjectManager.projectFolders');
  const projectResources = [outerSpaceRoot, workspaceRoot].map(folder => pathToFileURL(folder).toString());
  assert.deepEqual(Object.keys(projectFolders).sort(), projectResources.sort());
  assert.ok(!Object.hasOwn(projectFolders, pathToFileURL(path.join(workspaceRoot, 'develop')).toString()));
  assert.ok(!Object.hasOwn(projectFolders, pathToFileURL(path.join(tempDirectory, 'unrelated-folder')).toString()));
});

test('runs project-folder actions against the project under the Explorer selection', async () => {
  quickPickSelection = 'outerSpace';
  await commands.get('dagorProjectManager.folderOpenDaViewer')(uri(path.dirname(workspaceRoot)));
  assert.deepEqual(quickPicks[0].items.map(item => item.label), ['outerSpace', 'project_stalker']);
  assert.equal(launches.at(-1).executable, path.join(toolsDirectory, 'assetViewer2-dev.exe'));
  assert.deepEqual(launches.at(-1).args, [outerSpaceApplication]);

  quickPickSelection = 'sample';
  await commands.get('dagorProjectManager.folderOpenScene')(uri(outerSpaceRoot));
  assert.deepEqual(quickPicks.at(-1).items.map(item => item.label), ['sample']);
  assert.equal(launches.at(-1).executable, path.join(toolsDirectory, 'daEditor3x-dev.exe'));
  assert.deepEqual(launches.at(-1).args, [outerSpaceApplication, outerSpaceLevelFile]);

  quickPickSelection = 'project_stalker';
  await commands.get('dagorProjectManager.folderRunGame')(uri(workspaceRoot));
  assert.deepEqual(quickPicks.at(-1).items.map(item => item.label), ['direct-game', 'project_stalker-dev', 'stalker']);
  assert.equal(launches.at(-1).executable, gameExe);
  assert.deepEqual(launches.at(-1).args, []);
  assert.equal(launches.at(-1).options.cwd, gameDirectory);

  await commands.get('dagorProjectManager.folderRunCommand')(uri(workspaceRoot));
  assert.deepEqual(quickPicks.at(-1).items.map(item => item.label), ['direct-run-stalker']);
  assert.equal(fakeTerminal.options.cwd, gameDirectory);
  assert.deepEqual(fakeTerminal.sent, [{ text: `call "${directRunCommand}"`, addNewLine: true }]);
});

test('creates and opens a command in the project selected from the Run Command context menu', async () => {
  await refreshCatalog();
  inputBoxValue = 'outerSpace-launch';
  const provider = providers.get('dagorProjectManager.projects');
  provider.setContextTarget({ kind: 'commandGroup', project: outerSpaceApplication });

  await commands.get('dagorProjectManager.folderCreateCommand')({ webviewSection: 'command' });

  const createdCommand = path.join(outerSpaceRoot, 'game', 'outerSpace-launch.cmd');
  assert.equal(fs.readFileSync(createdCommand, 'utf8'), '');
  assert.equal(openedDocuments.at(-1).uri.fsPath, createdCommand);
  assert.equal(shownDocuments.at(-1), openedDocuments.at(-1));
  assert.ok(!fs.existsSync(path.join(workspaceRoot, 'game', 'outerSpace-launch.cmd')));
  fs.rmSync(path.join(outerSpaceRoot, 'game'), { recursive: true, force: true });
});

test('shows Create Command after the Run Command entries and creates the file for that project', async () => {
  await refreshCatalog();
  const provider = providers.get('dagorProjectManager.projects');
  const project = provider.catalog.projects.find(item => item.applicationFile === outerSpaceApplication);
  inputBoxValue = 'new-outer-command';
  await webviewView.webview.send({ type: 'selectProject', project: outerSpaceApplication });

  assert.match(webviewView.webview.html, /<div class="game-command-list">[\s\S]*?<button[^>]*data-create-command[^>]*>[^]*?Create Command[\s\S]*?<\/button><\/div>/);
  await webviewView.webview.send({ type: 'createGameCommand', project });

  const createdCommand = path.join(outerSpaceRoot, 'game', 'new-outer-command.cmd');
  assert.equal(fs.readFileSync(createdCommand, 'utf8'), '');
  assert.equal(openedDocuments.at(-1).uri.fsPath, createdCommand);
  fs.rmSync(path.join(outerSpaceRoot, 'game'), { recursive: true, force: true });
});

test('Build All runs every available build component for the selected project folder', async () => {
  await commands.get('dagorProjectManager.folderBuildAll')(uri(outerSpaceRoot));
  assert.equal(launches.at(-1).executable, 'python');
  assert.deepEqual(launches.at(-1).args, [
    path.join(outerSpaceProg, 'build.py'),
    'code',
    'shaders',
    'assets',
    'vromfs',
    'gui'
  ]);
  assert.equal(launches.at(-1).options.cwd, outerSpaceProg);
  fakeChild.emit('exit', 0, null);
});

test('opens any BLK, including .folder.blk, in blkEditor', async () => {
  await commands.get('dagorProjectManager.openWithBlkEditor')(uri(folderFile));
  assert.equal(launches.at(-1).executable, path.join(toolsDirectory, 'blkEditor-dev.exe'));
  assert.deepEqual(launches.at(-1).args, [folderFile]);
});

test('opens application.blk in daEditor and daViewer', async () => {
  await commands.get('dagorProjectManager.openWithDaEditor')(uri(applicationFile));
  assert.equal(launches.at(-1).executable, path.join(toolsDirectory, 'daEditor3x-dev.exe'));
  assert.deepEqual(launches.at(-1).args, [applicationFile]);

  await commands.get('dagorProjectManager.openWithDaViewer')(uri(applicationFile));
  assert.equal(launches.at(-1).executable, path.join(toolsDirectory, 'assetViewer2-dev.exe'));
  assert.deepEqual(launches.at(-1).args, [applicationFile]);
});

test('opens a level with its project application.blk in daEditor', async () => {
  await commands.get('dagorProjectManager.openWithDaEditor')(uri(levelFile));
  assert.equal(launches.at(-1).executable, path.join(toolsDirectory, 'daEditor3x-dev.exe'));
  assert.deepEqual(launches.at(-1).args, [applicationFile, levelFile]);
});

test('renders projects separately with only their own scenes', async () => {
  await refreshCatalog();
  assert.match(webviewView.webview.html, /project_stalker/);
  assert.match(webviewView.webview.html, /outerSpace/);
  assert.equal((webviewView.webview.html.match(/id="refresh"/g) || []).length, 1);
  assert.match(webviewView.webview.html, /\.icon-button\{[^}]*color:var\(--vscode-foreground\)[^}]*background:transparent/);
  assert.match(webviewView.webview.html, /\.game-icon,\.game-heading-icon,\.command-icon\{[^}]*color:inherit/);
  assert.match(webviewView.webview.html, /\.scene-group\{[^}]*border-top:1px solid var\(--vscode-widget-border\);border-bottom:0\}/);
  assert.match(webviewView.webview.html, /@keyframes project-chevron-expand/);
  assert.match(webviewView.webview.html, /@keyframes project-chevron-collapse/);
  assert.match(webviewView.webview.html, /\.end-chevron\{[^}]*transition:transform 220ms cubic-bezier/);

  await webviewView.webview.send({ type: 'selectProject', project: applicationFile });
  const expanded = webviewView.webview.html;
  assert.match(expanded, /class="chevron-icon expanded animate-expand"/);
  assert.match(expanded, /sample/);
  assert.match(expanded, /another/);
  assert.match(expanded, /Select components to build/);
  assert.match(expanded, /Open Scene/);
  assert.match(expanded, /\[hidden\]\{display:none!important\}/);
  assert.match(expanded, /data-action="toggleScenes"[^>]*aria-expanded="true"[^>]*>[\s\S]*?<div class="scene-list">/);
  assert.match(expanded, /data-action="toggleGames"[^>]*aria-expanded="true"[^>]*>[\s\S]*?<div class="game-list">/);
  assert.match(expanded, /data-action="toggleGameCommands"[^>]*aria-expanded="true"[^>]*>[\s\S]*?<div class="game-command-list">/);
  assert.ok(expanded.indexOf('Open Scene') < expanded.indexOf('Run Game'));
  assert.match(expanded, /Run Game/);
  assert.ok(expanded.includes(`data-game="${gameExe}"`));
  assert.ok(expanded.includes('<span>direct-game</span>'));
  assert.ok(expanded.includes(`data-game="${subdirectoryGameExe}"`));
  assert.ok(expanded.includes('<span>stalker</span>'));
  assert.ok(!expanded.includes('<span>ignored</span>'));
  assert.ok(!expanded.includes('<span>project_stalker-ded-dev</span>'));
  assert.ok(expanded.indexOf('Run Game') < expanded.indexOf('Run Command'));
  assert.ok(expanded.includes(`data-game-command="${directRunCommand}"`));
  assert.ok(!expanded.includes(`data-game-command="${nestedRunCommand}"`));
  assert.ok(!expanded.includes('deeplyNestedGameDirectory'));
  assert.ok(!expanded.includes('ignored.exe'));
  assert.doesNotMatch(expanded, /Generate Project/);
  assert.match(expanded, /class="action build-toggle"[^>]*aria-expanded="false"/);
  assert.match(expanded, /Build Project/);
  assert.match(expanded, /class="action" data-action="viewer"/);
  assert.match(expanded, /class="components(?: ")/);
  assert.doesNotMatch(expanded, /class="components visible"/);
  assert.match(expanded, /<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1\.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">/);
  assert.match(expanded, /class="project-icon"><svg class="icon"/);
  assert.match(expanded, /class="scene-icon"><svg class="icon"/);
  assert.match(expanded, /<button type="button" id="refresh" class="icon-button"[^>]*><svg class="icon"[^>]*><path d="M3 2v6h6/);
  assert.match(expanded, /class="command-icon"><svg class="icon"/);
  assert.match(expanded, /class="build-icon"><svg class="icon build-start-icon"/);
  assert.match(expanded, /class="icon build-stop-icon"/);
  assert.match(expanded, /\.build-submit\.running \.build-start-icon\{display:none\}/);
  assert.doesNotMatch(expanded, /[▶■⌘⟳❯🞃]/);
  assert.match(expanded, new RegExp(`data-project="${applicationFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*data-project-data=`));
  await webviewView.webview.send({ type: 'selectProject', project: outerSpaceApplication });
  assert.match(webviewView.webview.html, /class="chevron-icon animate-collapse"/);
  assert.match(webviewView.webview.html, /class="chevron-icon expanded animate-expand"/);
  const stalkerSection = webviewView.webview.html.split('<section class="project')[1].split('</section>')[0];
  assert.doesNotMatch(stalkerSection, /project-actions/);
  const project = projectData(applicationFile, workspaceRoot, 'project_stalker', [
    { uri: levelFile, label: 'sample' },
    { uri: secondLevelFile, label: 'another' }
  ]);
  await webviewView.webview.send({ type: 'openScene', project, scene: levelFile });
  assert.equal(launches.at(-1).executable, path.join(toolsDirectory, 'daEditor3x-dev.exe'));
  assert.deepEqual(launches.at(-1).args, [applicationFile, levelFile]);
});

test('shows a searching state while an asynchronous project refresh is pending', async () => {
  await refreshCatalog();
  const originalFindFiles = vscode.workspace.findFiles;
  let releaseApplicationSearch;
  let markSearchStarted;
  const searchStarted = new Promise(resolve => { markSearchStarted = resolve; });
  vscode.workspace.findFiles = (pattern, exclude) => new Promise(resolve => {
    releaseApplicationSearch = () => originalFindFiles(pattern, exclude).then(resolve);
    markSearchStarted();
  });

  const refreshPromise = webviewView.webview.send({ type: 'refresh' });
  try {
    await searchStarted;
    assert.match(webviewView.webview.html, /Searching for Dagor projects/);
    assert.doesNotMatch(webviewView.webview.html, /No Dagor projects found\./);
    assert.doesNotMatch(webviewView.webview.html, /data-select=/);
  } finally {
    vscode.workspace.findFiles = originalFindFiles;
    releaseApplicationSearch?.();
  }

  await refreshPromise;
  assert.match(webviewView.webview.html, /project_stalker/);
  assert.match(webviewView.webview.html, /outerSpace/);
});

test('shows the no-project message after a completed search with no matches', async () => {
  const previousApplicationFiles = applicationFiles;
  const previousSceneFiles = sceneFiles;
  applicationFiles = [];
  sceneFiles = [];

  try {
    await refreshCatalog();
    assert.match(webviewView.webview.html, /No Dagor projects found\./);
    assert.doesNotMatch(webviewView.webview.html, /Searching for Dagor projects/);
  } finally {
    applicationFiles = previousApplicationFiles;
    sceneFiles = previousSceneFiles;
    await refreshCatalog();
  }
});

test('runs selected components for the project from the webview', async () => {
  const project = projectData(outerSpaceApplication, outerSpaceRoot, 'outerSpace');
  await webviewView.webview.send({ type: 'action', action: 'build', project, components: ['assets', 'ignored'] });
  assert.equal(launches.at(-1).executable, 'python');
  assert.deepEqual(launches.at(-1).args, [path.join(outerSpaceProg, 'build.py'), 'assets']);
  assert.equal(launches.at(-1).options.cwd, outerSpaceProg);
  assert.equal(outputChannel.visible, true);
  await webviewView.webview.send({ type: 'selectProject', project: outerSpaceApplication });
  assert.match(webviewView.webview.html, /data-running="true"/);
  assert.match(webviewView.webview.html, /class="components visible"[\s\S]*?class="build-submit running"[^>]*aria-label="Stop Build"/);
  assert.match(webviewView.webview.html, /build-submit running[\s\S]*?build-icon"><svg class="icon build-start-icon"/);
  assert.match(webviewView.webview.html, /class="build-submit running"[^>]*aria-label="Stop Build"/);
  assert.doesNotMatch(webviewView.webview.html, /Stop Build[\s\S]*?Build Project/);

  fakeChild.stdout.emit('data', 'build output');
  fakeChild.emit('exit', 0, null);
  assert.ok(outputChannel.lines.includes('build output'));
  assert.ok(outputChannel.lines.some(line => line.includes('[DAGOR_PM] Disposed game executable watcher')));
  assert.ok(outputChannel.lines.some(line => line.includes('[DAGOR_PM] Created game executable watcher')));
  assert.ok(outputChannel.lines.some(line => /\[DAGOR_PM\].*exit code 0/.test(line)));
  await webviewView.webview.send({ type: 'selectProject', project: outerSpaceApplication });
  assert.match(webviewView.webview.html, /Build Project/);
  assert.doesNotMatch(webviewView.webview.html, /class="action build-toggle running"/);
});

test('rejects empty component selections and launches daViewer for the selected project', async () => {
  const project = projectData(outerSpaceApplication, outerSpaceRoot, 'outerSpace');
  await webviewView.webview.send({ type: 'action', action: 'build', project, components: [] });
  assert.equal(launches.length, 0);

  await webviewView.webview.send({ type: 'action', action: 'viewer', project });
  assert.equal(launches.at(-1).executable, path.join(toolsDirectory, 'assetViewer2-dev.exe'));
  assert.deepEqual(launches.at(-1).args, [outerSpaceApplication]);
});

test('lists game executables dynamically and launches the selected executable without arguments', async () => {
  await refreshCatalog();
  const newGameExecutable = path.join(gameDirectory, 'new-game.EXE');
  fs.writeFileSync(newGameExecutable, '');
  try {
    await refreshCatalog();
    await webviewView.webview.send({ type: 'selectProject', project: applicationFile });
    assert.ok(webviewView.webview.html.includes(`data-game="${newGameExecutable}"`));
    assert.ok(webviewView.webview.html.includes('<span>new-game</span>'));

    const project = projectData(applicationFile, workspaceRoot, 'project_stalker');
    await webviewView.webview.send({ type: 'runGame', project, executable: newGameExecutable });
    assert.equal(launches.at(-1).executable, newGameExecutable);
    assert.deepEqual(launches.at(-1).args, []);
    assert.equal(launches.at(-1).options.cwd, gameDirectory);

    await webviewView.webview.send({ type: 'runGame', project, executable: scriptedGameExe });
    assert.equal(launches.at(-1).executable, scriptedGameExe);
    assert.deepEqual(launches.at(-1).args, []);
    assert.equal(launches.at(-1).options.cwd, gameDirectory);
    assert.equal(launches.at(-1).options.detached, false);
    assert.equal(launches.at(-1).options.windowsHide, false);

    const beforeCommandLaunch = launches.length;
    await webviewView.webview.send({ type: 'runGameCommand', project, command: directRunCommand });
    assert.equal(terminals.length, 1);
    assert.equal(fakeTerminal.options.name, 'Dagor: direct-run-stalker');
    assert.equal(fakeTerminal.options.cwd, gameDirectory);
    assert.equal(fakeTerminal.options.shellPath, process.env.ComSpec || 'cmd.exe');
    assert.equal(fakeTerminal.shown, true);
    assert.deepEqual(fakeTerminal.sent, [{ text: `call "${directRunCommand}"`, addNewLine: true }]);

    await webviewView.webview.send({ type: 'runGameCommand', project, command: deeplyNestedGameExe });
    assert.match(errors.at(-1), /valid game command/);
    assert.equal(launches.length, beforeCommandLaunch);

    await webviewView.webview.send({ type: 'runGame', project, executable: deeplyNestedGameExe });
    assert.match(errors.at(-1), /valid game executable/);
    assert.equal(launches.length, beforeCommandLaunch);
  } finally {
    fs.rmSync(newGameExecutable, { force: true });
  }
});

test('the build button changes to stop while a build runs and stops the selected build', async () => {
  const project = projectData(applicationFile, workspaceRoot, 'project_stalker');
  await webviewView.webview.send({ type: 'action', action: 'build', project, components: ['code'] });
  const runningChild = fakeChild;
  await webviewView.webview.send({ type: 'selectProject', project: applicationFile });
  assert.match(webviewView.webview.html, /build-submit running[^>]*aria-label="Stop Build"/);
  await webviewView.webview.send({ type: 'stopBuild', project });
  assert.deepEqual(runningChild.stopRequest.args, ['/pid', '12345', '/t', '/f']);
  assert.equal(runningChild.stopRequest.options.windowsHide, true);
  assert.deepEqual(webviewView.webview.postedMessage, {
    type: 'buildState',
    project: applicationFile,
    running: false
  });

  await webviewView.webview.send({ type: 'action', action: 'generate', project });
  assert.ok(executedCommands.some(item => item.command === 'dagorProjectManager.generateProject'));
});

test('rejects non-local URIs and reports missing executables', async () => {
  await commands.get('dagorProjectManager.openWithBlkEditor')({ scheme: 'untitled', fsPath: 'sample.blk' });
  assert.match(errors.at(-1), /local \.blk/);

  fs.rmSync(path.join(toolsDirectory, 'blkEditor-dev.exe'));
  await commands.get('dagorProjectManager.openWithBlkEditor')(uri(folderFile));
  assert.match(errors.at(-1), /Cannot find blkEditor executable/);
});
