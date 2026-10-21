const path = require('node:path');

const ICON_PATHS = {
  chevron: '<path d="m9 18 6-6-6-6"/>',
  folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H10l2 2h7.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  folderPlus: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H10l2 2h7.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><circle cx="18" cy="17" r="4" fill="var(--vscode-sideBar-background, var(--vscode-editor-background))"/><path d="M18 15v4m-2-2h4"/>',
  refresh: '<path d="M3 2v6h6M21 22v-6h-6M21 12a9 9 0 0 0-15-6.7L3 8m0 4a9 9 0 0 0 15 6.7L21 16"/>',
  // Adapted from Microsoft's Codicon gear, licensed under CC BY 4.0: https://github.com/microsoft/vscode-codicons/blob/main/src/icons/gear.svg
  settings: '<path d="M7.99997 6C6.89497 6 5.99997 6.895 5.99997 8C5.99997 9.105 6.89497 10 7.99997 10C9.10497 10 9.99997 9.105 9.99997 8C9.99997 6.895 9.10497 6 7.99997 6ZM7.99997 9C7.44797 9 6.99997 8.552 6.99997 8C6.99997 7.448 7.44797 7 7.99997 7C8.55197 7 8.99997 7.448 8.99997 8C8.99997 8.552 8.55197 9 7.99997 9ZM14.565 9.715L13.279 8.628C13.245 8.599 13.213 8.567 13.184 8.533C12.888 8.186 12.931 7.667 13.279 7.372L14.565 6.285C14.693 6.177 14.742 6.003 14.691 5.844C14.386 4.903 13.882 4.04 13.219 3.308C13.139 3.22 13.027 3.172 12.912 3.172C12.865 3.172 12.818 3.18 12.773 3.196L11.186 3.761C11.144 3.776 11.1 3.788 11.056 3.796C11.006 3.805 10.956 3.81 10.907 3.81C10.515 3.81 10.167 3.532 10.094 3.134L9.79097 1.482C9.76097 1.318 9.63397 1.188 9.46997 1.153C8.98997 1.051 8.49897 1 8.00097 1C7.50297 1 7.01097 1.052 6.53097 1.153C6.36697 1.188 6.23997 1.318 6.20997 1.482L5.90797 3.134C5.89997 3.178 5.88797 3.221 5.87297 3.263C5.75197 3.6 5.43397 3.81 5.09397 3.81C5.00197 3.81 4.90797 3.794 4.81597 3.762L3.22897 3.197C3.18397 3.181 3.13597 3.173 3.08997 3.173C2.97497 3.173 2.86297 3.221 2.78297 3.309C2.11897 4.041 1.61597 4.904 1.30997 5.845C1.25797 6.004 1.30797 6.178 1.43597 6.286L2.72197 7.373C2.75597 7.402 2.78797 7.434 2.81697 7.468C3.11297 7.815 3.06997 8.334 2.72197 8.629L1.43597 9.716C1.30797 9.824 1.25897 9.998 1.30997 10.157C1.61497 11.098 2.11897 11.961 2.78297 12.693C2.86297 12.781 2.97497 12.829 3.08997 12.829C3.13697 12.829 3.18397 12.821 3.22897 12.805L4.81597 12.24C4.85797 12.225 4.90197 12.213 4.94597 12.205C4.99597 12.196 5.04597 12.192 5.09497 12.192C5.48697 12.192 5.83497 12.47 5.90797 12.868L6.20997 14.52C6.23997 14.684 6.36697 14.814 6.53097 14.849C7.01097 14.951 7.50297 15.002 8.00097 15.002C8.49897 15.002 8.99097 14.95 9.46997 14.849C9.63397 14.814 9.76097 14.684 9.79097 14.52L10.094 12.868C10.102 12.824 10.114 12.781 10.129 12.739C10.25 12.402 10.568 12.192 10.908 12.192C11 12.192 11.094 12.208 11.186 12.24L12.772 12.805C12.818 12.821 12.865 12.829 12.911 12.829C13.026 12.829 13.138 12.781 13.218 12.693C13.882 11.961 14.385 11.098 14.69 10.157C14.742 9.998 14.692 9.824 14.564 9.716L14.565 9.715ZM12.728 11.726L11.521 11.296C11.323 11.226 11.117 11.19 10.908 11.19C10.139 11.19 9.44697 11.676 9.18797 12.399C9.15397 12.492 9.12897 12.588 9.11097 12.686L8.88097 13.937C8.59097 13.979 8.29597 14 8.00097 14C7.70597 14 7.41097 13.979 7.11997 13.936L6.89097 12.685C6.73197 11.818 5.97697 11.189 5.09497 11.189C4.98697 11.189 4.87697 11.199 4.76597 11.219C4.66897 11.237 4.57397 11.262 4.47997 11.295L3.27297 11.725C2.90497 11.264 2.61097 10.759 2.39397 10.214L3.36797 9.391C3.74097 9.076 3.96797 8.634 4.00797 8.148C4.04797 7.662 3.89497 7.19 3.57797 6.818C3.51397 6.743 3.44297 6.672 3.36797 6.608L2.39397 5.785C2.61097 5.24 2.90497 4.734 3.27297 4.274L4.47997 4.704C4.67797 4.774 4.88397 4.81 5.09397 4.81C5.86297 4.81 6.55497 4.324 6.81397 3.601C6.84797 3.507 6.87297 3.411 6.89097 3.314L7.11997 2.063C7.41097 2.021 7.70597 1.999 8.00097 1.999C8.29597 1.999 8.59097 2.02 8.88097 2.062L9.10997 3.313C9.26897 4.18 10.024 4.809 10.906 4.809C11.014 4.809 11.124 4.799 11.234 4.779C11.331 4.761 11.427 4.736 11.521 4.703L12.728 4.273C13.096 4.733 13.39 5.239 13.607 5.784L12.634 6.607C12.261 6.922 12.033 7.364 11.994 7.85C11.954 8.336 12.107 8.809 12.424 9.18C12.489 9.256 12.559 9.326 12.635 9.39L13.609 10.213C13.392 10.758 13.098 11.264 12.73 11.724L12.728 11.726Z"/>',
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
  if (name === 'settings') {
    return `<svg class="${classes}" viewBox="0 0 16 16" fill="currentColor" stroke="none" aria-hidden="true" focusable="false">${ICON_PATHS[name]}</svg>`;
  }
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
      <meta name="viewport" content="width=device-width,initial-scale=1.0"><link rel="stylesheet" href="${escapeHtml(assetUris.css)}"></head><body>      <main><div class="toolbar"><button type="button" id="open-settings" class="icon-button settings-button" title="${escapeHtml(strings.openSettingsTooltip || 'Open Dagor Project Manager settings')}" aria-label="${escapeHtml(strings.openSettingsTooltip || 'Open Dagor Project Manager settings')}" data-vscode-context='{"preventDefaultContextMenuItems":true}'>${iconSvg('settings')}</button><button type="button" id="refresh" class="icon-button" title="${escapeHtml(strings.refreshTooltip || 'Search the engine root folder for Dagor projects')}" data-vscode-context='{"preventDefaultContextMenuItems":true}' ${isRefreshing ? 'disabled' : ''}>${iconSvg('refresh')} ${escapeHtml(strings.refresh || 'Refresh')}</button></div><div class="project-list">${projectRows || `<div class="empty">${emptyState}</div>`}</div><div class="add-project-row"><button type="button" id="add-project" class="add-project-button" title="${escapeHtml(strings.createProjectTooltip || 'Create a starter project in the DagorEngine root')}" data-vscode-context='{"preventDefaultContextMenuItems":true}' ${isRefreshing ? 'disabled' : ''}><span class="chevron-icon add-project-spacer" aria-hidden="true">${iconSvg('chevron')}</span><span class="project-icon">${iconSvg('folderPlus')}</span><span class="add-project-label">${escapeHtml(strings.createProject || 'Create Project')}</span></button></div>${projectActions}</main>
      <script src="${escapeHtml(assetUris.client)}"></script></body></html>`;
}

module.exports = { renderProjectWebview };
