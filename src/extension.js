const path = require('node:path');
const vscode = require('vscode');
const { spawn } = require('node:child_process');
const { ProjectCatalog } = require('./projects/projectCatalog');
const dagorTools = require('./dagor/dagorTools');
const { runTool, openSceneInDaEditor, openProjectDaViewer } = dagorTools;
const { BuildManager, BUILD_COMPONENTS } = require('./build/buildManager');
const { ProjectWebviewProvider } = require('./views/projectWebview/ProjectWebviewProvider');
const { createProjectActions } = require('./projects/projectActions');
const { createSceneActions } = require('./scenes/sceneActions');
const { createProject, findDagorEngineRoots } = require('./projects/projectGenerator');
const PROJECT_FOLDERS_CONTEXT = 'dagorProjectManager.projectFolders';

function localizeProjectGeneratorError(error) {
  if (!error.code?.startsWith('DAGOR_PROJECT_GENERATOR_')) {
    return vscode.l10n.t('Failed to create project: {error}', { error: error.message });
  }
  const args = error.l10nArgs || {};
  switch (error.l10nMessage) {
    case 'The bundled starter template is missing: {path}':
      return vscode.l10n.t('The bundled starter template is missing: {path}', args);
    case 'The bundled starter template is incomplete. Missing: {files}':
      return vscode.l10n.t('The bundled starter template is incomplete. Missing: {files}', args);
    case 'Project name must start with a letter or number and contain only letters, numbers, underscores, or hyphens.':
      return vscode.l10n.t('Project name must start with a letter or number and contain only letters, numbers, underscores, or hyphens.');
    case 'Template entry escapes the project folder: {path}':
      return vscode.l10n.t('Template entry escapes the project folder: {path}', args);
    case 'Template paths collide after name replacement: {path}':
      return vscode.l10n.t('Template paths collide after name replacement: {path}', args);
    case 'The bundled starter template contains an unsupported symbolic link: {path}':
      return vscode.l10n.t('The bundled starter template contains an unsupported symbolic link: {path}', args);
    case 'The bundled starter template contains an unsupported file type: {path}':
      return vscode.l10n.t('The bundled starter template contains an unsupported file type: {path}', args);
    case 'Generated project is missing required file: {path}':
      return vscode.l10n.t('Generated project is missing required file: {path}', args);
    case 'Template marker remains in generated path: {path}':
      return vscode.l10n.t('Template marker remains in generated path: {path}', args);
    case 'Template marker remains in generated file: {path}':
      return vscode.l10n.t('Template marker remains in generated file: {path}', args);
    case 'Failed to initialize the project Git repository: {error}':
      return vscode.l10n.t('Failed to initialize the project Git repository: {error}', args);
    case 'The selected folder is not a DagorEngine root: {path}':
      return vscode.l10n.t('The selected folder is not a DagorEngine root: {path}', args);
    case 'A project folder already exists: {path}':
      return vscode.l10n.t('A project folder already exists: {path}', args);
    default:
      return vscode.l10n.t('Failed to create project: {error}', { error: error.message });
  }
}

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
  const sceneActions = createSceneActions({ vscodeApi: vscode });
  context.subscriptions.push(catalog.onDidChange.event(projects => {
    const projectFolders = Object.fromEntries(
      projects.map(project => [vscode.Uri.file(path.resolve(project.root)).toString(), true])
    );
    vscode.commands.executeCommand('setContext', PROJECT_FOLDERS_CONTEXT, projectFolders)
      .then(undefined, error => {
        vscode.window.showErrorMessage(vscode.l10n.t('Failed to update Dagor project folder menu: {error}', { error: error.message }));
      });
  }));
  const outputChannel = vscode.window.createOutputChannel(vscode.l10n.t('Dagor Project Manager'));
  context.subscriptions.push(outputChannel);
  const provider = new ProjectWebviewProvider({ catalog, buildManager, actions, sceneActions, outputChannel, extensionUri: context.extensionUri });
  context.subscriptions.push(provider.disposable);
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.revealContextTarget', () =>
    provider.revealContextTarget()));
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.revealContextTargetInOS', () =>
    provider.revealContextTargetInOS()));
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.copyContextTargetName', () =>
    provider.copyContextTargetName()));
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.copyContextTargetFullname', () =>
    provider.copyContextTargetFullname()));
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.deleteContextProject', () =>
    provider.deleteContextProject()));
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.deleteContextCommand', () =>
    provider.deleteContextCommand()));
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.deleteContextScene', () =>
    provider.deleteContextScene()));
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.runSceneInGame', () =>
    provider.runContextSceneInGame()));
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.folderCreateScene', () =>
    provider.createSceneFromContext()));
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
    ['dagorProjectManager.folderRunCommand', actions.pickProjectGameCommand],
    ['dagorProjectManager.folderCreateCommand', actions.createProjectGameCommand]
  ];
  for (const [command, action] of folderActions) {
    context.subscriptions.push(vscode.commands.registerCommand(command, async folderUri => {
      if (command === 'dagorProjectManager.folderCreateCommand' &&
          (!folderUri || folderUri.scheme !== 'file' || typeof folderUri.fsPath !== 'string')) {
        await provider.createCommandFromContext();
        return;
      }
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
      vscode.window.showErrorMessage(vscode.l10n.t('Cannot find DagorEngine. Open a folder inside DagorEngine or set dagorProjectManager.toolsDirectory.'));
      return;
    }

    let engineRoot = engineRoots[0];
    if (engineRoots.length > 1) {
      const selectedRoot = await vscode.window.showQuickPick(engineRoots.map(root => ({
        label: path.basename(root),
        description: root,
        root
      })), { placeHolder: vscode.l10n.t('Select the DagorEngine folder for the new project') });
      if (!selectedRoot) return;
      engineRoot = selectedRoot.root;
    }

    const projectName = await vscode.window.showInputBox({
      prompt: vscode.l10n.t('Enter a name for the new Dagor project'),
      placeHolder: 'MyProject',
      validateInput: value => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)
        ? undefined
        : vscode.l10n.t('Use a letter or number first, then only letters, numbers, underscores, or hyphens.')
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
      vscode.window.showInformationMessage(vscode.l10n.t('Dagor project created; editor shader and asset builds started: {path}', { path: result.projectRoot }));
    } catch (error) {
      vscode.window.showErrorMessage(localizeProjectGeneratorError(error));
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
