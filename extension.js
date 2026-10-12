const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { spawn } = require('node:child_process');

const BUILD_COMPONENTS = [
  { label: 'Code', description: 'Build game and code binaries', value: 'code' },
  { label: 'Shaders', description: 'Compile shaders', value: 'shaders' },
  { label: 'Assets', description: 'Build project assets', value: 'assets' },
  { label: 'Vromfs', description: 'Pack virtual file systems', value: 'vromfs' },
  { label: 'Gui', description: 'Build GUI data', value: 'gui' }
];
const ICON_PATHS = {
  chevron: '<path d="m9 18 6-6-6-6"/>',
  folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H10l2 2h7.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  refresh: '<path d="M3 2v6h6M21 22v-6h-6M21 12a9 9 0 0 0-15-6.7L3 8m0 4a9 9 0 0 0 15 6.7L21 16"/>',
  build: '<path d="m14 6 4-4 4 4-4 4M18 2l-7 7m1 1 4 4-8 8a2.1 2.1 0 0 1-3-3z"/>',
  external: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M10 14 20 4m-7 0h7v7"/>',
  scene: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>'
};
const runningBuilds = new Map();

function iconSvg(name, className = '') {
  const classes = ['icon', className].filter(Boolean).join(' ');
  return `<svg class="${classes}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name]}</svg>`;
}

function resolveExecutable(configuredPath, toolsDirectory, settingName) {
  const executablePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : toolsDirectory
      ? path.resolve(toolsDirectory, configuredPath)
      : undefined;

  if (!executablePath) {
    throw new Error(`Set dagorProjectManager.toolsDirectory or configure an absolute path for ${settingName}.`);
  }

  if (!fs.existsSync(executablePath)) {
    throw new Error(`Cannot find ${settingName}: ${executablePath}`);
  }

  return executablePath;
}

function findProjectApplication(selectedFile, workspaceRoot) {
  let directory = path.dirname(selectedFile);
  const root = path.resolve(workspaceRoot);

  while (directory === root || directory.startsWith(`${root}${path.sep}`)) {
    const candidate = path.join(directory, 'application.blk');
    if (fs.existsSync(candidate)) {
      return { applicationFile: candidate, projectRoot: directory };
    }
    if (directory === root) {
      break;
    }
    directory = path.dirname(directory);
  }

  return undefined;
}

function findToolsDirectory(workspaceRoot) {
  const architectures = process.arch === 'arm64' ? ['arm64', 'x86_64'] : ['x86_64', 'arm64'];
  let directory = path.resolve(workspaceRoot);

  while (true) {
    for (const architecture of architectures) {
      const candidate = path.join(directory, 'tools', 'dagor_cdk', `windows-${architecture}`);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
}

function launch(executablePath, args, cwd, options = {}) {
  const child = spawn(executablePath, args, {
    cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    ...options
  });

  child.once('error', error => {
    vscode.window.showErrorMessage(`Failed to start Dagor tool: ${error.message}`);
  });
  child.unref();
}

async function runTool(fileUri, kind) {
  if (!fileUri || fileUri.scheme !== 'file') {
    vscode.window.showErrorMessage('Select a local .blk file in the VS Code Explorer.');
    return;
  }

  const selectedFile = fileUri.fsPath;
  if (path.extname(selectedFile).toLowerCase() !== '.blk') {
    vscode.window.showErrorMessage('The selected file is not a .blk file.');
    return;
  }

  const config = vscode.workspace.getConfiguration('dagorProjectManager');
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(fileUri)?.uri.fsPath;
  const toolsDirectory = config.get('toolsDirectory') || process.env.DAGOR_CDK_DIR ||
    (workspaceRoot ? findToolsDirectory(workspaceRoot) : undefined);
  if (!toolsDirectory) {
    vscode.window.showErrorMessage('Set dagorProjectManager.toolsDirectory or the DAGOR_CDK_DIR environment variable.');
    return;
  }

  try {
    const fileName = path.basename(selectedFile).toLowerCase();
    let executablePath;
    let args;
    let cwd = path.dirname(selectedFile);

    if (kind === 'blkEditor') {
      executablePath = resolveExecutable(config.get('blkEditorExecutable'), toolsDirectory, 'blkEditor executable');
      args = [selectedFile];
    } else if (kind === 'daViewer') {
      if (fileName !== 'application.blk') {
        vscode.window.showErrorMessage('daViewer can be opened from application.blk.');
        return;
      }
      executablePath = resolveExecutable(config.get('daViewerExecutable'), toolsDirectory, 'daViewer executable');
      args = [selectedFile];
      cwd = path.dirname(selectedFile);
    } else {
      executablePath = resolveExecutable(config.get('daEditorExecutable'), toolsDirectory, 'daEditor executable');
      if (fileName === 'application.blk') {
        args = [selectedFile];
        cwd = path.dirname(selectedFile);
      } else if (fileName.endsWith('.level.blk')) {
        if (!workspaceRoot) {
          vscode.window.showErrorMessage('Open the project folder in VS Code before opening a level.');
          return;
        }
        const project = findProjectApplication(selectedFile, workspaceRoot);
        if (!project) {
          vscode.window.showErrorMessage('Cannot find application.blk in the selected level folder or its parent folders.');
          return;
        }
        args = [project.applicationFile, selectedFile];
        cwd = project.projectRoot;
      } else {
        vscode.window.showErrorMessage('daEditor is available for application.blk and *.level.blk files.');
        return;
      }
    }

    launch(executablePath, args, cwd);
  } catch (error) {
    vscode.window.showErrorMessage(error.message);
  }
}

function findBuildScript(projectRoot) {
  const candidates = [
    path.join(projectRoot, 'prog', 'build.py'),
    path.join(projectRoot, 'build.py')
  ];
  return candidates.find(candidate => fs.existsSync(candidate));
}

function findGameFiles(projectRoot, extension) {
  const gameRoot = path.join(projectRoot, 'game');
  const directories = [gameRoot];
  try {
    for (const entry of fs.readdirSync(gameRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) directories.push(path.join(gameRoot, entry.name));
    }
  } catch {
    return [];
  }

  const files = [];
  for (const directory of directories) {
    try {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== extension) continue;
        const file = path.join(directory, entry.name);
        files.push({
          file,
          label: path.basename(entry.name, path.extname(entry.name))
        });
      }
    } catch {
      continue;
    }
  }

  return files.sort((left, right) => left.label.localeCompare(right.label) || left.file.localeCompare(right.file));
}

function findGameExecutables(projectRoot) {
  return findGameFiles(projectRoot, '.exe')
    .filter(item => !/[-_]ded(?:[-_]|$)/i.test(item.label))
    .map(item => ({ executable: item.file, label: item.label }));
}

function findGameCommandFiles(projectRoot) {
  return findGameFiles(projectRoot, '.cmd')
    .map(item => ({ command: item.file, label: item.label }));
}

class ProjectCatalog {
  constructor() {
    this.projects = [];
    this.refreshPromise = undefined;
    this.isRefreshing = false;
    this.discoveryError = undefined;
    this.onDidChange = new vscode.EventEmitter();
  }

  refresh() {
    if (this.refreshPromise) return this.refreshPromise;

    this.projects = [];
    this.isRefreshing = true;
    this.discoveryError = undefined;
    this.onDidChange.fire(this.projects);
    const refreshPromise = Promise.resolve()
      .then(() => this.discoverProjects())
      .then(projects => {
        this.projects = projects;
        return this.projects;
      })
      .catch(error => {
        this.discoveryError = error;
        throw error;
      })
      .finally(() => {
        this.isRefreshing = false;
        this.onDidChange.fire(this.projects);
        if (this.refreshPromise === refreshPromise) this.refreshPromise = undefined;
      });
    this.refreshPromise = refreshPromise;
    return refreshPromise;
  }

  async discoverProjects() {
    const projects = new Map();
    const exclude = '**/{.git,node_modules}/**';
    for (const workspaceRoot of getWorkspaceRoots()) {
      const applicationPattern = new vscode.RelativePattern(workspaceRoot, '**/application.blk');
      const applicationFiles = await vscode.workspace.findFiles(applicationPattern, exclude);
      for (const application of applicationFiles) {
        const applicationFile = application.fsPath;
        const projectRoot = path.dirname(applicationFile);
        if (!findBuildScript(projectRoot)) continue;
        projects.set(path.resolve(applicationFile), {
          applicationFile,
          root: projectRoot,
          workspaceRoot,
          label: path.basename(projectRoot),
          scenes: [],
          games: findGameExecutables(projectRoot),
          gameCommands: findGameCommandFiles(projectRoot)
        });
      }

      const scenePattern = new vscode.RelativePattern(workspaceRoot, '**/*.level.blk');
      const sceneFiles = await vscode.workspace.findFiles(scenePattern, exclude);
      const sceneRoots = [...projects.values()]
        .filter(project => project.workspaceRoot === workspaceRoot)
        .sort((left, right) => right.root.length - left.root.length);
      for (const sceneUri of sceneFiles) {
        const project = sceneRoots.find(candidate => {
          const relativePath = path.relative(candidate.root, sceneUri.fsPath);
          return relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
        });
        if (project) {
          project.scenes.push({
            uri: sceneUri,
            label: path.basename(sceneUri.fsPath, '.level.blk'),
            relativePath: path.relative(project.root, sceneUri.fsPath)
          });
        }
      }
    }

    return [...projects.values()]
      .map(project => ({
        ...project,
        scenes: project.scenes.sort((left, right) => left.label.localeCompare(right.label))
      }))
      .sort((left, right) => left.label.localeCompare(right.label) || left.root.localeCompare(right.root));
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>\"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;'
  })[character]);
}

class ProjectWebviewProvider {
  constructor(catalog) {
    this.catalog = catalog;
    this.view = undefined;
    this.selectedProject = undefined;
    this.projectChevronAnimations = new Map();
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
          const key = path.resolve(project.root);
          if (runningBuilds.has(key)) {
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
    if (message.type === 'refresh') {
      await this.catalog.refresh();
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
      this.render();
    } else if (message.type === 'toggleProject') {
      if (!project) return;
      const previousProject = this.selectedProject;
      this.selectedProject = project.applicationFile;
      this.projectChevronAnimations.clear();
      if (previousProject !== this.selectedProject) {
        if (previousProject) this.projectChevronAnimations.set(previousProject, 'collapse');
        this.projectChevronAnimations.set(this.selectedProject, 'expand');
      }
      this.render();
    } else if (message.type === 'action') {
      if (message.action === 'build') {
        const components = Array.isArray(message.components)
          ? message.components.filter(component => BUILD_COMPONENTS.some(item => item.value === component))
          : [];
        buildProject(project || projectData, components, running => {
          if (this.view) this.view.webview.postMessage({
            type: 'buildState',
            project: (project || projectData).applicationFile,
            running
          });
        });
      } else if (message.action === 'viewer') {
        await openProjectDaViewer(project || projectData);
      } else if (message.action === 'generate') {
        const label = project?.label || projectData?.label || 'Dagor';
        vscode.window.showInformationMessage(`Project generation for ${label} is not implemented yet.`);
      }
    } else if (message.type === 'openScene') {
      const scenePath = typeof projectData === 'object'
        ? projectData.scenes?.find(item => item.uri === message.scene)?.uri
        : project?.scenes.find(item => item.uri.fsPath === message.scene)?.uri.fsPath;
      if (scenePath) await openSceneInDaEditor(vscode.Uri.file(scenePath));
    } else if (message.type === 'runGame') {
      const game = project?.games.find(item => item.executable === message.executable);
      if (!game) {
        vscode.window.showErrorMessage('Select a valid game executable for this project.');
        return;
      }
      launch(game.executable, [], path.join(project.root, 'game'), { detached: false, windowsHide: false });
    } else if (message.type === 'runGameCommand') {
      const command = project?.gameCommands.find(item => item.command === message.command);
      if (!command) {
        vscode.window.showErrorMessage('Select a valid game command for this project.');
        return;
      }
      const terminal = vscode.window.createTerminal({
        name: `Dagor: ${command.label}`,
        cwd: path.join(project.root, 'game'),
        shellPath: process.env.ComSpec || 'cmd.exe'
      });
      terminal.show(true);
      terminal.sendText(`call "${command.command}"`, true);
    } else if (message.type === 'stopBuild') {
      stopBuild(project || projectData, running => {
        if (this.view) this.view.webview.postMessage({
          type: 'buildState',
          project: (project || projectData).applicationFile,
          running
        });
      });
    }
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
        <button type="button" class="project-row ${selected ? 'selected' : ''}" data-select="${projectId}" aria-pressed="${selected}">
          <span class="${chevronClasses}">${iconSvg('chevron')}</span><span class="project-icon">${iconSvg('folder')}</span>
          <span class="project-name">${escapeHtml(project.label)}</span><small>${escapeHtml(path.relative(project.workspaceRoot, project.root) || '.')}</small>
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
      const running = runningBuilds.has(path.resolve(project.root));
      const projectData = escapeHtml(JSON.stringify({
        root: project.root,
        applicationFile: project.applicationFile,
        label: project.label,
        scenes: project.scenes.map(scene => ({ uri: scene.uri.fsPath, label: scene.label }))
      }));
      const scenes = project.scenes.map(scene => `
        <button type="button" class="scene" data-scene="${escapeHtml(scene.uri.fsPath)}" title="${escapeHtml(scene.uri.fsPath)}">
          <span class="scene-icon">${iconSvg('scene')}</span><span>${escapeHtml(scene.label)}</span><small>${escapeHtml(scene.relativePath)}</small>
        </button>`).join('');
      const games = project.games.map(game => `
        <button type="button" class="scene game" data-game="${escapeHtml(game.executable)}" title="${escapeHtml(game.executable)}">
          <span class="game-icon">${iconSvg('play')}</span><span>${escapeHtml(game.label)}</span>
        </button>`).join('');
      const gameCommands = project.gameCommands.map(command => `
        <button type="button" class="scene game-command" data-game-command="${escapeHtml(command.command)}" title="${escapeHtml(command.command)}">
          <span class="command-icon">${iconSvg('terminal')}</span><span>${escapeHtml(command.label)}</span>
        </button>`).join('');
      const buildItems = BUILD_COMPONENTS.map(item => `
        <label class="component"><input type="checkbox" value="${item.value}" checked><span>${item.label}</span></label>`).join('');
      projectActions = `
        <section class="project-actions" data-project="${projectId}" data-project-data="${projectData}" data-running="${running}">
          <div class="action-grid">
            <div class="action-group">
              <button type="button" class="action build-toggle" data-action="build" aria-expanded="${running}" aria-label="Build Project">${iconSvg('build')} <span>Build Project</span></button>
              <div class="components ${running ? 'visible' : ''}"><div class="caption">Select components to build:</div>${buildItems}<button type="button" class="build-submit ${running ? 'running' : ''}" data-action="submitBuild" aria-label="${running ? 'Stop Build' : 'Build'}"><span class="build-icon">${iconSvg('play', 'build-start-icon')}${iconSvg('stop', 'build-stop-icon')}</span> <span class="build-label">${running ? 'Stop Build' : 'Build'}</span></button></div>
              <button type="button" class="action" data-action="viewer">${iconSvg('external')} <span>Open daViewer</span></button>
            </div>
            <div class="scene-group"><button type="button" class="action scene-heading" data-action="toggleScenes" aria-expanded="true">${iconSvg('scene')} <span>Open Scene</span><span class="end-chevron expanded">${iconSvg('chevron')}</span></button><div class="scene-list">${scenes || '<div class="empty">No scenes found</div>'}</div></div>
            <div class="scene-group game-group"><button type="button" class="action scene-heading" data-action="toggleGames" aria-expanded="true"><span class="game-heading-icon">${iconSvg('play')}</span><span>Run Game</span><span class="end-chevron expanded">${iconSvg('chevron')}</span></button><div class="game-list">${games || '<div class="empty">No game executables found</div>'}</div></div>
            <div class="scene-group command-group"><button type="button" class="action scene-heading" data-action="toggleGameCommands" aria-expanded="true"><span class="command-icon">${iconSvg('terminal')}</span><span>Run Command</span><span class="end-chevron expanded">${iconSvg('chevron')}</span></button><div class="game-command-list">${gameCommands || '<div class="empty">No game command files found</div>'}</div></div>
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
        .scene-group{grid-column:1 / -1;border-top:1px solid var(--vscode-widget-border);border-bottom:0}.scene-heading{font-weight:600}.end-chevron{display:inline-flex;margin-left:auto;transform-origin:center;transition:transform 220ms cubic-bezier(.2,.75,.25,1)}.scene-list,.game-list,.game-command-list{display:grid;padding-left:12px}.scene,.game,.game-command{display:flex;align-items:center;gap:8px;width:100%;padding:5px 7px;text-align:left;border-radius:4px}.scene small{font-size:10px}.game-icon,.game-heading-icon,.command-icon{display:inline-flex;align-items:center;justify-content:center;color:inherit}.empty{padding:6px;color:var(--vscode-descriptionForeground)}
        @media(prefers-reduced-motion:reduce){.chevron-icon.animate-expand,.chevron-icon.animate-collapse,.end-chevron{animation:none!important;transition:none!important}}
        @media(max-width:560px){.action-grid{grid-template-columns:1fr}.components{grid-column:1;grid-row:auto}.project-actions{margin-left:4px}.project-row small,.scene small{display:none}}
      </style></head><body>      <main><div class="toolbar"><button type="button" id="refresh" class="icon-button" title="Refresh projects" ${this.catalog.isRefreshing ? 'disabled' : ''}>${iconSvg('refresh')} Refresh</button></div><div class="project-list">${projectRows || `<div class="empty">${emptyState}</div>`}</div>${projectActions}</main>
      <script nonce="${nonce}">
        const vscode=acquireVsCodeApi();
        const projectFor=element=>JSON.parse(element.closest('.project-actions').dataset.projectData);
        document.getElementById('refresh').addEventListener('click',()=>{
  if(document.getElementById('refresh').disabled)return;
  vscode.postMessage({type:'refresh'});
});
const blockButtonsFor2s=()=>{
  const buttons=document.querySelectorAll('.action[data-action]:not([data-action="build"]):not([data-action="submitBuild"]), .scene[data-scene], .game[data-game], .game-command[data-game-command]');
  buttons.forEach(btn=>btn.disabled=true);
  setTimeout(()=>buttons.forEach(btn=>btn.disabled=false),5000);
};
        document.addEventListener('click',event=>{
          const select=event.target.closest('[data-select]');if(select){vscode.postMessage({type:'selectProject',project:select.dataset.select});return;}
          const scene=event.target.closest('[data-scene]');if(scene){vscode.postMessage({type:'openScene',project:projectFor(scene),scene:scene.dataset.scene});blockButtonsFor2s();return;}
          const game=event.target.closest('[data-game]');if(game){vscode.postMessage({type:'runGame',project:projectFor(game),executable:game.dataset.game});blockButtonsFor2s();return;}
          const gameCommand=event.target.closest('[data-game-command]');if(gameCommand){vscode.postMessage({type:'runGameCommand',project:projectFor(gameCommand),command:gameCommand.dataset.gameCommand});blockButtonsFor2s();return;}
          const button=event.target.closest('[data-action]');if(!button)return;
          if(button.dataset.action==='toggleScenes'||button.dataset.action==='toggleGames'||button.dataset.action==='toggleGameCommands'){
            const content=button.nextElementSibling;
            content.hidden=!content.hidden;
            button.setAttribute('aria-expanded',String(!content.hidden));
            button.querySelector('.end-chevron').classList.toggle('expanded',!content.hidden);
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

function getWorkspaceRoots() {
  return (vscode.workspace.workspaceFolders || []).map(folder => folder.uri.fsPath);
}

function getToolsDirectory(config) {
  return config.get('toolsDirectory') || process.env.DAGOR_CDK_DIR ||
    getWorkspaceRoots().map(findToolsDirectory).find(Boolean);
}

async function openSceneInDaEditor(fileUri) {
  const root = vscode.workspace.getWorkspaceFolder(fileUri)?.uri.fsPath;
  if (!root) {
    vscode.window.showErrorMessage('Open a Dagor project folder in VS Code first.');
    return;
  }
  await runTool(fileUri, 'daEditor');
}

async function openProjectDaViewer(project) {
  if (!project?.applicationFile) {
    vscode.window.showErrorMessage('Select a Dagor project in the sidebar.');
    return;
  }
  await runTool(vscode.Uri.file(project.applicationFile), 'daViewer');
}

function buildProject(project, components, onBuildStateChange = () => {}) {
  if (!project?.root) {
    vscode.window.showErrorMessage('Select a Dagor project in the sidebar.');
    return;
  }
  const selected = Array.isArray(components)
    ? components.filter(component => BUILD_COMPONENTS.some(item => item.value === component))
    : [];
  const key = path.resolve(project.root);
  if (runningBuilds.has(key)) {
    stopBuild(project, onBuildStateChange);
    return;
  }
  if (selected.length === 0) return;

  const script = findBuildScript(project.root);
  if (!script) {
    vscode.window.showErrorMessage(`Cannot find build.py for project ${project.label}.`);
    return;
  }

  const output = vscode.window.createOutputChannel(`Dagor Build: ${project.label}`);
  output.show(true);
  output.appendLine(`Running: ${script} ${selected.join(' ')}`);
  const python = vscode.workspace.getConfiguration('dagorProjectManager').get('pythonExecutable') || 'python';
  const child = spawn(python, [script, ...selected], {
    cwd: path.dirname(script),
    windowsHide: true
  });
  onBuildStateChange(true);
  child.stdout?.on('data', data => output.append(data.toString()));
  child.stderr?.on('data', data => output.append(data.toString()));
  let finished = false;
  const finishBuild = () => {
    if (finished) return;
    finished = true;
    runningBuilds.delete(key);
    onBuildStateChange(false);
  };
  runningBuilds.set(key, { child, finishBuild, output });
  child.once('error', error => {
    output.appendLine(`\nFailed to start build: ${error.message}`);
    vscode.window.showErrorMessage(`Failed to start Dagor build: ${error.message}`);
    finishBuild();
  });
  child.once('exit', (code, signal) => {
    output.appendLine(`\nBuild finished with ${signal ? `signal ${signal}` : `exit code ${code}`}.`);
    finishBuild();
  });
  child.once('close', finishBuild);
}

function stopBuild(project, onBuildStateChange = () => {}) {
  const key = project?.root && path.resolve(project.root);
  const build = key && runningBuilds.get(key);
  if (!build) {
    vscode.window.showInformationMessage(`No Dagor build is running for ${project?.label || 'this project'}.`);
    return;
  }

  build.output.appendLine('\nBuild cancellation requested.');
  const stopped = process.platform === 'win32'
    ? spawn('taskkill', ['/pid', String(build.child.pid), '/t', '/f'], { windowsHide: true })
    : (build.child.kill('SIGTERM'), undefined);
  stopped?.once('error', error => vscode.window.showErrorMessage(`Failed to stop build: ${error.message}`));
  build.finishBuild();
}


function activate(context) {
  for (const [command, kind] of [
    ['dagorProjectManager.openWithBlkEditor', 'blkEditor'],
    ['dagorProjectManager.openWithDaEditor', 'daEditor'],
    ['dagorProjectManager.openWithDaViewer', 'daViewer']
  ]) {
    context.subscriptions.push(vscode.commands.registerCommand(command, fileUri => runTool(fileUri, kind)));
  }

  const catalog = new ProjectCatalog();
  const provider = new ProjectWebviewProvider(catalog);
  context.subscriptions.push(provider.disposable);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('dagorProjectManager.projects', provider, {
    webviewOptions: { retainContextWhenHidden: true }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.refreshProjects', () => catalog.refresh()));
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.openSceneWithDaEditor', openSceneInDaEditor));
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.openProjectWithDaViewer', openProjectDaViewer));
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.buildProject', buildProject));
  context.subscriptions.push(vscode.commands.registerCommand('dagorProjectManager.generateProject', project => {
    vscode.window.showInformationMessage(`Project generation for ${project?.label || 'Dagor'} is not implemented yet.`);
  }));

  const watcher = vscode.workspace.createFileSystemWatcher('**/*.level.blk');
  context.subscriptions.push(watcher);
  context.subscriptions.push(watcher.onDidCreate(() => catalog.refresh()));
  context.subscriptions.push(watcher.onDidDelete(() => catalog.refresh()));
  context.subscriptions.push(watcher.onDidChange(() => catalog.refresh()));
  const gameExecutableWatcher = vscode.workspace.createFileSystemWatcher('**/game/**/*.exe');
  context.subscriptions.push(gameExecutableWatcher);
  context.subscriptions.push(gameExecutableWatcher.onDidCreate(() => catalog.refresh()));
  context.subscriptions.push(gameExecutableWatcher.onDidDelete(() => catalog.refresh()));
  context.subscriptions.push(gameExecutableWatcher.onDidChange(() => catalog.refresh()));
  const gameCommandWatcher = vscode.workspace.createFileSystemWatcher('**/game/**/*.cmd');
  context.subscriptions.push(gameCommandWatcher);
  context.subscriptions.push(gameCommandWatcher.onDidCreate(() => catalog.refresh()));
  context.subscriptions.push(gameCommandWatcher.onDidDelete(() => catalog.refresh()));
  context.subscriptions.push(gameCommandWatcher.onDidChange(() => catalog.refresh()));
  const applicationWatcher = vscode.workspace.createFileSystemWatcher('**/application.blk');
  context.subscriptions.push(applicationWatcher);
  context.subscriptions.push(applicationWatcher.onDidCreate(() => catalog.refresh()));
  context.subscriptions.push(applicationWatcher.onDidDelete(() => catalog.refresh()));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => catalog.refresh()));
  catalog.refresh();
}

function deactivate() {}

module.exports = { activate, deactivate };
