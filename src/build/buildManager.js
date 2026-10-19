const path = require('node:path');
const vscode = require('vscode');
const { findBuildScript } = require('../projects/projectCatalog');

const BUILD_COMPONENTS = [
  { label: 'Code', value: 'code' },
  { label: 'Shaders', value: 'shaders' },
  { label: 'Assets', value: 'assets' },
  { label: 'Vromfs', value: 'vromfs' },
  { label: 'Gui', value: 'gui' }
];
const INTERNAL_BUILD_COMPONENTS = new Set(['editor_shaders']);

class BuildManager {
  constructor({ vscodeApi, spawnProcess, refreshCatalog, subscriptions }) {
    this.vscode = vscodeApi;
    this.spawn = spawnProcess;
    this.refreshCatalog = refreshCatalog;
    this.subscriptions = subscriptions;
    this.runningBuilds = new Map();
    this.gameExecutableWatcher = undefined;
    this.gameExecutableWatcherOutput = undefined;
  }

  isRunning(project) {
    const root = typeof project === 'string' ? project : project?.root;
    return Boolean(root && this.runningBuilds.has(path.resolve(root)));
  }

  createGameExecutableWatcher(output = this.gameExecutableWatcherOutput) {
    const watcher = this.vscode.workspace.createFileSystemWatcher('**/game/**/*.exe');
    this.gameExecutableWatcher = watcher;
    this.subscriptions?.push(watcher);
    this.subscriptions?.push(watcher.onDidCreate(() => this.refreshCatalog?.()));
    this.subscriptions?.push(watcher.onDidDelete(() => this.refreshCatalog?.()));
    this.subscriptions?.push(watcher.onDidChange(() => this.refreshCatalog?.()));
    output?.appendLine(`[DAGOR_PM] ${vscode.l10n.t('Created game executable watcher ({pattern}).', { pattern: '**/game/**/*.exe' })}`);
    this.gameExecutableWatcherOutput = undefined;
  }

  ensureExecutableWatcher() {
    if (!this.gameExecutableWatcher && this.runningBuilds.size === 0) this.createGameExecutableWatcher();
  }

  start(project, components, onBuildStateChange = () => {}) {
    if (!project?.root) {
      this.vscode.window.showErrorMessage(vscode.l10n.t('Select a Dagor project in the sidebar.'));
      return;
    }
    const selected = Array.isArray(components)
      ? components.filter(component =>
        BUILD_COMPONENTS.some(item => item.value === component) || INTERNAL_BUILD_COMPONENTS.has(component))
      : [];
    const key = path.resolve(project.root);
    if (this.runningBuilds.has(key)) {
      this.stop(project, onBuildStateChange);
      return;
    }
    if (selected.length === 0) return;

    const script = findBuildScript(project.root);
    if (!script) {
      this.vscode.window.showErrorMessage(vscode.l10n.t('Cannot find build.py for project {project}.', { project: project.label }));
      return;
    }

    const output = this.vscode.window.createOutputChannel(vscode.l10n.t('Dagor Build: {project}', { project: project.label }));
    output.show(true);
    output.appendLine(`[DAGOR_PM] ${vscode.l10n.t('Running: {script} {components}', { script, components: selected.join(' ') })}`);
    const python = this.vscode.workspace.getConfiguration('dagorProjectManager').get('pythonExecutable') || 'python';
    const child = this.spawn(python, [script, ...selected], {
      cwd: path.dirname(script),
      windowsHide: true
    });
    onBuildStateChange(true);
    if (this.gameExecutableWatcher) {
      this.gameExecutableWatcher.dispose();
      output.appendLine(`[DAGOR_PM] ${vscode.l10n.t('Disposed game executable watcher ({pattern}) for build.', { pattern: '**/game/**/*.exe' })}`);
      this.gameExecutableWatcherOutput = output;
      this.gameExecutableWatcher = undefined;
    }
    child.stdout?.on('data', data => output.append(data.toString()));
    child.stderr?.on('data', data => output.append(data.toString()));
    let finished = false;
    const finishBuild = () => {
      if (finished) return;
      finished = true;
      this.runningBuilds.delete(key);
      onBuildStateChange(false);
      if (!this.gameExecutableWatcher && this.runningBuilds.size === 0) this.createGameExecutableWatcher(output);
    };
    this.runningBuilds.set(key, { child, finishBuild, output });
    child.once('error', error => {
      output.appendLine(`\n[DAGOR_PM] ${vscode.l10n.t('Failed to start build: {error}', { error: error.message })}`);
      this.vscode.window.showErrorMessage(vscode.l10n.t('Failed to start Dagor build: {error}', { error: error.message }));
      finishBuild();
    });
    child.once('exit', (code, signal) => {
      const result = signal
        ? vscode.l10n.t('signal {signal}', { signal })
        : vscode.l10n.t('exit code {code}', { code });
      output.appendLine(`\n[DAGOR_PM] ${vscode.l10n.t('Build finished with {result}.', { result })}`);
      finishBuild();
    });
    child.once('close', finishBuild);
  }

  stop(project, onBuildStateChange = () => {}) {
    const key = project?.root && path.resolve(project.root);
    const build = key && this.runningBuilds.get(key);
    if (!build) {
      this.vscode.window.showInformationMessage(vscode.l10n.t('No Dagor build is running for {project}.', { project: project?.label || vscode.l10n.t('this project') }));
      return;
    }

    build.output.appendLine(`\n[DAGOR_PM] ${vscode.l10n.t('Build cancellation requested.')}`);
    const stopped = process.platform === 'win32'
      ? this.spawn('taskkill', ['/pid', String(build.child.pid), '/t', '/f'], { windowsHide: true })
      : (build.child.kill('SIGTERM'), undefined);
    stopped?.once('error', error => this.vscode.window.showErrorMessage(vscode.l10n.t('Failed to stop build: {error}', { error: error.message })));
    build.finishBuild();
  }
}

module.exports = { BuildManager, BUILD_COMPONENTS };
