const path = require('node:path');
const vscode = require('vscode');
const { spawn } = require('node:child_process');
const { ProjectCatalog } = require('./projectCatalog');
const dagorTools = require('./dagorTools');
const { runTool, openSceneInDaEditor, openProjectDaViewer } = dagorTools;
const { BuildManager, BUILD_COMPONENTS } = require('./buildManager');
const { ProjectWebviewProvider } = require('./projectWebview');
const { createProjectActions } = require('./projectActions');
const { createProject, findDagorEngineRoots } = require('./projectGenerator');
const PROJECT_FOLDERS_CONTEXT = 'dagorProjectManager.projectFolders';

function activate(context) {
  for (const [command, kind] of [
    ['dagorProjectManager.openWithBlkEditor', 'blkEditor'],
    ['dagorProjectManager.openWithDaEditor', 'daEditor'],
    ['dagorProjectManager.openWithDaViewer', 'daViewer']
  ]) {
    context.subscriptions.push(vscode.commands.registerCommand(command, fileUri => runTool(fileUri, kind)));
  }

  let catalog;
  const buildManager = new BuildManager({
    vscodeApi: vscode,
    spawnProcess: spawn,
    refreshCatalog: () => catalog?.refresh(),
    subscriptions: context.subscriptions
  });
  catalog = new ProjectCatalog({ ensureExecutableWatcher: () => buildManager.ensureExecutableWatcher() });
  const actions = createProjectActions({ vscodeApi: vscode, catalog, toolRunner: dagorTools, buildManager });
  context.subscriptions.push(catalog.onDidChange.event(projects => {
    const projectFolders = Object.fromEntries(
      projects.map(project => [vscode.Uri.file(path.resolve(project.root)).toString(), true])
    );
    vscode.commands.executeCommand('setContext', PROJECT_FOLDERS_CONTEXT, projectFolders)
      .then(undefined, error => {
        vscode.window.showErrorMessage(`Failed to update Dagor project folder menu: ${error.message}`);
      });
  }));
  const provider = new ProjectWebviewProvider({ catalog, buildManager, actions });
  context.subscriptions.push(provider.disposable);
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.revealContextTarget', () =>
    provider.revealContextTarget()));
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.revealContextTargetInOS', () =>
    provider.revealContextTargetInOS()));
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.copyContextTargetName', () =>
    provider.copyContextTargetName()));
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.copyContextTargetFullname', () =>
    provider.copyContextTargetFullname()));
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.runSceneInGame', () =>
    provider.runContextSceneInGame()));
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.buildAllFromContext', () =>
    provider.runContextBuild(BUILD_COMPONENTS.map(component => component.value))));
  for (const component of BUILD_COMPONENTS) {
    const componentName = component.value[0].toUpperCase() + component.value.slice(1);
    context.subscriptions.push(vscode.commands.registerCommand(`dagorProjectManager.build${componentName}FromContext`, () =>
      provider.runContextBuild([component.value])));
  }
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('dagorProjectManager.projects', provider, {
    webviewOptions: { retainContextWhenHidden: true }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.refreshProjects', () => catalog.refresh()));
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.openSceneWithDaEditor', openSceneInDaEditor));
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.openProjectWithDaViewer', openProjectDaViewer));
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.buildProject', (project, components) =>
    buildManager.start(project, components)));
  const folderActions = [
    ['dagorProjectManager.folderBuildAll', project => buildManager.start(
      project,
      BUILD_COMPONENTS.map(component => component.value),
      running => {
        if (provider.view) provider.view.webview.postMessage({
          type: 'buildState',
          project: project.applicationFile,
          running
        });
      }
    )],
    ['dagorProjectManager.folderOpenDaViewer', actions.openProjectDaViewer],
    ['dagorProjectManager.folderOpenScene', actions.openProjectScene],
    ['dagorProjectManager.folderRunGame', actions.pickProjectGame],
    ['dagorProjectManager.folderRunCommand', actions.pickProjectGameCommand]
  ];
  for (const [command, action] of folderActions) {
    context.subscriptions.push(vscode.commands.registerCommand(command, async folderUri => {
      const project = await actions.findProjectForFolder(folderUri);
      if (project) await action(project);
    }));
  }
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.generateProject', async () => {
    const configuration = vscode.workspace.getConfiguration('dagorProjectManager');
    const configuredToolsDirectory = configuration.get('toolsDirectory') || process.env.DAGOR_CDK_DIR;
    const workspaceRoots = (vscode.workspace.workspaceFolders || []).map(folder => folder.uri.fsPath);
    const engineRoots = findDagorEngineRoots(workspaceRoots, configuredToolsDirectory);
    if (engineRoots.length === 0) {
      vscode.window.showErrorMessage('Cannot find DagorEngine. Open a folder inside DagorEngine or set dagorProjectManager.toolsDirectory.');
      return;
    }

    let engineRoot = engineRoots[0];
    if (engineRoots.length > 1) {
      const selectedRoot = await vscode.window.showQuickPick(engineRoots.map(root => ({
        label: path.basename(root),
        description: root,
        root
      })), { placeHolder: 'Select the DagorEngine folder for the new project' });
      if (!selectedRoot) return;
      engineRoot = selectedRoot.root;
    }

    const projectName = await vscode.window.showInputBox({
      prompt: 'Enter a name for the new Dagor project',
      placeHolder: 'MyProject',
      validateInput: value => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)
        ? undefined
        : 'Use a letter or number first, then only letters, numbers, underscores, or hyphens.'
    });
    if (projectName === undefined) return;

    try {
      const result = createProject({
        projectName,
        engineRoot,
        templateRoot: path.join(context.extensionPath, 'templates', 'starter-project')
      });
      const projects = await catalog.refresh();
      const generatedProject = projects.find(project =>
        path.resolve(project.root) === path.resolve(result.projectRoot)
      ) || {
        root: result.projectRoot,
        applicationFile: result.applicationFile,
        label: projectName
      };
      buildManager.start(generatedProject, ['editor_shaders', 'assets'], running => {
        if (provider.view) provider.view.webview.postMessage({
          type: 'buildState',
          project: generatedProject.applicationFile,
          running
        });
      });
      vscode.window.showInformationMessage(`Dagor project created; editor shader and asset builds started: ${result.projectRoot}`);
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }));

  const watcher = vscode.workspace.createFileSystemWatcher('**/*.level.blk');
  context.subscriptions.push(watcher);
  context.subscriptions.push(watcher.onDidCreate(() => catalog.refresh()));
  context.subscriptions.push(watcher.onDidDelete(() => catalog.refresh()));
  context.subscriptions.push(watcher.onDidChange(() => catalog.refresh()));
  buildManager.ensureExecutableWatcher();
  const gameCommandWatcher = vscode.workspace.createFileSystemWatcher('**/game/*.cmd');
  context.subscriptions.push(gameCommandWatcher);
  context.subscriptions.push(gameCommandWatcher.onDidCreate(() => catalog.refresh()));
  context.subscriptions.push(gameCommandWatcher.onDidDelete(() => catalog.refresh()));
  context.subscriptions.push(gameCommandWatcher.onDidChange(() => catalog.refresh()));
  const applicationWatcher = vscode.workspace.createFileSystemWatcher('**/application.blk');
  context.subscriptions.push(applicationWatcher);
  context.subscriptions.push(applicationWatcher.onDidCreate(() => catalog.refresh()));
  context.subscriptions.push(applicationWatcher.onDidDelete(() => catalog.refresh()));
  const buildScriptWatcher = vscode.workspace.createFileSystemWatcher('**/build.py');
  context.subscriptions.push(buildScriptWatcher);
  context.subscriptions.push(buildScriptWatcher.onDidCreate(() => catalog.refresh()));
  context.subscriptions.push(buildScriptWatcher.onDidDelete(() => catalog.refresh()));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => catalog.refresh()));
  catalog.refresh();
}

function deactivate() {}

module.exports = { activate, deactivate };
