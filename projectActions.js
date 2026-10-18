const path = require('node:path');
const fs = require('node:fs/promises');

function createProjectActions({ vscodeApi, catalog, toolRunner, buildManager }) {
  const vscode = vscodeApi;

  function isPathWithin(directory, candidate) {
    const relative = path.relative(directory, candidate);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  }

  async function getSceneExportDirectory(project) {
    for (const scene of project.scenes || []) {
      try {
        const contents = await fs.readFile(scene.uri.fsPath, 'utf8');
        const uncommented = contents.replace(/\/\*[\s\S]*?\*\//g, '');
        const exportPath = uncommented.match(/^\s*exportPath\s*:\s*t\s*=\s*"([^"]+)"/im)?.[1];
        if (!exportPath) continue;

        const normalized = exportPath.replace(/\\/g, '/');
        if (/^(?:[a-z]:|\/|\\\\)/i.test(normalized)) continue;
        const safePath = path.posix.normalize(normalized);
        if (safePath === '..' || safePath.startsWith('../')) continue;
        const directory = path.posix.dirname(safePath);
        return directory === '.' ? '' : `${directory}/`;
      } catch {
        // Try another scene if this one cannot be read.
      }
    }
    return undefined;
  }

  async function findProjectForFolder(folderUri) {
    if (!folderUri || folderUri.scheme !== 'file') {
      vscode.window.showErrorMessage('Select a local Dagor project folder in the VS Code Explorer.');
      return undefined;
    }

    try {
      await catalog.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to find Dagor projects: ${error.message}`);
      return undefined;
    }

    const folder = path.resolve(folderUri.fsPath);
    const containingProjects = catalog.projects
      .filter(project => isPathWithin(path.resolve(project.root), folder))
      .sort((left, right) => right.root.length - left.root.length);
    if (containingProjects.length > 0) return containingProjects[0];

    const nestedProjects = catalog.projects.filter(project => isPathWithin(folder, path.resolve(project.root)));
    if (nestedProjects.length === 1) return nestedProjects[0];
    if (nestedProjects.length > 1) {
      const selection = await vscode.window.showQuickPick(
        nestedProjects.map(project => ({
          label: project.label,
          description: path.relative(folder, project.root),
          project
        })),
        { placeHolder: 'Select a Dagor project in this folder', matchOnDescription: true }
      );
      return selection?.project;
    }

    vscode.window.showErrorMessage(`No Dagor project found in or under ${folder}.`);
    return undefined;
  }

  function runProjectGame(project, executable) {
    const game = project.games.find(item => item.executable === executable);
    if (!game) {
      vscode.window.showErrorMessage('Select a valid game executable for this project.');
      return;
    }
    toolRunner.launch(game.executable, [], path.join(project.root, 'game'), { detached: false, windowsHide: false });
  }

  function runProjectGameCommand(project, commandPath) {
    const command = project.gameCommands.find(item => item.command === commandPath);
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
  }

  async function findGameSceneConfig(project, scene) {
    let sceneContents;
    try {
      sceneContents = await fs.readFile(scene.uri.fsPath, 'utf8');
    } catch {
      return undefined;
    }

    const exportPath = sceneContents.match(/\bexportPath:t\s*=\s*"([^"]+)"/i)?.[1];
    const expectedLevelPaths = new Set();
    if (exportPath) {
      expectedLevelPaths.add(exportPath);
      expectedLevelPaths.add(exportPath.replace(/\.bin$/i, '.blk'));
    }
    const projectContentPath = `content/${path.basename(project.root)}/levels/${scene.label}`;
    expectedLevelPaths.add(`${projectContentPath}.blk`);
    expectedLevelPaths.add(`${projectContentPath}.bin`);
    const normalizedExpectedPaths = new Set(
      [...expectedLevelPaths].map(value => value.replace(/\\/g, '/').toLowerCase())
    );
    const progRoot = path.join(project.root, 'prog');
    let configFiles;
    try {
      configFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(progRoot, '**/gamedata/scenes/*.blk'),
        '**/{.git,node_modules}/**'
      );
    } catch {
      return undefined;
    }

    configFiles.sort((left, right) => left.fsPath.localeCompare(right.fsPath));
    for (const configFile of configFiles) {
      let contents;
      try {
        contents = await fs.readFile(configFile.fsPath, 'utf8');
      } catch {
        continue;
      }
      const levelPaths = [...contents.matchAll(/\b(?:level__blk|levelBin)\s*:\s*[a-z]+\s*=\s*"([^"]+)"/gi)]
        .map(match => match[1].replace(/\\/g, '/').toLowerCase());
      if (!levelPaths.some(levelPath => normalizedExpectedPaths.has(levelPath))) continue;

      const relativePath = path.relative(progRoot, configFile.fsPath).replace(/\\/g, '/');
      const gameDataIndex = relativePath.toLowerCase().lastIndexOf('gamedata/');
      if (gameDataIndex < 0) continue;
      return relativePath.slice(gameDataIndex);
    }
    return exportPath?.replace(/\\/g, '/');
  }

  async function runProjectSceneInGame(project, scenePath) {
    const scene = project?.scenes.find(item => item.uri.fsPath === scenePath);
    if (!scene) {
      vscode.window.showErrorMessage('Select a valid scene for this project.');
      return;
    }

    const gameSceneConfig = await findGameSceneConfig(project, scene);
    if (!gameSceneConfig) {
      vscode.window.showErrorMessage(`No game scene configuration found for ${scene.label}.`);
      return;
    }

    const normalizePath = value => value.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
    const matchingCommand = project.gameCommands.find(command => command.launchArgs?.some(argument => {
      const match = argument.match(/^(?:-config:scene:t=|-scene:)(.+)$/i);
      return match && normalizePath(match[1]) === normalizePath(gameSceneConfig);
    }));

    let executable;
    let args;
    if (matchingCommand) {
      executable = project.games.find(game =>
        path.basename(game.executable).toLowerCase() === matchingCommand.executableName?.toLowerCase()
      )?.executable;
      if (!executable) {
        vscode.window.showErrorMessage(`Game executable from ${matchingCommand.label} was not found.`);
        return;
      }
      args = matchingCommand.launchArgs;
    } else {
      if (project.games.length === 0) {
        vscode.window.showErrorMessage(`No game executable found for ${project.label}.`);
        return;
      }
      let game = project.games[0];
      if (project.games.length > 1) {
        const selection = await vscode.window.showQuickPick(
          project.games.map(item => ({
            label: item.label,
            description: path.relative(project.root, item.executable),
            executable: item.executable
          })),
          { placeHolder: `Select a game to run ${scene.label}` }
        );
        if (!selection) return;
        game = selection;
      }
      executable = game.executable;
      args = [`-scene:${gameSceneConfig}`, '-config:disableMenu:b=yes'];
    }

    toolRunner.launch(executable, args, path.join(project.root, 'game'), { detached: false, windowsHide: false });
  }

  async function pickProjectItem(items, placeHolder) {
    if (items.length === 0) {
      vscode.window.showInformationMessage(`No entries available. ${placeHolder}.`);
      return undefined;
    }
    return vscode.window.showQuickPick(items, { placeHolder, matchOnDescription: true });
  }

  async function openProjectScene(project) {
    const selection = await pickProjectItem(
      project.scenes.map(scene => ({ label: scene.label, description: scene.relativePath, uri: scene.uri })),
      `Select a scene in ${project.label}`
    );
    if (selection) await toolRunner.openSceneInDaEditor(selection.uri);
  }

  async function pickProjectGame(project) {
    const selection = await pickProjectItem(
      project.games.map(game => ({
        label: game.label,
        description: path.relative(project.root, game.executable),
        executable: game.executable
      })),
      `Select a game to run in ${project.label}`
    );
    if (selection) runProjectGame(project, selection.executable);
  }

  async function pickProjectGameCommand(project) {
    const selection = await pickProjectItem(
      project.gameCommands.map(command => ({
        label: command.label,
        description: path.relative(project.root, command.command),
        command: command.command
      })),
      `Select a command to run in ${project.label}`
    );
    if (selection) runProjectGameCommand(project, selection.command);
  }

  async function createProjectGameCommand(project) {
    const name = await vscode.window.showInputBox({
      prompt: `Enter a name for a command in ${project.label}`,
      placeHolder: 'my-command',
      validateInput: value => /^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(value.trim())
        ? undefined
        : 'Use letters, numbers, spaces, underscores, or hyphens; the name must start with a letter or number.'
    });
    if (name === undefined) return;

    const gameDirectory = path.join(project.root, 'game');
    const commandPath = path.join(gameDirectory, `${name.trim()}.cmd`);
    try {
      await fs.mkdir(gameDirectory, { recursive: true });
      await fs.writeFile(commandPath, '', { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        vscode.window.showErrorMessage(`Failed to create command file: ${error.message}`);
        return;
      }
    }

    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(commandPath));
      await vscode.window.showTextDocument(document);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open command file: ${error.message}`);
    }
  }

  async function createProjectScene(project) {
    const name = await vscode.window.showInputBox({
      prompt: `Enter a name for a scene in ${project.label}`,
      placeHolder: 'my-scene',
      validateInput: value => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value.trim())
        ? undefined
        : 'Use letters, numbers, underscores, or hyphens; the name must start with a letter or number.'
    });
    if (name === undefined) return;

    const sceneType = await vscode.window.showQuickPick([
      { label: 'Empty Scene', description: 'Create the level structure without objects.', value: 'empty' },
      { label: 'From Template', description: 'Create a scene with a plane and a cube.', value: 'template' }
    ], { placeHolder: `Choose a starting point for ${name.trim()}` });
    if (!sceneType) return;

    const sceneName = name.trim();
    let projectRoot;
    try {
      projectRoot = await fs.realpath(project.root);
    } catch (error) {
      vscode.window.showErrorMessage(`Cannot safely resolve the project folder: ${error.message}`);
      return;
    }
    let levelsDirectory = projectRoot;
    for (const segment of ['develop', 'levels']) {
      levelsDirectory = path.join(levelsDirectory, segment);
      try {
        await fs.mkdir(levelsDirectory);
      } catch (error) {
        if (error.code !== 'EEXIST') {
          vscode.window.showErrorMessage(`Failed to create scene folder: ${error.message}`);
          return;
        }
      }
      try {
        const directoryInfo = await fs.lstat(levelsDirectory);
        const realDirectory = await fs.realpath(levelsDirectory);
        if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || !isPathWithin(projectRoot, realDirectory)) {
          vscode.window.showErrorMessage(`Cannot create a scene because ${path.relative(projectRoot, levelsDirectory)} is not a regular folder inside the project.`);
          return;
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Cannot safely inspect the scene folder: ${error.message}`);
        return;
      }
    }

    const sceneDirectory = path.join(levelsDirectory, sceneName);
    const levelPath = path.join(sceneDirectory, `${sceneName}.level.blk`);
    try {
      await fs.mkdir(sceneDirectory);
    } catch (error) {
      const message = error.code === 'EEXIST'
        ? `A scene folder already exists: ${sceneDirectory}`
        : `Failed to create scene folder: ${error.message}`;
      vscode.window.showErrorMessage(message);
      return;
    }

    const templateDirectory = path.join(__dirname, 'templates', 'starter-project', 'develop', 'levels', '__PROJECT_NAME__');
    const sceneExportDirectory = await getSceneExportDirectory(project);
    const templateFiles = [
      ['__PROJECT_NAME__.level.blk', `${sceneName}.level.blk`],
      ['__PROJECT_NAME__.level.local.blk', `${sceneName}.level.local.blk`]
    ];
    if (sceneType.value === 'template') {
      templateFiles.push(['heightmapLand/entities.blk', 'heightmapLand/entities.blk']);
    } else {
      templateFiles.push(['heightmapLand/entities.blk', 'heightmapLand/entities.blk', '']);
    }

    try {
      for (const [sourceRelative, destinationRelative, emptyContent] of templateFiles) {
        const destination = path.join(sceneDirectory, destinationRelative);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        if (emptyContent !== undefined) {
          await fs.writeFile(destination, emptyContent, { flag: 'wx' });
        } else {
          const source = path.join(templateDirectory, sourceRelative);
          const sourceInfo = await fs.lstat(source);
          if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) {
            throw new Error(`Scene template file is missing or invalid: ${sourceRelative}`);
          }
          let contents = (await fs.readFile(source, 'utf8')).split('__PROJECT_NAME__').join(sceneName);
          if (path.basename(destination).endsWith('.level.blk') && sceneExportDirectory !== undefined) {
            contents = contents.replace(
              /^\s*exportPath\s*:\s*t\s*=\s*"[^"]+"/im,
              `exportPath:t="${sceneExportDirectory}${sceneName}.bin"`
            );
          }
          await fs.writeFile(destination, contents, { encoding: 'utf8', flag: 'wx' });
        }
      }
    } catch (error) {
      await fs.rm(sceneDirectory, { recursive: true, force: true }).catch(() => {});
      vscode.window.showErrorMessage(`Failed to create scene: ${error.message}`);
      return;
    }

    try {
      await catalog.refresh();
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(levelPath));
      await vscode.window.showTextDocument(document);
    } catch (error) {
      vscode.window.showErrorMessage(`Scene was created but could not be opened: ${error.message}`);
    }
  }

  return {
    findProjectForFolder,
    runProjectGame,
    runProjectGameCommand,
    runProjectSceneInGame,
    openProjectScene,
    pickProjectGame,
    pickProjectGameCommand,
    createProjectGameCommand,
    createProjectScene,
    startBuild: (project, components, onBuildStateChange) => buildManager.start(project, components, onBuildStateChange),
    stopBuild: (project, onBuildStateChange) => buildManager.stop(project, onBuildStateChange),
    openProjectDaViewer: toolRunner.openProjectDaViewer,
    openSceneInDaEditor: toolRunner.openSceneInDaEditor
  };
}

module.exports = { createProjectActions };
