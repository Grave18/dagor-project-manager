const path = require('node:path');
const vscode = require('vscode');
const { BUILD_COMPONENTS } = require('../../build/buildManager');
const { renderProjectWebview } = require('./renderProjectWebview');


class ProjectWebviewProvider {
  constructor({ catalog, buildManager, actions, sceneActions, outputChannel }) {
    this.catalog = catalog;
    this.buildManager = buildManager;
    this.actions = actions;
    this.sceneActions = sceneActions;
    this.outputChannel = outputChannel;
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
    view.webview.options = { enableScripts: true };
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
      `Delete Dagor project "${project.label}"?`,
      {
        modal: true,
        detail: `The entire project folder will be moved to the system trash:\n${project.root}`
      },
      'Delete Project',
      'Cancel'
    );
    if (confirmation !== 'Delete Project') return;

    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(project.root), { recursive: true, useTrash: true });
      await this.catalog.refresh();
    } catch (error) {
      const confirmation = await vscode.window.showWarningMessage(
        `Project "${project.label}" could not be moved to the system trash.`,
        {
          modal: true,
          detail: `${error.message}\nPermanently deleting this project cannot be undone.\n${project.root}`
        },
        'Permanently Delete',
        'Cancel'
      );
      if (confirmation !== 'Permanently Delete') return;

      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(project.root), { recursive: true });
        await this.catalog.refresh();
      } catch (deleteError) {
        vscode.window.showErrorMessage(`Failed to permanently delete Dagor project ${project.label}: ${deleteError.message}`);
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
      `Delete command "${command.label}"?`,
      {
        modal: true,
        detail: `The command file will be moved to the system trash:\n${command.command}`
      },
      'Delete Command',
      'Cancel'
    );
    if (confirmation !== 'Delete Command') return;

    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(command.command), { recursive: true, useTrash: true });
      await this.catalog.refresh();
    } catch (error) {
      const confirmation = await vscode.window.showWarningMessage(
        `Command "${command.label}" could not be moved to the system trash.`,
        {
          modal: true,
          detail: `${error.message}\nPermanently deleting this command cannot be undone.\n${command.command}`
        },
        'Permanently Delete',
        'Cancel'
      );
      if (confirmation !== 'Permanently Delete') return;

      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(command.command), { recursive: true });
        await this.catalog.refresh();
      } catch (deleteError) {
        vscode.window.showErrorMessage(`Failed to permanently delete command ${command.label}: ${deleteError.message}`);
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
      this.outputChannel?.appendLine(`[DAGOR_PM] Could not inspect scene ${scene.label}: ${error.message}`);
      vscode.window.showErrorMessage(`Could not inspect scene ${scene.label}: ${error.message}`);
      return;
    }

    if (!details.canDelete) {
      this.outputChannel?.show(true);
      this.outputChannel?.appendLine(`[DAGOR_PM] Refused to delete scene ${scene.label}.`);
      this.outputChannel?.appendLine(`[DAGOR_PM] ${details.reason}`);
      vscode.window.showWarningMessage(`Cannot safely delete scene "${scene.label}".`, { modal: true, detail: details.reason }, 'OK');
      return;
    }

    const listedReferences = details.references.slice(0, 10);
    const referenceLines = details.references.length > 0
      ? `${listedReferences.map(reference => `${reference.file}:${reference.line}`).join('\n')}${details.references.length > listedReferences.length ? `\n…and ${details.references.length - listedReferences.length} more; see Output.` : ''}`
      : details.referenceScanError
        ? `Reference scan failed: ${details.referenceScanError}`
        : 'No static references found.';
    const confirmationDetail = [
      `Scene folder (to system trash):\n${details.sceneDirectory}`,
      details.exportTargets.length > 0
        ? `Export files (to system trash):\n${details.exportTargets.join('\n')}${details.exportWarning ? `\nAttention: ${details.exportWarning}` : ''}`
        : `Export files: none found${details.exportWarning ? ` (${details.exportWarning})` : ''}`,
      `References (will be left unchanged):\n${referenceLines}`,
      'Static scanning may not detect references assembled or loaded by code.',
      'Assets will not be deleted.'
    ].join('\n\n');
    const output = this.outputChannel;
    output?.appendLine('');
    output?.appendLine(`[DAGOR_PM] Scene deletion inspection: ${scene.label} in ${project.label}.`);
    output?.appendLine(`[DAGOR_PM] Scene folder: ${details.sceneDirectory}`);
    if (details.exportTargets.length > 0) {
      for (const exportPath of details.exportTargets) output?.appendLine(`[DAGOR_PM] Export target: ${exportPath}`);
    }
    if (details.exportWarning || details.exportTargets.length === 0) {
      output?.appendLine(`[DAGOR_PM] Attention: ${details.exportWarning || 'No export files were identified.'}`);
    }
    if (details.referenceScanError) {
      output?.appendLine(`[DAGOR_PM] Attention: static reference scan failed: ${details.referenceScanError}`);
    } else if (details.references.length > 0) {
      output?.appendLine('[DAGOR_PM] Attention: these references were found and will not be changed:');
      for (const reference of details.references) {
        output?.appendLine(`  ${reference.file}:${reference.line}: ${reference.text}`);
      }
    } else {
      output?.appendLine('[DAGOR_PM] No direct textual references were found. Dynamic references may not be detected.');
    }
    output?.appendLine('[DAGOR_PM] Assets are not part of scene deletion and will be left untouched.');
    if (details.references.length > listedReferences.length || details.referenceScanError) output?.show(true);
    const confirmation = await vscode.window.showWarningMessage(
      `Delete scene "${scene.label}"?`,
      { modal: true, detail: confirmationDetail },
      'Delete Scene',
      'Cancel'
    );
    if (confirmation !== 'Delete Scene') return;

    output?.show(true);
    output?.appendLine(`[DAGOR_PM] User confirmed deletion of scene ${scene.label}.`);

    const deletedPaths = [];
    let failedTargets = [];
    for (const targetPath of details.targets) {
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(targetPath), { recursive: true, useTrash: true });
        deletedPaths.push(targetPath);
        output?.appendLine(`[DAGOR_PM] Moved to system trash: ${targetPath}`);
      } catch (error) {
        failedTargets.push({ path: targetPath, message: error.message });
        output?.appendLine(`[DAGOR_PM] Failed to move to system trash: ${targetPath} (${error.message})`);
      }
    }

    if (failedTargets.length > 0) {
      const fallbackChoice = await vscode.window.showWarningMessage(
        `Some files for scene "${scene.label}" could not be moved to the system trash.`,
        {
          modal: true,
          detail: `Permanently deleting these paths cannot be undone:\n${failedTargets.map(item => `${item.path}\n${item.message}`).join('\n')}`
        },
        'Permanently Delete',
        'Cancel'
      );
      if (fallbackChoice === 'Permanently Delete') {
        const retryTargets = failedTargets;
        failedTargets = [];
        for (const item of retryTargets) {
          try {
            await vscode.workspace.fs.delete(vscode.Uri.file(item.path), { recursive: true });
            deletedPaths.push(item.path);
            output?.appendLine(`[DAGOR_PM] Permanently deleted: ${item.path}`);
          } catch (error) {
            failedTargets.push({ path: item.path, message: error.message });
            output?.appendLine(`[DAGOR_PM] Permanent deletion failed: ${item.path} (${error.message})`);
          }
        }
      } else {
        output?.appendLine('[DAGOR_PM] Permanent deletion was cancelled; failed paths were left in place.');
      }
    }

    const sourceFolderDeleted = deletedPaths.includes(details.sceneDirectory);
    if (sourceFolderDeleted) {
      try {
        await this.catalog.refresh();
      } catch (error) {
        output?.appendLine(`[DAGOR_PM] Attention: scene was deleted, but the project list could not be refreshed: ${error.message}`);
      }
    }
    if (failedTargets.length > 0) {
      output?.appendLine(`[DAGOR_PM] Scene deletion partially completed: ${failedTargets.length} path(s) remain.`);
      vscode.window.showWarningMessage(`Scene "${scene.label}" was only partially deleted. See the Dagor Project Manager output.`);
    } else {
      output?.appendLine(`[DAGOR_PM] Scene deletion finished. ${deletedPaths.length} path(s) removed.`);
      if (!sourceFolderDeleted) {
        vscode.window.showErrorMessage(`Scene folder ${details.sceneDirectory} was not deleted. See the Dagor Project Manager output.`);
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
    return renderProjectWebview({
      projects: this.catalog.projects,
      buildComponents: BUILD_COMPONENTS,
      selectedProject: this.selectedProject,
      selectedProjectRunning: project ? this.buildManager.isRunning(project) : false,
      isRefreshing: this.catalog.isRefreshing,
      discoveryError: this.catalog.discoveryError,
      animation: {
        projectChevronAnimations: this.projectChevronAnimations,
        animateProjectPanel: this.animateProjectPanel,
        projectPanelFromHeight: this.projectPanelFromHeight
      }
    });
  }
}

module.exports = { ProjectWebviewProvider };
