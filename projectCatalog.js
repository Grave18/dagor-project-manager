const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

function getWorkspaceRoots() {
  return (vscode.workspace.workspaceFolders || []).map(folder => folder.uri.fsPath);
}

function findBuildScript(projectRoot) {
  const candidates = [
    path.join(projectRoot, 'prog', 'build.py'),
    path.join(projectRoot, 'build.py')
  ];
  return candidates.find(candidate => fs.existsSync(candidate));
}

function findGameFiles(projectRoot, extension, includeImmediateSubdirectories = true) {
  const gameRoot = path.join(projectRoot, 'game');
  const directories = [gameRoot];
  if (includeImmediateSubdirectories) {
    try {
      for (const entry of fs.readdirSync(gameRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) directories.push(path.join(gameRoot, entry.name));
      }
    } catch {
      return [];
    }
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
  return findGameFiles(projectRoot, '.cmd', false)
    .map(item => ({ command: item.file, label: item.label, ...findGameCommandInvocation(item.file) }));
}

function parseCommandLineArguments(commandLine) {
  const args = [];
  let argument = '';
  let quoted = false;

  for (let index = 0; index < commandLine.length; index += 1) {
    const character = commandLine[index];
    if (character === '"') {
      quoted = !quoted;
    } else if (/\s/.test(character) && !quoted) {
      if (argument) args.push(argument);
      argument = '';
    } else {
      argument += character;
    }
  }
  if (argument) args.push(argument);
  return args.filter(argument => argument !== '%*');
}

function findGameCommandInvocation(commandFile) {
  let contents;
  try {
    contents = fs.readFileSync(commandFile, 'utf8');
  } catch {
    return { invocation: undefined };
  }

  const lines = contents.replace(/\^\s*\r?\n\s*/g, ' ').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*@?(?:start\s+(?:"[^"]*"\s+)?|call\s+)?(?:"([^\"]+\.exe)"|([^\s"]+\.exe))(?=\s|$)(.*)$/i);
    if (!match) continue;
    const executable = (match[1] || match[2]).split(/[\\/]/).pop();
    const args = match[3].trim();
    return {
      executableName: executable,
      launchArgs: parseCommandLineArguments(args),
      invocation: [executable, args].filter(Boolean).join(' ')
    };
  }

  return { invocation: undefined };
}

class ProjectCatalog {
  constructor({ ensureExecutableWatcher = () => {} } = {}) {
    this.ensureExecutableWatcher = ensureExecutableWatcher;
    this.projects = [];
    this.refreshPromise = undefined;
    this.isRefreshing = false;
    this.discoveryError = undefined;
    this.onDidChange = new vscode.EventEmitter();
  }

  refresh() {
    this.ensureExecutableWatcher();
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

      const workspaceProjects = [...projects.values()]
        .filter(project => project.workspaceRoot === workspaceRoot);
      for (const project of workspaceProjects) {
        const levelsRoot = path.join(project.root, 'develop', 'levels');
        const scenePattern = new vscode.RelativePattern(levelsRoot, '**/*.level.blk');
        const sceneFiles = await vscode.workspace.findFiles(scenePattern, exclude);
        for (const sceneUri of sceneFiles) {
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

module.exports = {
  ProjectCatalog,
  findBuildScript,
  findGameFiles,
  findGameExecutables,
  findGameCommandFiles,
  getWorkspaceRoots
};
