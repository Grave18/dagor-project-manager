const crypto = require('node:crypto');
const path = require('node:path');
const vscode = require('vscode');
const { BUILD_COMPONENTS } = require('./buildManager');

const ICON_PATHS = {
  chevron: '<path d="m9 18 6-6-6-6"/>',
  folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H10l2 2h7.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  folderPlus: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H10l2 2h7.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><circle cx="18" cy="17" r="4" fill="var(--vscode-sideBar-background, var(--vscode-editor-background))"/><path d="M18 15v4m-2-2h4"/>',
  refresh: '<path d="M3 2v6h6M21 22v-6h-6M21 12a9 9 0 0 0-15-6.7L3 8m0 4a9 9 0 0 0 15 6.7L21 16"/>',
  build: '<path d="m14 6 4-4 4 4-4 4M18 2l-7 7m1 1 4 4-8 8a2.1 2.1 0 0 1-3-3z"/>',
  external: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M10 14 20 4m-7 0h7v7"/>',
  scene: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  plus: '<path d="M12 5v14m-7-7h14"/>'
};
function iconSvg(name, className = '') {
  const classes = ['icon', className].filter(Boolean).join(' ');
  return `<svg class="${classes}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name]}</svg>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>\"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;'
  })[character]);
}

function getProjectDisplayPath(project) {
  let directory = path.resolve(project.root);
  let dagorEngineRoot;
  while (true) {
    if (path.basename(directory).toLowerCase() === 'dagorengine') {
      dagorEngineRoot = directory;
      break;
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const base = dagorEngineRoot || project.workspaceRoot;
  return path.relative(base, project.root) || path.basename(project.root);
}

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
    const nonce = crypto.randomBytes(16).toString('hex');
    const projectRows = this.catalog.projects.map(project => {
      const projectId = escapeHtml(project.applicationFile);
      const selected = this.selectedProject === project.applicationFile;
      const chevronAnimation = this.projectChevronAnimations.get(project.applicationFile);
      const chevronClasses = ['chevron-icon', selected ? 'expanded' : '', chevronAnimation ? `animate-${chevronAnimation}` : '']
        .filter(Boolean).join(' ');
      return `
        <button type="button" class="project-row ${selected ? 'selected' : ''}" data-select="${projectId}" data-context-kind="project" data-context-project="${projectId}" data-vscode-context='{"webviewSection":"project","preventDefaultContextMenuItems":true}' aria-pressed="${selected}">
          <span class="${chevronClasses}">${iconSvg('chevron')}</span><span class="project-icon">${iconSvg('folder')}</span>
          <span class="project-name">${escapeHtml(project.label)}</span><small>${escapeHtml(getProjectDisplayPath(project))}</small>
        </button>`;
    }).join('');

    const project = this.catalog.projects.find(item => item.applicationFile === this.selectedProject);
    const emptyState = this.catalog.isRefreshing
      ? 'Searching for Dagor projects…'
      : this.catalog.discoveryError
        ? 'Dagor project search failed.'
        : 'No Dagor projects found. Open a workspace containing application.blk and prog/build.py.';
    let projectActions = '';
    if (project) {
      const projectId = escapeHtml(project.applicationFile);
      const running = this.buildManager.isRunning(project);
      const projectData = escapeHtml(JSON.stringify({
        root: project.root,
        applicationFile: project.applicationFile,
        label: project.label,
        scenes: project.scenes.map(scene => ({ uri: scene.uri.fsPath, label: scene.label }))
      }));
      const scenes = project.scenes.map(scene => `
        <button type="button" class="scene" data-scene="${escapeHtml(scene.uri.fsPath)}" data-context-kind="scene" data-context-project="${projectId}" data-context-path="${escapeHtml(scene.uri.fsPath)}" data-vscode-context='{"webviewSection":"scene","preventDefaultContextMenuItems":true}' title="${escapeHtml(scene.uri.fsPath)}">
          <span class="scene-icon">${iconSvg('scene')}</span><span>${escapeHtml(scene.label)}</span><small>${escapeHtml(scene.relativePath)}</small>
        </button>`).join('');
      const games = project.games.map(game => `
        <button type="button" class="scene game" data-game="${escapeHtml(game.executable)}" data-context-kind="game" data-context-project="${projectId}" data-context-path="${escapeHtml(game.executable)}" data-vscode-context='{"webviewSection":"resource","preventDefaultContextMenuItems":true}' title="${escapeHtml(game.executable)}">
          <span class="game-icon">${iconSvg('play')}</span><span>${escapeHtml(game.label)}</span><small>${escapeHtml(path.relative(project.root, game.executable))}</small>
        </button>`).join('');
      const gameCommands = project.gameCommands.map(command => `
        <button type="button" class="scene game-command" data-game-command="${escapeHtml(command.command)}" data-context-kind="command" data-context-project="${projectId}" data-context-path="${escapeHtml(command.command)}" data-vscode-context='{"webviewSection":"commandItem","preventDefaultContextMenuItems":true}' title="${escapeHtml(command.invocation || command.command)}">
          <span class="command-icon">${iconSvg('terminal')}</span><span>${escapeHtml(command.label)}</span><small>${escapeHtml(path.relative(project.root, command.command))}</small>
        </button>`).join('');
      const buildItems = BUILD_COMPONENTS.map(item => `
        <label class="component"><input type="checkbox" value="${item.value}" checked><span>${item.label}</span></label>`).join('');
      projectActions = `
        <section class="project-actions${this.animateProjectPanel ? ' opening' : ''}"${this.animateProjectPanel ? ` style="height:${this.projectPanelFromHeight ?? 0}px"` : ''} data-project="${projectId}" data-project-data="${projectData}" data-running="${running}">
          <div class="action-grid">
            <div class="action-group">
              <button type="button" class="action build-toggle" data-action="build" data-context-kind="build" data-context-project="${projectId}" data-vscode-context='{"webviewSection":"build","preventDefaultContextMenuItems":true}' aria-expanded="${running}" aria-label="Build Project">${iconSvg('build')} <span>Build Project</span></button>
              <div class="components ${running ? 'visible' : ''}"><div class="caption">Select components to build:</div>${buildItems}<button type="button" class="build-submit ${running ? 'running' : ''}" data-action="submitBuild" aria-label="${running ? 'Stop Build' : 'Build'}"><span class="build-icon">${iconSvg('play', 'build-start-icon')}${iconSvg('stop', 'build-stop-icon')}</span> <span class="build-label">${running ? 'Stop Build' : 'Build'}</span></button></div>
              <button type="button" class="action" data-action="viewer" data-vscode-context='{"preventDefaultContextMenuItems":true}'>${iconSvg('external')} <span>Open daViewer</span></button>
            </div>
            <div class="scene-group"><button type="button" class="action scene-heading" data-action="toggleScenes" data-vscode-context='{"preventDefaultContextMenuItems":true}' aria-expanded="true">${iconSvg('scene')} <span>Open Scene</span><span class="end-chevron expanded">${iconSvg('chevron')}</span></button><div class="scene-list">${scenes || '<div class="empty">Scenes should be located in develop/levels</div>'}<button type="button" class="scene create-scene" data-create-scene data-vscode-context='{"preventDefaultContextMenuItems":true}'><span class="command-icon" aria-hidden="true">${iconSvg('plus')}</span><span>Create Scene</span></button></div></div>
            <div class="scene-group game-group"><button type="button" class="action scene-heading" data-action="toggleGames" data-vscode-context='{"preventDefaultContextMenuItems":true}' aria-expanded="true"><span class="game-heading-icon">${iconSvg('play')}</span><span>Run Game</span><span class="end-chevron expanded">${iconSvg('chevron')}</span></button><div class="game-list">${games || '<div class="empty">Game executables should be located in game/ or one folder below</div>'}</div></div>
            <div class="scene-group command-group"><button type="button" class="action scene-heading" data-action="toggleGameCommands" data-context-kind="commandGroup" data-context-project="${projectId}" data-vscode-context='{"webviewSection":"command","preventDefaultContextMenuItems":true}' aria-expanded="true"><span class="command-icon">${iconSvg('terminal')}</span><span>Run Command</span><span class="end-chevron expanded">${iconSvg('chevron')}</span></button><div class="game-command-list">${gameCommands || '<div class="empty">Command files should be located in game/</div>'}<button type="button" class="scene create-command" data-create-command data-context-project="${projectId}" data-vscode-context='{"preventDefaultContextMenuItems":true}'><span class="command-icon" aria-hidden="true">${iconSvg('plus')}</span><span>Create Command</span></button></div></div>
          </div>
        </section>`;
      projectActions = projectActions.replace(
        /<div class="action-group">([\s\S]*?)<\/div>\s*<button type="button" class="action" data-action="viewer">/,
        '<div class="action-group">$1</div><button type="button" class="action" data-action="viewer">'
      );
    }

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <meta name="viewport" content="width=device-width,initial-scale=1.0"><style>
        :root{color-scheme:light dark}*{box-sizing:border-box}[hidden]{display:none!important}body{padding:6px 8px;color:var(--vscode-foreground);font:13px var(--vscode-font-family)}
        .icon{display:block;width:16px;height:16px;flex:0 0 16px;stroke-width:1.8}.toolbar{display:flex;justify-content:flex-end;margin:0 0 2px}.icon-button{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;color:var(--vscode-foreground);background:transparent;border:1px solid transparent;border-radius:4px;font:inherit;cursor:pointer}.icon-button:hover{background:var(--vscode-button-hoverBackground,var(--vscode-button-background))}.icon-button:disabled,.action:disabled,.scene:disabled,.build-submit:disabled{opacity:0.5;cursor:not-allowed!important;filter:brightness(0.8)}.icon-button:disabled:hover,.action:disabled:hover,.scene:disabled:hover,.build-submit:disabled:hover{background:transparent!important}.icon-button:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:1px}
        .project-row,.action,.scene,.build-submit{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
        .project-list{display:grid;gap:1px}.project-row{width:100%;display:flex;align-items:center;gap:7px;padding:3px 6px;text-align:left;border-radius:4px;min-height:25px;overflow:hidden}.project-row:hover,.project-row.selected{background:var(--vscode-list-hoverBackground)}
        .project-name{font-weight:600}.project-row small,.scene small{margin-left:auto;color:var(--vscode-descriptionForeground);font-size:11px}.chevron-icon{width:16px;height:16px;flex:0 0 16px;color:var(--vscode-descriptionForeground);transform-origin:center}.chevron-icon.expanded,.end-chevron.expanded{transform:rotate(90deg)}.chevron-icon.animate-expand{animation:project-chevron-expand 260ms cubic-bezier(.2,.75,.25,1) both}.chevron-icon.animate-collapse{animation:project-chevron-collapse 260ms cubic-bezier(.2,.75,.25,1) both}@keyframes project-chevron-expand{0%{transform:rotate(0) scale(.85)}68%{transform:rotate(98deg) scale(1.08)}100%{transform:rotate(90deg) scale(1)}}@keyframes project-chevron-collapse{0%{transform:rotate(90deg) scale(1)}68%{transform:rotate(-8deg) scale(1.08)}100%{transform:rotate(0) scale(1)}}.project-icon{color:var(--vscode-charts-blue)}
        .project-actions{margin:8px;padding:6px;border:1px solid var(--vscode-widget-border);border-radius:5px;display:block;overflow:hidden}.action-grid{display:grid;grid-template-columns:1fr;gap:3px 8px;align-items:start}.action-group{display:contents}.action-group>.action{grid-column:1}.action{display:flex;align-items:center;gap:8px;width:100%;padding:5px 8px;text-align:left;border-radius:4px;min-height:27px}.action:hover,.scene:hover{background:var(--vscode-list-hoverBackground)}.build-toggle{grid-column:1;font-weight:600;background:transparent}.build-toggle:hover{background:var(--vscode-list-hoverBackground)}
        .components{display:none;width:100%;padding:7px;border:1px solid var(--vscode-widget-border);border-radius:5px}.components.visible{display:block}.caption{margin-bottom:5px;color:var(--vscode-descriptionForeground)}.component{display:flex;align-items:center;gap:7px;padding:2px 0}.component input{accent-color:var(--vscode-checkbox-background)}.build-submit{width:100%;margin-top:6px;padding:5px;background:transparent;color:var(--vscode-foreground);border:1px solid var(--vscode-button-border, var(--vscode-contrastBorder));border-radius:4px}.build-submit:hover{background:var(--vscode-list-hoverBackground)}.build-submit.running,.build-toggle.running{background:#a83f48;color:#fff;border-color:#bc555d}.build-submit.running:hover,.build-toggle.running:hover{background:#bd4a54;filter:brightness(1.04)}.build-icon{display:inline-flex;vertical-align:middle}.build-stop-icon{display:none}.build-submit.running .build-start-icon{display:none}.build-submit.running .build-stop-icon{display:block}
        .scene-group{grid-column:1 / -1;border-top:1px solid var(--vscode-widget-border);border-bottom:0}.scene-heading{font-weight:600}.end-chevron{display:inline-flex;margin-left:auto;transform-origin:center;transition:transform 220ms cubic-bezier(.2,.75,.25,1)}.scene-list,.game-list,.game-command-list{display:grid;padding-left:12px}.scene,.game,.game-command,.create-command{display:flex;align-items:center;gap:8px;width:100%;padding:5px 7px;text-align:left;border-radius:4px}.scene small{font-size:10px}.game-icon,.game-heading-icon,.command-icon{display:inline-flex;align-items:center;justify-content:center;color:inherit}.empty{padding:6px;color:var(--vscode-descriptionForeground)}
        @media(prefers-reduced-motion:reduce){.chevron-icon.animate-expand,.chevron-icon.animate-collapse,.end-chevron{animation:none!important;transition:none!important}}
        @media(max-width:560px){.action-grid{grid-template-columns:1fr}.components{grid-column:1;grid-row:auto}.project-row small,.scene small{display:none}}
        .add-project-row{display:flex;justify-content:flex-start;margin:8px 0 8px;padding-top:6px;border-top:1px solid var(--vscode-widget-border)}.add-project-button{width:100%;display:flex;align-items:center;gap:7px;min-height:25px;padding:3px 6px;text-align:left;color:var(--vscode-foreground);background:transparent;border:0;border-radius:4px;font:inherit;cursor:pointer}.add-project-button:hover{background:var(--vscode-list-hoverBackground)}.add-project-button:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:1px}.add-project-button:disabled{opacity:0.5;cursor:not-allowed;filter:brightness(0.8)}.add-project-button:disabled:hover{background:transparent}.add-project-spacer{visibility:hidden}.add-project-label{font-weight:600}
      </style></head><body>      <main><div class="toolbar"><button type="button" id="refresh" class="icon-button" title="Refresh projects" data-vscode-context='{"preventDefaultContextMenuItems":true}' ${this.catalog.isRefreshing ? 'disabled' : ''}>${iconSvg('refresh')} Refresh</button></div><div class="project-list">${projectRows || `<div class="empty">${emptyState}</div>`}</div><div class="add-project-row"><button type="button" id="add-project" class="add-project-button" data-vscode-context='{"preventDefaultContextMenuItems":true}' ${this.catalog.isRefreshing ? 'disabled' : ''}><span class="chevron-icon add-project-spacer" aria-hidden="true">${iconSvg('chevron')}</span><span class="project-icon">${iconSvg('folderPlus')}</span><span class="add-project-label">Create Project</span></button></div>${projectActions}</main>
      <script nonce="${nonce}">
        const vscode=acquireVsCodeApi();
        const prefersReducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        let projectPanelAnimation;
        const enteringPanel=document.querySelector('.project-actions.opening');
        if(enteringPanel&&prefersReducedMotion){
          enteringPanel.style.height='auto';
          enteringPanel.classList.remove('opening');
        }else if(enteringPanel&&enteringPanel.animate){
          const fromHeight=enteringPanel.getBoundingClientRect().height;
          const initialHeight=enteringPanel.style.height;
          enteringPanel.style.height='auto';
          const height=enteringPanel.getBoundingClientRect().height;
          enteringPanel.style.height=initialHeight;
          const expanding=height>=fromHeight;
          const easing=expanding?'cubic-bezier(.22,1,.36,1)':'cubic-bezier(.4,0,1,1)';
          const animation=enteringPanel.animate([{height:fromHeight+'px',opacity:0.96,transform:'translateY(0)'},{height:height+'px',opacity:1,transform:'translateY(0)'}],{duration:260,easing});
          const content=enteringPanel.querySelector('.action-grid');
          if(content&&content.animate){
            const shift=expanding?-8:8;
            content.animate([{opacity:0.7,transform:'translateY('+shift+'px)'},{opacity:1,transform:'translateY(0)'}],{duration:260,easing});
          }
          animation.onfinish=()=>{enteringPanel.style.height='auto';enteringPanel.classList.remove('opening');};
        }
        const selectProject=projectId=>{
          if(projectPanelAnimation){projectPanelAnimation.cancel();projectPanelAnimation=undefined;}
          const panel=document.querySelector('.project-actions');
          if(panel&&panel.dataset.project===projectId&&!prefersReducedMotion&&panel.animate){
            const height=panel.getBoundingClientRect().height;
            projectPanelAnimation=panel.animate([{height:height+'px',opacity:1,transform:'translateY(0)'},{height:'0px',opacity:0,transform:'translateY(-6px)'}],{duration:220,easing:'cubic-bezier(.4,0,1,1)',fill:'forwards'});
            projectPanelAnimation.onfinish=()=>{projectPanelAnimation=undefined;vscode.postMessage({type:'toggleProject',project:projectId});};
          }else if(panel&&panel.dataset.project===projectId){
            vscode.postMessage({type:'toggleProject',project:projectId});
          }else{
            const fromHeight=panel?panel.getBoundingClientRect().height:0;
            vscode.postMessage({type:'selectProject',project:projectId,fromHeight});
          }
        };
        document.addEventListener('contextmenu',event=>{
          const item=event.target.closest('[data-context-kind]');
          vscode.postMessage({type:'setContextTarget',target:item?{
            kind:item.dataset.contextKind,
            project:item.dataset.contextProject,
            path:item.dataset.contextPath
          }:null});
        },true);
        const projectFor=element=>JSON.parse(element.closest('.project-actions').dataset.projectData);
        document.getElementById('refresh').addEventListener('click',()=>{
  if(document.getElementById('refresh').disabled)return;
  vscode.postMessage({type:'refresh'});
});
document.getElementById('add-project').addEventListener('click',()=>{const button=document.getElementById('add-project');if(button.disabled)return;vscode.postMessage({type:'addProject'});});
const blockButtonsFor2s=()=>{
  const buttons=document.querySelectorAll('.action[data-action]:not([data-action="build"]):not([data-action="submitBuild"]), .scene[data-scene], .game[data-game], .game-command[data-game-command], .create-command, .create-scene');
  buttons.forEach(btn=>btn.disabled=true);
  setTimeout(()=>buttons.forEach(btn=>btn.disabled=false),5000);
};
        document.addEventListener('click',event=>{
          const select=event.target.closest('[data-select]');if(select){selectProject(select.dataset.select);return;}
          const scene=event.target.closest('[data-scene]');if(scene){vscode.postMessage({type:'openScene',project:projectFor(scene),scene:scene.dataset.scene});blockButtonsFor2s();return;}
          const game=event.target.closest('[data-game]');if(game){vscode.postMessage({type:'runGame',project:projectFor(game),executable:game.dataset.game});blockButtonsFor2s();return;}
          const gameCommand=event.target.closest('[data-game-command]');if(gameCommand){vscode.postMessage({type:'runGameCommand',project:projectFor(gameCommand),command:gameCommand.dataset.gameCommand});blockButtonsFor2s();return;}
          const createCommand=event.target.closest('[data-create-command]');if(createCommand){if(createCommand.disabled)return;vscode.postMessage({type:'createGameCommand',project:projectFor(createCommand)});blockButtonsFor2s();return;}
          const createScene=event.target.closest('[data-create-scene]');if(createScene){if(createScene.disabled)return;vscode.postMessage({type:'createScene',project:projectFor(createScene)});blockButtonsFor2s();return;}
          const button=event.target.closest('[data-action]');if(!button)return;
          if(button.dataset.action==='toggleScenes'||button.dataset.action==='toggleGames'||button.dataset.action==='toggleGameCommands'){
            const content=button.nextElementSibling;
            const expanding=content.hidden;
            const group=button.closest('.scene-group');
            const animate=group&&group.animate&&!prefersReducedMotion;
            if(animate){
              const fromHeight=group.getBoundingClientRect().height;
              content.hidden=!expanding;
              const height=group.getBoundingClientRect().height;
              content.hidden=!content.hidden;
              const animation=group.animate([{height:fromHeight+'px'},{height:height+'px'}],{duration:220,easing:expanding?'cubic-bezier(.22,1,.36,1)':'cubic-bezier(.4,0,1,1)'});
              group.style.overflow='hidden';
              animation.onfinish=()=>{
                content.hidden=!expanding;
                group.style.height='';
                group.style.overflow='';
              };
            }else{
              content.hidden=!expanding;
            }
            button.setAttribute('aria-expanded',String(expanding));
            button.querySelector('.end-chevron').classList.toggle('expanded',expanding);
            return;
          }
          if(button.dataset.action==='build'){
            const actions=button.closest('.project-actions');
            if(actions.dataset.running==='true'){
              vscode.postMessage({type:'stopBuild',project:projectFor(button)});
            }else{
              const components=actions.querySelector('.components');
              const visible=components.classList.toggle('visible');
              button.setAttribute('aria-expanded',String(visible));
            }
            return;
          }
          if(button.dataset.action==='submitBuild'){
            const actions=button.closest('.project-actions');
            if(actions.dataset.running==='true'){
              vscode.postMessage({type:'stopBuild',project:projectFor(button)});
              return;
            }
            const components=[...actions.querySelectorAll('.component input:checked')].map(input=>input.value);
            if(components.length===0)return;
            vscode.postMessage({type:'action',action:'build',project:projectFor(button),components});
            return;
          }
          const project=projectFor(button);
          const action=button.dataset.action;
          vscode.postMessage(action==='stop'?{type:'stopBuild',project}:{type:'action',action,project});
          if(action!=='build'&&action!=='submitBuild')blockButtonsFor2s();
        });
        window.addEventListener('message',event=>{
          const message=event.data;
          if(message.type!=='buildState')return;
          const actions=[...document.querySelectorAll('.project-actions')].find(item=>JSON.parse(item.dataset.projectData).applicationFile===message.project);
          if(!actions)return;
          actions.dataset.running=String(message.running);
          const submit=actions.querySelector('.build-submit');
          submit.classList.toggle('running',message.running);
          submit.querySelector('.build-label').textContent=message.running?'Stop Build':'Build';
          submit.setAttribute('aria-label',message.running?'Stop Build':'Build');
        });
        window.addEventListener('load',()=>vscode.postMessage({type:'ready'}));
      </script></body></html>`;
  }
}

module.exports = { ProjectWebviewProvider };
