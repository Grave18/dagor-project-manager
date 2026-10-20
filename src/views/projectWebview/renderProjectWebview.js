const path = require('node:path');

const ICON_PATHS = {
  chevron: '<path d="m9 18 6-6-6-6"/>',
  folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H10l2 2h7.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  folderPlus: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H10l2 2h7.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><circle cx="18" cy="17" r="4" fill="var(--vscode-sideBar-background, var(--vscode-editor-background))"/><path d="M18 15v4m-2-2h4"/>',
  refresh: '<path d="M3 2v6h6M21 22v-6h-6M21 12a9 9 0 0 0-15-6.7L3 8m0 4a9 9 0 0 0 15 6.7L21 16"/>',
  build: '<rect x="8.5" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  external: '<path d="M10 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4M15 4h5v5m-8 3 8-8"/>',
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


function renderProjectWebview({ projects = [], buildComponents = [], selectedProject, selectedProjectRunning = false, isRefreshing = false, discoveryError, animation = {}, assetUris = { css: '', client: '' }, cspSource = '', strings = {} }) {
    const projectRows = projects.map(project => {
      const projectId = escapeHtml(project.applicationFile);
      const selected = selectedProject === project.applicationFile;
      const chevronAnimation = animation?.projectChevronAnimations?.get(project.applicationFile);
      const chevronClasses = ['chevron-icon', selected ? 'expanded' : '', chevronAnimation ? `animate-${chevronAnimation}` : '']
        .filter(Boolean).join(' ');
      return `
        <button type="button" class="project-row ${selected ? 'selected' : ''}" data-select="${projectId}" data-context-kind="project" data-context-project="${projectId}" data-vscode-context='{"webviewSection":"project","preventDefaultContextMenuItems":true}' aria-pressed="${selected}">
          <span class="${chevronClasses}">${iconSvg('chevron')}</span><span class="project-icon">${iconSvg('folder')}</span>
          <span class="project-name">${escapeHtml(project.label)}</span><small>${escapeHtml(getProjectDisplayPath(project))}</small>
        </button>`;
    }).join('');

    const project = projects.find(item => item.applicationFile === selectedProject);
    const emptyState = isRefreshing
      ? strings.emptySearching || 'Searching for Dagor projects…'
      : discoveryError
        ? strings.emptySearchFailed || 'Dagor project search failed.'
        : strings.emptyNoProjects || 'No Dagor projects found. Open a workspace containing application.blk and prog/build.py.';
    let projectActions = '';
    if (project) {
      const projectId = escapeHtml(project.applicationFile);
      const running = selectedProjectRunning;
      const scenes = project.scenes.map(scene => `
        <button type="button" class="scene" data-scene="${escapeHtml(scene.uri.fsPath)}" data-context-kind="scene" data-context-project="${projectId}" data-context-path="${escapeHtml(scene.uri.fsPath)}" data-vscode-context='{"webviewSection":"scene","preventDefaultContextMenuItems":true}' title="${escapeHtml(scene.relativePath)}">
          <span class="scene-icon">${iconSvg('scene')}</span><span>${escapeHtml(scene.label)}</span><small>${escapeHtml(scene.relativePath)}</small>
        </button>`).join('');
      const games = project.games.map(game => `
        <button type="button" class="scene game" data-game="${escapeHtml(game.executable)}" data-context-kind="game" data-context-project="${projectId}" data-context-path="${escapeHtml(game.executable)}" data-vscode-context='{"webviewSection":"resource","preventDefaultContextMenuItems":true}' title="${escapeHtml(path.relative(project.root, game.executable))}">
          <span class="game-icon">${iconSvg('play')}</span><span>${escapeHtml(game.label)}</span><small>${escapeHtml(path.relative(project.root, game.executable))}</small>
        </button>`).join('');
      const gameCommands = project.gameCommands.map(command => `
        <button type="button" class="scene game-command" data-game-command="${escapeHtml(command.command)}" data-context-kind="command" data-context-project="${projectId}" data-context-path="${escapeHtml(command.command)}" data-vscode-context='{"webviewSection":"commandItem","preventDefaultContextMenuItems":true}' title="${escapeHtml(command.invocation || command.command)}">
          <span class="command-icon">${iconSvg('terminal')}</span><span>${escapeHtml(command.label)}</span><small>${escapeHtml(path.relative(project.root, command.command))}</small>
        </button>`).join('');
      const buildItems = buildComponents.map(item => `
        <label class="component"><input type="checkbox" value="${item.value}" checked><span>${item.label}</span></label>`).join('');
      projectActions = `
        <section class="project-actions${animation?.animateProjectPanel ? ' opening' : ''}"${animation?.animateProjectPanel ? ` style="height:${animation?.projectPanelFromHeight ?? 0}px"` : ''} data-project="${projectId}" data-running="${running}">
          <div class="action-grid">
            <div class="action-group">
          <button type="button" class="action build-toggle" data-action="build" data-context-kind="build" data-context-project="${projectId}" data-vscode-context='{"webviewSection":"build","preventDefaultContextMenuItems":true}' aria-expanded="${running}" aria-label="${escapeHtml(strings.buildProject || 'Build Project')}" title="${escapeHtml(strings.buildProjectTooltip || 'Show or hide build options')}">${iconSvg('build')} <span>${escapeHtml(strings.buildProject || 'Build Project')}</span><span class="end-chevron ${running ? 'expanded' : ''}" aria-hidden="true">${iconSvg('chevron')}</span></button>
              <div class="components ${running ? 'visible' : ''}"><div class="caption">${escapeHtml(strings.selectComponents || 'Select components to build:')}</div>${buildItems}<button type="button" class="build-submit ${running ? 'running' : ''}" data-action="submitBuild" data-build-label="${escapeHtml(strings.build || 'Build')}" data-stop-build-label="${escapeHtml(strings.stopBuild || 'Stop Build')}" aria-label="${escapeHtml(running ? strings.stopBuild || 'Stop Build' : strings.build || 'Build')}"><span class="build-icon">${iconSvg('play', 'build-start-icon')}${iconSvg('stop', 'build-stop-icon')}</span> <span class="build-label">${escapeHtml(running ? strings.stopBuild || 'Stop Build' : strings.build || 'Build')}</span></button></div>
              <button type="button" class="action" data-action="viewer" data-vscode-context='{"preventDefaultContextMenuItems":true}' title="${escapeHtml(strings.openDaViewerTooltip || 'Open the selected project in daViewer')}">${iconSvg('external')} <span>${escapeHtml(strings.openDaViewer || 'Open daViewer')}</span></button>
            </div>
            <div class="scene-group"><button type="button" class="action scene-heading" data-action="toggleScenes" data-context-kind="sceneGroup" data-context-project="${projectId}" data-vscode-context='{"webviewSection":"sceneGroup","preventDefaultContextMenuItems":true}' aria-expanded="true" title="${escapeHtml(strings.openSceneTooltip || 'Show or hide scenes in develop/levels')}">${iconSvg('scene')} <span>${escapeHtml(strings.openScene || 'Open Scene')}</span><span class="end-chevron expanded">${iconSvg('chevron')}</span></button><div class="scene-list">${scenes || `<div class="empty">${escapeHtml(strings.scenesLocation || 'Scenes should be located in develop/levels')}</div>`}<button type="button" class="scene create-scene" data-create-scene data-vscode-context='{"preventDefaultContextMenuItems":true}' title="${escapeHtml(strings.createSceneTooltip || 'Create a blank scene or start from a template')}"><span class="command-icon" aria-hidden="true">${iconSvg('plus')}</span><span>${escapeHtml(strings.createScene || 'Create Scene')}</span></button></div></div>
            <div class="scene-group game-group"><button type="button" class="action scene-heading" data-action="toggleGames" data-vscode-context='{"preventDefaultContextMenuItems":true}' aria-expanded="true" title="${escapeHtml(strings.runGameTooltip || 'Show or hide game executables in game/ or one folder below')}"><span class="game-heading-icon">${iconSvg('play')}</span><span>${escapeHtml(strings.runGame || 'Run Game')}</span><span class="end-chevron expanded">${iconSvg('chevron')}</span></button><div class="game-list">${games || `<div class="empty">${escapeHtml(strings.gamesLocation || 'Game executables should be located in game/ or one folder below')}</div>`}</div></div>
            <div class="scene-group command-group"><button type="button" class="action scene-heading" data-action="toggleGameCommands" data-context-kind="commandGroup" data-context-project="${projectId}" data-vscode-context='{"webviewSection":"command","preventDefaultContextMenuItems":true}' aria-expanded="true" title="${escapeHtml(strings.runCommandTooltip || 'Show or hide command files in game/')}"><span class="command-icon">${iconSvg('terminal')}</span><span>${escapeHtml(strings.runCommand || 'Run Command')}</span><span class="end-chevron expanded">${iconSvg('chevron')}</span></button><div class="game-command-list">${gameCommands || `<div class="empty">${escapeHtml(strings.commandsLocation || 'Command files should be located in game/')}</div>`}<button type="button" class="scene create-command" data-create-command data-context-project="${projectId}" data-vscode-context='{"preventDefaultContextMenuItems":true}' title="${escapeHtml(strings.createCommandTooltip || 'Create and open a .cmd file in this project\'s game/ folder')}"><span class="command-icon" aria-hidden="true">${iconSvg('plus')}</span><span>${escapeHtml(strings.createCommand || 'Create Command')}</span></button></div></div>
          </div>
        </section>`;
      projectActions = projectActions.replace(
        /<div class="action-group">([\s\S]*?)<\/div>\s*<button type="button" class="action" data-action="viewer">/,
        '<div class="action-group">$1</div><button type="button" class="action" data-action="viewer">'
      );
    }

    return `<!DOCTYPE html><html lang="${escapeHtml(strings.language || 'en')}"><head><meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${escapeHtml(cspSource)} 'unsafe-inline'; script-src ${escapeHtml(cspSource)};">
      <meta name="viewport" content="width=device-width,initial-scale=1.0"><link rel="stylesheet" href="${escapeHtml(assetUris.css)}"></head><body>      <main><div class="toolbar"><button type="button" id="refresh" class="icon-button" title="${escapeHtml(strings.refreshTooltip || 'Search the engine root folder for Dagor projects')}" data-vscode-context='{"preventDefaultContextMenuItems":true}' ${isRefreshing ? 'disabled' : ''}>${iconSvg('refresh')} ${escapeHtml(strings.refresh || 'Refresh')}</button></div><div class="project-list">${projectRows || `<div class="empty">${emptyState}</div>`}</div><div class="add-project-row"><button type="button" id="add-project" class="add-project-button" title="${escapeHtml(strings.createProjectTooltip || 'Create a starter project in the DagorEngine root')}" data-vscode-context='{"preventDefaultContextMenuItems":true}' ${isRefreshing ? 'disabled' : ''}><span class="chevron-icon add-project-spacer" aria-hidden="true">${iconSvg('chevron')}</span><span class="project-icon">${iconSvg('folderPlus')}</span><span class="add-project-label">${escapeHtml(strings.createProject || 'Create Project')}</span></button></div>${projectActions}</main>
      <script src="${escapeHtml(assetUris.client)}"></script></body></html>`;
}

module.exports = { renderProjectWebview };
