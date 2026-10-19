const path = require('node:path');
const { findBuildScript } = require('../projects/projectCatalog');

const BUILD_COMPONENTS = [
  { label: 'Code', description: 'Build game and code binaries', value: 'code' },
  { label: 'Shaders', description: 'Compile shaders', value: 'shaders' },
  { label: 'Assets', description: 'Build project assets', value: 'assets' },
  { label: 'Vromfs', description: 'Pack virtual file systems', value: 'vromfs' },
  { label: 'Gui', description: 'Build GUI data', value: 'gui' }
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
    output?.appendLine('[DAGOR_PM] Created game executable watcher (**/game/**/*.exe).');
    this.gameExecutableWatcherOutput = undefined;
  }

  ensureExecutableWatcher() {
    if (!this.gameExecutableWatcher && this.runningBuilds.size === 0) this.createGameExecutableWatcher();
  }

  start(project, components, onBuildStateChange = () => {}) {
    if (!project?.root) {
      this.vscode.window.showErrorMessage('Select a Dagor project in the sidebar.');
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
      this.vscode.window.showErrorMessage(`Cannot find build.py for project ${project.label}.`);
      return;
    }

    const output = this.vscode.window.createOutputChannel(`Dagor Build: ${project.label}`);
    output.show(true);
    output.appendLine(`[DAGOR_PM] Running: ${script} ${selected.join(' ')}`);
    const python = this.vscode.workspace.getConfiguration('dagorProjectManager').get('pythonExecutable') || 'python';
    const child = this.spawn(python, [script, ...selected], {
      cwd: path.dirname(script),
      windowsHide: true
    });
    onBuildStateChange(true);
    if (this.gameExecutableWatcher) {
      this.gameExecutableWatcher.dispose();
      output.appendLine('[DAGOR_PM] Disposed game executable watcher (**/game/**/*.exe) for build.');
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
      output.appendLine(`\n[DAGOR_PM] Failed to start build: ${error.message}`);
      this.vscode.window.showErrorMessage(`Failed to start Dagor build: ${error.message}`);
      finishBuild();
    });
    child.once('exit', (code, signal) => {
      output.appendLine(`\n[DAGOR_PM] Build finished with ${signal ? `signal ${signal}` : `exit code ${code}`}.`);
      finishBuild();
    });
    child.once('close', finishBuild);
  }

  stop(project, onBuildStateChange = () => {}) {
    const key = project?.root && path.resolve(project.root);
    const build = key && this.runningBuilds.get(key);
    if (!build) {
      this.vscode.window.showInformationMessage(`No Dagor build is running for ${project?.label || 'this project'}.`);
      return;
    }

    build.output.appendLine('\n[DAGOR_PM] Build cancellation requested.');
    const stopped = process.platform === 'win32'
      ? this.spawn('taskkill', ['/pid', String(build.child.pid), '/t', '/f'], { windowsHide: true })
      : (build.child.kill('SIGTERM'), undefined);
    stopped?.once('error', error => this.vscode.window.showErrorMessage(`Failed to stop build: ${error.message}`));
    build.finishBuild();
  }
}

module.exports = { BuildManager, BUILD_COMPONENTS };
