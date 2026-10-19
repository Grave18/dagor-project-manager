const path = require('node:path');
const fs = require('node:fs');
const vscode = require('vscode');
const { BUILD_COMPONENTS } = require('../../build/buildManager');
const { renderProjectWebview } = require('./renderProjectWebview');


class ProjectWebviewProvider {
  constructor({ catalog, buildManager, actions, sceneActions, outputChannel, extensionUri }) {
    this.catalog = catalog;
    this.buildManager = buildManager;
    this.actions = actions;
    this.sceneActions = sceneActions;
    this.outputChannel = outputChannel;
    this.extensionUri = extensionUri;
    this.view = undefined;
    this.selectedProject = undefined;
    this.contextTargetPath = undefined;
    this.contextTargetName = undefined;
    this.contextTargetProject = undefined;
    this.contextTargetKind = undefined;
    this.projectChevronAnimations = new Map();
    this.animateProjectPanel = false;
    this.projectPanelFromHeight = undefined;
    this.disposable = catalog.onDidChange.event(projects => {
      if (this.selectedProject && !projects.some(project => project.applicationFile === this.selectedProject)) {
        this.selectedProject = undefined;
      }
      this.render();
    });
  }

  resolveWebviewView(view) {
    this.view = view;
    const assetDirectory = path.join(this.extensionUri.fsPath, 'src', 'views', 'projectWebview');
    const cssPath = path.join(assetDirectory, 'projectWebview.css');
    const clientPath = path.join(assetDirectory, 'projectWebviewClient.js');
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(assetDirectory)]
    };
    this.assetUris = fs.existsSync(cssPath) && fs.existsSync(clientPath)
      ? {
        css: view.webview.asWebviewUri(vscode.Uri.file(cssPath)).toString(),
        client: view.webview.asWebviewUri(vscode.Uri.file(clientPath)).toString()
      }
      : undefined;
    if (!this.assetUris) {
      this.outputChannel?.appendLine(`[DAGOR_PM] ${vscode.l10n.t('Missing webview assets in {folder}.', { folder: assetDirectory })}`);
    }
    view.webview.onDidReceiveMessage(message => this.handleMessage(message));
    view.webview.onDidReceiveMessage(message => {
      if (message?.type === 'ready') {
        for (const project of this.catalog.projects) {
          if (this.buildManager.isRunning(project)) {
            view.webview.postMessage({ type: 'buildState', project: project.applicationFile, running: true });
          }
        }
      }
    });
    this.catalog.refresh();
    this.render();
  }

  render() {
    if (this.view) {
      if (!this.assetUris) {
        this.view.webview.html = '';
        return;
      }
      const html = this.getHtml();
      this.projectChevronAnimations.clear();
      this.view.webview.html = html;
    }
  }

  async handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'ready') return;
    if (message.type === 'setContextTarget') {
      this.setContextTarget(message.target);
      return;
    }
    if (message.type === 'refresh') {
      await this.catalog.refresh();
      return;
    }
    if (message.type === 'addProject') {
      await vscode.commands.executeCommand('dagorProjectManager.generateProject');
      return;
    }

    const projectData = message.project;
    const project = typeof projectData === 'string'
      ? this.catalog.projects.find(item => item.applicationFile === projectData)
      : this.catalog.projects.find(item => item.applicationFile === projectData?.applicationFile);
    if (message.type === 'selectProject') {
      if (!project) return;
      const previousProject = this.selectedProject;
      this.selectedProject = project.applicationFile;
      this.projectChevronAnimations.clear();
      if (previousProject !== this.selectedProject) {
        if (previousProject) this.projectChevronAnimations.set(previousProject, 'collapse');
        this.projectChevronAnimations.set(this.selectedProject, 'expand');
      }
      this.animateProjectPanel = previousProject !== this.selectedProject;
      this.projectPanelFromHeight = Number.isFinite(message.fromHeight) ? Math.max(0, message.fromHeight) : 0;
      this.render();
      this.animateProjectPanel = false;
      this.projectPanelFromHeight = undefined;
    } else if (message.type === 'toggleProject') {
      if (!project) return;
      const previousProject = this.selectedProject;
      this.selectedProject = previousProject === project.applicationFile ? undefined : project.applicationFile;
      this.projectChevronAnimations.clear();
      if (previousProject !== this.selectedProject) {
        if (previousProject) this.projectChevronAnimations.set(previousProject, 'collapse');
        if (this.selectedProject) this.projectChevronAnimations.set(this.selectedProject, 'expand');
      }
      this.animateProjectPanel = previousProject !== this.selectedProject;
      this.projectPanelFromHeight = Number.isFinite(message.fromHeight) ? Math.max(0, message.fromHeight) : 0;
      this.render();
      this.animateProjectPanel = false;
      this.projectPanelFromHeight = undefined;
    } else if (message.type === 'action') {
      if (message.action === 'build') {
        const components = Array.isArray(message.components)
          ? message.components.filter(component => BUILD_COMPONENTS.some(item => item.value === component))
          : [];
        this.actions.startBuild(project || projectData, components, running => {
          if (this.view) this.view.webview.postMessage({
            type: 'buildState',
            project: (project || projectData).applicationFile,
            running
          });
        });
      } else if (message.action === 'viewer') {
        await this.actions.openProjectDaViewer(project || projectData);
      } else if (message.action === 'generate') {
        await vscode.commands.executeCommand('dagorProjectManager.generateProject');
      }
    } else if (message.type === 'openScene') {
      const scenePath = typeof projectData === 'object'
        ? projectData.scenes?.find(item => item.uri === message.scene)?.uri
        : project?.scenes.find(item => item.uri.fsPath === message.scene)?.uri.fsPath;
      if (scenePath) await this.actions.openSceneInDaEditor(vscode.Uri.file(scenePath));
    } else if (message.type === 'runGame') {
      this.actions.runProjectGame(project, message.executable);
    } else if (message.type === 'runGameCommand') {
      this.actions.runProjectGameCommand(project, message.command);
    } else if (message.type === 'createGameCommand') {
      if (project) await this.actions.createProjectGameCommand(project);
    } else if (message.type === 'createScene') {
      if (project) await this.actions.createProjectScene(project);
    } else if (message.type === 'stopBuild') {
      this.actions.stopBuild(project || projectData, running => {
        if (this.view) this.view.webview.postMessage({
          type: 'buildState',
          project: (project || projectData).applicationFile,
          running
        });
      });
    }
  }

  setContextTarget(target) {
    this.contextTargetPath = undefined;
    this.contextTargetName = undefined;
    this.contextTargetProject = undefined;
    this.contextTargetKind = undefined;
    const project = this.catalog.projects.find(item => item.applicationFile === target?.project);
    if (!project) return;

    if (target.kind === 'project') {
      this.contextTargetPath = project.root;
      this.contextTargetName = path.basename(project.root);
    } else if (target.kind === 'build') {
      this.contextTargetPath = project.root;
      this.contextTargetName = project.label;
    } else if (target.kind === 'scene') {
      const scene = project.scenes.find(item => item.uri.fsPath === target.path);
      this.contextTargetPath = scene?.uri.fsPath;
      this.contextTargetName = scene?.label;
    } else if (target.kind === 'game') {
      const game = project.games.find(item => item.executable === target.path);
      this.contextTargetPath = game?.executable;
      this.contextTargetName = game?.label;
    } else if (target.kind === 'command') {
      const command = project.gameCommands.find(item => item.command === target.path);
      this.contextTargetPath = command?.command;
      this.contextTargetName = command?.label;
    } else if (target.kind === 'commandGroup') {
      this.contextTargetPath = path.join(project.root, 'game');
      this.contextTargetName = project.label;
    } else if (target.kind === 'sceneGroup') {
      this.contextTargetPath = project.root;
      this.contextTargetName = project.label;
    }
    if (this.contextTargetPath) {
      this.contextTargetProject = project;
      this.contextTargetKind = target.kind;
    }
  }

  takeContextTarget() {
    const target = {
      path: this.contextTargetPath,
      name: this.contextTargetName,
      project: this.contextTargetProject,
      kind: this.contextTargetKind
    };
    this.contextTargetPath = undefined;
    this.contextTargetName = undefined;
    this.contextTargetProject = undefined;
    this.contextTargetKind = undefined;
    return target;
  }

  async revealContextTarget() {
    const { path: targetPath } = this.takeContextTarget();
    if (!targetPath) return;
    await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(targetPath));
  }

  async revealContextTargetInOS() {
    const { path: targetPath } = this.takeContextTarget();
    if (!targetPath) return;
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(targetPath));
  }

  async copyContextTargetName() {
    const { name: targetName } = this.takeContextTarget();
    if (!targetName) return;
    await vscode.env.clipboard.writeText(targetName);
  }

  async copyContextTargetFullname() {
    const { path: targetPath } = this.takeContextTarget();
    if (!targetPath) return;
    await vscode.env.clipboard.writeText(targetPath);
  }

  async deleteContextProject() {
    const target = this.takeContextTarget();
    if (target.kind !== 'project' || !target.project) return;
    const project = this.catalog.projects.find(item => item.applicationFile === target.project.applicationFile);
    if (!project) return;

    const confirmation = await vscode.window.showWarningMessage(
      vscode.l10n.t('Delete Dagor project "{project}"?', { project: project.label }),
      {
        modal: true,
        detail: vscode.l10n.t('The entire project folder will be moved to the system trash:\n{path}', { path: project.root })
      },
      vscode.l10n.t('Delete Project'),
      vscode.l10n.t('Cancel')
    );
    if (confirmation !== vscode.l10n.t('Delete Project')) return;

    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(project.root), { recursive: true, useTrash: true });
      await this.catalog.refresh();
    } catch (error) {
      const confirmation = await vscode.window.showWarningMessage(
        vscode.l10n.t('Project "{project}" could not be moved to the system trash.', { project: project.label }),
        {
          modal: true,
          detail: vscode.l10n.t('{error}\nPermanently deleting this project cannot be undone.\n{path}', { error: error.message, path: project.root })
        },
        vscode.l10n.t('Permanently Delete'),
        vscode.l10n.t('Cancel')
      );
      if (confirmation !== vscode.l10n.t('Permanently Delete')) return;

      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(project.root), { recursive: true });
        await this.catalog.refresh();
      } catch (deleteError) {
        vscode.window.showErrorMessage(vscode.l10n.t('Failed to permanently delete Dagor project {project}: {error}', { project: project.label, error: deleteError.message }));
      }
    }
  }

  async deleteContextCommand() {
    const target = this.takeContextTarget();
    if (target.kind !== 'command' || !target.project || !target.path) return;
    const project = this.catalog.projects.find(item => item.applicationFile === target.project.applicationFile);
    const command = project?.gameCommands.find(item => item.command === target.path);
    if (!command) return;

    const confirmation = await vscode.window.showWarningMessage(
      vscode.l10n.t('Delete command "{command}"?', { command: command.label }),
      {
        modal: true,
        detail: vscode.l10n.t('The command file will be moved to the system trash:\n{path}', { path: command.command })
      },
      vscode.l10n.t('Delete Command'),
      vscode.l10n.t('Cancel')
    );
    if (confirmation !== vscode.l10n.t('Delete Command')) return;

    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(command.command), { recursive: true, useTrash: true });
      await this.catalog.refresh();
    } catch (error) {
      const confirmation = await vscode.window.showWarningMessage(
        vscode.l10n.t('Command "{command}" could not be moved to the system trash.', { command: command.label }),
        {
          modal: true,
          detail: vscode.l10n.t('{error}\nPermanently deleting this command cannot be undone.\n{path}', { error: error.message, path: command.command })
        },
        vscode.l10n.t('Permanently Delete'),
        vscode.l10n.t('Cancel')
      );
      if (confirmation !== vscode.l10n.t('Permanently Delete')) return;

      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(command.command), { recursive: true });
        await this.catalog.refresh();
      } catch (deleteError) {
        vscode.window.showErrorMessage(vscode.l10n.t('Failed to permanently delete command {command}: {error}', { command: command.label, error: deleteError.message }));
      }
    }
  }

  async deleteContextScene() {
    const target = this.takeContextTarget();
    if (target.kind !== 'scene' || !target.project || !target.path) return;
    const project = this.catalog.projects.find(item => item.applicationFile === target.project.applicationFile);
    const scene = project?.scenes.find(item => path.resolve(item.uri.fsPath) === path.resolve(target.path));
    if (!project || !scene) return;

    let details;
    try {
      details = await this.sceneActions.inspectDeletion(project, scene.uri.fsPath);
    } catch (error) {
      this.outputChannel?.show(true);
      this.outputChannel?.appendLine(`[DAGOR_PM] ${vscode.l10n.t('Could not inspect scene {scene}: {error}', { scene: scene.label, error: error.message })}`);
      vscode.window.showErrorMessage(vscode.l10n.t('Could not inspect scene {scene}: {error}', { scene: scene.label, error: error.message }));
      return;
    }

    if (!details.canDelete) {
      this.outputChannel?.show(true);
      this.outputChannel?.appendLine(`[DAGOR_PM] ${vscode.l10n.t('Refused to delete scene {scene}.', { scene: scene.label })}`);
      this.outputChannel?.appendLine(`[DAGOR_PM] ${details.reason}`);
      vscode.window.showWarningMessage(vscode.l10n.t('Cannot safely delete scene "{scene}".', { scene: scene.label }), { modal: true, detail: details.reason }, vscode.l10n.t('OK'));
      return;
    }

    const listedReferences = details.references.slice(0, 10);
    const referenceLines = details.references.length > 0
      ? `${listedReferences.map(reference => `${reference.file}:${reference.line}`).join('\n')}${details.references.length > listedReferences.length ? `\n…and ${details.references.length - listedReferences.length} more; see Output.` : ''}`
      : details.referenceScanError
        ? vscode.l10n.t('Reference scan failed: {error}', { error: details.referenceScanError })
        : vscode.l10n.t('No static references found.');
    const confirmationDetail = [
      vscode.l10n.t('Scene folder (to system trash):\n{path}', { path: details.sceneDirectory }),
      details.exportTargets.length > 0
        ? vscode.l10n.t('Export files (to system trash):\n{paths}{warning}', { paths: details.exportTargets.join('\n'), warning: details.exportWarning ? `\n${vscode.l10n.t('Attention: {warning}', { warning: details.exportWarning })}` : '' })
        : vscode.l10n.t('Export files: none found{warning}', { warning: details.exportWarning ? ` (${details.exportWarning})` : '' }),
      vscode.l10n.t('References (will be left unchanged):\n{references}', { references: referenceLines }),
      vscode.l10n.t('Static scanning may not detect references assembled or loaded by code.'),
      vscode.l10n.t('Assets will not be deleted.')
    ].join('\n\n');
    const output = this.outputChannel;
    output?.appendLine('');
    output?.appendLine(`[DAGOR_PM] ${vscode.l10n.t('Scene deletion inspection: {scene} in {project}.', { scene: scene.label, project: project.label })}`);
    output?.appendLine(`[DAGOR_PM] ${vscode.l10n.t('Scene folder: {path}', { path: details.sceneDirectory })}`);
    if (details.exportTargets.length > 0) {
      for (const exportPath of details.exportTargets) output?.appendLine(`[DAGOR_PM] ${vscode.l10n.t('Export target: {path}', { path: exportPath })}`);
    }
    if (details.exportWarning || details.exportTargets.length === 0) {
      output?.appendLine(`[DAGOR_PM] ${vscode.l10n.t('Attention: {warning}', { warning: details.exportWarning || vscode.l10n.t('No export files were identified.') })}`);
    }
    if (details.referenceScanError) {
      output?.appendLine(`[DAGOR_PM] ${vscode.l10n.t('Attention: static reference scan failed: {error}', { error: details.referenceScanError })}`);
    } else if (details.references.length > 0) {
      output?.appendLine(`[DAGOR_PM] ${vscode.l10n.t('Attention: these references were found and will not be changed:')}`);
      for (const reference of details.references) {
        output?.appendLine(`  ${reference.file}:${reference.line}: ${reference.text}`);
      }
    } else {
      output?.appendLine(`[DAGOR_PM] ${vscode.l10n.t('No direct textual references were found. Dynamic references may not be detected.')}`);
    }
    output?.appendLine(`[DAGOR_PM] ${vscode.l10n.t('Assets are not part of scene deletion and will be left untouched.')}`);
    if (details.references.length > listedReferences.length || details.referenceScanError) output?.show(true);
    const confirmation = await vscode.window.showWarningMessage(
      vscode.l10n.t('Delete scene "{scene}"?', { scene: scene.label }),
      { modal: true, detail: confirmationDetail },
      vscode.l10n.t('Delete Scene'),
      vscode.l10n.t('Cancel')
    );
    if (confirmation !== vscode.l10n.t('Delete Scene')) return;

    output?.show(true);
    output?.appendLine(`[DAGOR_PM] ${vscode.l10n.t('User confirmed deletion of scene {scene}.', { scene: scene.label })}`);

    const deletedPaths = [];
    let failedTargets = [];
    for (const targetPath of details.targets) {
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(targetPath), { recursive: true, useTrash: true });
        deletedPaths.push(targetPath);
        output?.appendLine(`[DAGOR_PM] ${vscode.l10n.t('Moved to system trash: {path}', { path: targetPath })}`);
      } catch (error) {
        failedTargets.push({ path: targetPath, message: error.message });
        output?.appendLine(`[DAGOR_PM] ${vscode.l10n.t('Failed to move to system trash: {path} ({error})', { path: targetPath, error: error.message })}`);
      }
    }

    if (failedTargets.length > 0) {
      const fallbackChoice = await vscode.window.showWarningMessage(
        vscode.l10n.t('Some files for scene "{scene}" could not be moved to the system trash.', { scene: scene.label }),
        {
          modal: true,
          detail: vscode.l10n.t('Permanently deleting these paths cannot be undone:\n{paths}', { paths: failedTargets.map(item => `${item.path}\n${item.message}`).join('\n') })
        },
        vscode.l10n.t('Permanently Delete'),
        vscode.l10n.t('Cancel')
      );
      if (fallbackChoice === vscode.l10n.t('Permanently Delete')) {
        const retryTargets = failedTargets;
        failedTargets = [];
        for (const item of retryTargets) {
          try {
            await vscode.workspace.fs.delete(vscode.Uri.file(item.path), { recursive: true });
            deletedPaths.push(item.path);
            output?.appendLine(`[DAGOR_PM] ${vscode.l10n.t('Permanently deleted: {path}', { path: item.path })}`);
          } catch (error) {
            failedTargets.push({ path: item.path, message: error.message });
            output?.appendLine(`[DAGOR_PM] ${vscode.l10n.t('Permanent deletion failed: {path} ({error})', { path: item.path, error: error.message })}`);
          }
        }
      } else {
        output?.appendLine(`[DAGOR_PM] ${vscode.l10n.t('Permanent deletion was cancelled; failed paths were left in place.')}`);
      }
    }

    const sourceFolderDeleted = deletedPaths.includes(details.sceneDirectory);
    if (sourceFolderDeleted) {
      try {
        await this.catalog.refresh();
      } catch (error) {
        output?.appendLine(`[DAGOR_PM] ${vscode.l10n.t('Attention: scene was deleted, but the project list could not be refreshed: {error}', { error: error.message })}`);
      }
    }
    if (failedTargets.length > 0) {
      output?.appendLine(`[DAGOR_PM] ${vscode.l10n.t('Scene deletion partially completed: {count} path(s) remain.', { count: failedTargets.length })}`);
      vscode.window.showWarningMessage(vscode.l10n.t('Scene "{scene}" was only partially deleted. See the Dagor Project Manager output.', { scene: scene.label }));
    } else {
      output?.appendLine(`[DAGOR_PM] ${vscode.l10n.t('Scene deletion finished. {count} path(s) removed.', { count: deletedPaths.length })}`);
      if (!sourceFolderDeleted) {
        vscode.window.showErrorMessage(vscode.l10n.t('Scene folder {path} was not deleted. See the Dagor Project Manager output.', { path: details.sceneDirectory }));
      }
    }
  }

  async createCommandFromContext() {
    const target = this.takeContextTarget();
    if (target.kind !== 'commandGroup' || !target.project) return;
    const project = this.catalog.projects.find(item => item.applicationFile === target.project.applicationFile);
    if (!project) return;
    await this.actions.createProjectGameCommand(project);
  }

  async createSceneFromContext() {
    const target = this.takeContextTarget();
    if (target.kind !== 'sceneGroup' || !target.project) return;
    const project = this.catalog.projects.find(item => item.applicationFile === target.project.applicationFile);
    if (!project) return;
    await this.actions.createProjectScene(project);
  }

  async runContextSceneInGame() {
    const target = this.takeContextTarget();
    if (target.kind !== 'scene' || !target.project || !target.path) return;
    await this.actions.runProjectSceneInGame(target.project, target.path);
  }

  runContextBuild(components) {
    const target = this.takeContextTarget();
    if (target.kind !== 'build' || !target.project) return;
    const selectedComponents = Array.isArray(components)
      ? components.filter(component => BUILD_COMPONENTS.some(item => item.value === component))
      : [];
    if (selectedComponents.length === 0) return;
    this.actions.startBuild(target.project, selectedComponents, running => {
      if (this.view) this.view.webview.postMessage({
        type: 'buildState',
        project: target.project.applicationFile,
        running
      });
    });
  }

  getHtml() {
    const project = this.catalog.projects.find(item => item.applicationFile === this.selectedProject);
    const strings = {
      language: vscode.env?.language?.startsWith('ru') ? 'ru' : 'en',
      refresh: vscode.l10n.t('Refresh'),
      createProject: vscode.l10n.t('Create Project'),
      emptySearching: vscode.l10n.t('Searching for Dagor projects…'),
      emptySearchFailed: vscode.l10n.t('Dagor project search failed.'),
      emptyNoProjects: vscode.l10n.t('No Dagor projects found. Open a workspace containing application.blk and prog/build.py.'),
      buildProject: vscode.l10n.t('Build Project'),
      selectComponents: vscode.l10n.t('Select components to build:'),
      build: vscode.l10n.t('Build'),
      stopBuild: vscode.l10n.t('Stop Build'),
      openDaViewer: vscode.l10n.t('Open daViewer'),
      openScene: vscode.l10n.t('Open Scene'),
      scenesLocation: vscode.l10n.t('Scenes should be located in develop/levels'),
      createScene: vscode.l10n.t('Create Scene'),
      runGame: vscode.l10n.t('Run Game'),
      gamesLocation: vscode.l10n.t('Game executables should be located in game/ or one folder below'),
      runCommand: vscode.l10n.t('Run Command'),
      commandsLocation: vscode.l10n.t('Command files should be located in game/'),
      createCommand: vscode.l10n.t('Create Command')
    };
    const componentLabels = {
      code: vscode.l10n.t('Code'),
      shaders: vscode.l10n.t('Shaders'),
      assets: vscode.l10n.t('Assets'),
      vromfs: vscode.l10n.t('Vromfs'),
      gui: vscode.l10n.t('Gui')
    };
    return renderProjectWebview({
      projects: this.catalog.projects,
      buildComponents: BUILD_COMPONENTS.map(component => ({ ...component, label: componentLabels[component.value] })),
      selectedProject: this.selectedProject,
      selectedProjectRunning: project ? this.buildManager.isRunning(project) : false,
      isRefreshing: this.catalog.isRefreshing,
      discoveryError: this.catalog.discoveryError,
      animation: {
        projectChevronAnimations: this.projectChevronAnimations,
        animateProjectPanel: this.animateProjectPanel,
        projectPanelFromHeight: this.projectPanelFromHeight
      },
      assetUris: this.assetUris,
      cspSource: this.view?.webview.cspSource || '',
      strings
    });
  }
}

module.exports = { ProjectWebviewProvider };
