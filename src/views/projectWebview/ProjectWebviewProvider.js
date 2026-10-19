const path = require('node:path');
const fs = require('node:fs');
const vscode = require('vscode');
const { BUILD_COMPONENTS } = require('../../build/buildManager');
const { renderProjectWebview } = require('./renderProjectWebview');
const { isRecord, isWebviewMessage } = require('./webviewMessages');

class ProjectWebviewProvider {
  constructor({ catalog, buildManager, actions, sceneDeletionController, outputChannel, extensionUri }) {
    this.catalog = catalog;
    this.buildManager = buildManager;
    this.actions = actions;
    this.sceneDeletionController = sceneDeletionController;
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

  /** @param {unknown} message */
  async handleMessage(message) {
    if (!isWebviewMessage(message)) return;
    if (message.type === 'ready') {
      for (const project of this.catalog.projects) {
        if (this.buildManager.isRunning(project)) {
          this.view?.webview.postMessage({ type: 'buildState', project: project.applicationFile, running: true });
        }
      }
      return;
    }
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

    const projectId = typeof message.project === 'string' ? message.project : undefined;
    const project = projectId === undefined
      ? undefined
      : this.catalog.projects.find(item => item.applicationFile === projectId);
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
      this.projectPanelFromHeight = typeof message.fromHeight === 'number' && Number.isFinite(message.fromHeight)
        ? Math.max(0, message.fromHeight)
        : 0;
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
      this.projectPanelFromHeight = typeof message.fromHeight === 'number' && Number.isFinite(message.fromHeight)
        ? Math.max(0, message.fromHeight)
        : 0;
      this.render();
      this.animateProjectPanel = false;
      this.projectPanelFromHeight = undefined;
    } else if (message.type === 'action') {
      if (message.action === 'build') {
        if (!project) return;
        const components = Array.isArray(message.components)
          ? message.components.filter(component => typeof component === 'string' && BUILD_COMPONENTS.some(item => item.value === component))
          : [];
        this.actions.startBuild(project, components, running => {
          if (this.view) this.view.webview.postMessage({
            type: 'buildState',
            project: project.applicationFile,
            running
          });
        });
      } else if (message.action === 'viewer') {
        if (!project) return;
        await this.actions.openProjectDaViewer(project);
      } else if (message.action === 'generate') {
        await vscode.commands.executeCommand('dagorProjectManager.generateProject');
      }
    } else if (message.type === 'openScene') {
      if (!project || typeof message.scene !== 'string') return;
      const scene = project.scenes.find(item => item.uri.fsPath === message.scene);
      if (scene) await this.actions.openSceneInDaEditor(scene.uri);
    } else if (message.type === 'runGame') {
      if (!project || typeof message.executable !== 'string') return;
      const game = project.games.find(item => item.executable === message.executable);
      if (game) this.actions.runProjectGame(project, game.executable);
    } else if (message.type === 'runGameCommand') {
      if (!project || typeof message.command !== 'string') return;
      const command = project.gameCommands.find(item => item.command === message.command);
      if (command) this.actions.runProjectGameCommand(project, command.command);
    } else if (message.type === 'createGameCommand') {
      if (project) await this.actions.createProjectGameCommand(project);
    } else if (message.type === 'createScene') {
      if (project) await this.actions.createProjectScene(project);
    } else if (message.type === 'stopBuild') {
      if (!project) return;
      this.actions.stopBuild(project, running => {
        if (this.view) this.view.webview.postMessage({
          type: 'buildState',
          project: project.applicationFile,
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
    if (!isRecord(target) || typeof target.project !== 'string' || typeof target.kind !== 'string') return;
    const project = this.catalog.projects.find(item => item.applicationFile === target.project);
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
    await this.sceneDeletionController.deleteScene(target.project.applicationFile, target.path);
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
    const project = this.catalog.projects.find(item => item.applicationFile === target.project.applicationFile);
    const scene = project?.scenes.find(item => path.resolve(item.uri.fsPath) === path.resolve(target.path));
    if (project && scene) await this.actions.runProjectSceneInGame(project, scene.uri.fsPath);
  }

  runContextBuild(components) {
    const target = this.takeContextTarget();
    if (target.kind !== 'build' || !target.project) return;
    const project = this.catalog.projects.find(item => item.applicationFile === target.project.applicationFile);
    if (!project) return;
    const selectedComponents = Array.isArray(components)
      ? components.filter(component => typeof component === 'string' && BUILD_COMPONENTS.some(item => item.value === component))
      : [];
    if (selectedComponents.length === 0) return;
    this.actions.startBuild(project, selectedComponents, running => {
      if (this.view) this.view.webview.postMessage({
        type: 'buildState',
        project: project.applicationFile,
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
