const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { isPathWithin } = require('../utils/pathUtils');

function normalizeReference(value) {
  return value.replace(/\\/g, '/')
    .replace(/(^|\/)\.\//g, '$1')
    .replace(/\/+/g, '/')
    .toLowerCase();
}

function containsPathReference(line, referencePath) {
  let offset = line.indexOf(referencePath);
  while (offset >= 0) {
    const before = line[offset - 1];
    const after = line[offset + referencePath.length];
    if ((!before || !/[a-z0-9_.-]/i.test(before)) && (!after || !/[a-z0-9_.-]/i.test(after))) return true;
    offset = line.indexOf(referencePath, offset + 1);
  }
  return false;
}

function removeBlkComments(contents) {
  let result = '';
  let quote = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < contents.length; index += 1) {
    const current = contents[index];
    const next = contents[index + 1];
    if (lineComment) {
      if (current === '\n') {
        lineComment = false;
        result += current;
      }
      continue;
    }
    if (blockComment) {
      if (current === '*' && next === '/') {
        blockComment = false;
        index += 1;
      } else if (current === '\n') {
        result += current;
      }
      continue;
    }
    if (current === '"' && contents[index - 1] !== '\\') {
      quote = !quote;
      result += current;
      continue;
    }
    if (!quote && current === '/' && next === '/') {
      lineComment = true;
      index += 1;
    } else if (!quote && current === '/' && next === '*') {
      blockComment = true;
      index += 1;
    } else {
      result += current;
    }
  }
  return result;
}

async function inspectSceneTree(directory) {
  const files = [];
  const symbolicLinks = [];
  const errors = [];
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    errors.push({ path: directory, message: error.message });
    return { files, symbolicLinks, errors };
  }

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await inspectSceneTree(entryPath);
      files.push(...nested.files);
      symbolicLinks.push(...nested.symbolicLinks);
      errors.push(...nested.errors);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.level.blk')) {
      files.push(entryPath);
    } else if (entry.isSymbolicLink()) {
      symbolicLinks.push(entryPath);
    }
  }
  return { files, symbolicLinks, errors };
}

async function existingFile(filePath) {
  try {
    const details = await fs.lstat(filePath);
    return details.isFile() && !details.isSymbolicLink();
  } catch {
    return false;
  }
}

async function findExportTargets(vscode, project, scenePath, levelContents) {
  const uncommentedContents = removeBlkComments(levelContents);
  const exportPath = uncommentedContents.match(/^\s*exportPath\s*:\s*t\s*=\s*"([^"]+)"/im)?.[1];
  if (!exportPath) return { exportPath: undefined, targets: [], warning: vscode.l10n.t('The level has no exportPath; no game export can be identified.') };

  const normalized = exportPath.replace(/\\/g, '/');
  if (/^(?:[a-z]:|\/|\\\\)/i.test(normalized)) {
    return { exportPath, targets: [], warning: vscode.l10n.t('The exportPath is not project-relative and was left untouched: {path}', { path: exportPath }) };
  }

  const gameRoot = path.resolve(project.root, 'game');
  const projectRoot = await fs.realpath(project.root);
  let realGameRoot;
  try {
    realGameRoot = await fs.realpath(gameRoot);
  } catch {
    return { exportPath, targets: [], warning: vscode.l10n.t('The project game/ folder could not be resolved; export was left untouched: {path}', { path: exportPath }) };
  }
  if (!isPathWithin(projectRoot, realGameRoot)) {
    return { exportPath, targets: [], warning: vscode.l10n.t('The project game/ folder resolves outside the project; export was left untouched: {path}', { path: exportPath }) };
  }
  const exportFile = path.resolve(gameRoot, ...normalized.split('/'));
  if (!isPathWithin(gameRoot, exportFile)) {
    return { exportPath, targets: [], warning: vscode.l10n.t('The exportPath resolves outside game/ and was left untouched: {path}', { path: exportPath }) };
  }
  const extension = path.extname(exportFile).toLowerCase();
  if (extension !== '.bin' && extension !== '.blk') {
    return { exportPath, targets: [], warning: vscode.l10n.t('The exportPath does not identify a .bin or .blk scene export and was left untouched: {path}', { path: exportPath }) };
  }
  const basename = exportFile.slice(0, exportFile.length - path.extname(exportFile).length);
  const candidates = [`${basename}.bin`, `${basename}.blk`];
  const uniqueCandidates = [...new Set(candidates.map(candidate => path.resolve(candidate)))];
  const targets = [];
  const missing = [];
  for (const candidate of uniqueCandidates) {
    if (!isPathWithin(gameRoot, candidate)) continue;
    if (!await existingFile(candidate)) {
      missing.push(candidate);
      continue;
    }
    try {
      const realCandidate = await fs.realpath(candidate);
      if (isPathWithin(realGameRoot, realCandidate)) targets.push(candidate);
      else missing.push(candidate);
    } catch {
      missing.push(candidate);
    }
  }

  return {
    exportPath,
    targets,
    warning: targets.length === 0
      ? vscode.l10n.t('No exported file was found for exportPath: {path}', { path: exportPath })
      : missing.length > 0
        ? vscode.l10n.t('Some expected export files were not found or were outside game/: {paths}', { paths: missing.join(', ') })
        : undefined
  };
}

async function findSceneReferences(vscode, project, sceneDirectory, scenePath, exportPath, exportTargets) {
  const references = [];
  const referenceValues = new Set();
  if (exportPath) {
    referenceValues.add(normalizeReference(exportPath));
    const withoutExtension = exportPath.replace(/\.(?:bin|blk)$/i, '');
    referenceValues.add(normalizeReference(`${withoutExtension}.bin`));
    referenceValues.add(normalizeReference(`${withoutExtension}.blk`));
  }
  for (const target of exportTargets) {
    referenceValues.add(normalizeReference(path.relative(path.join(project.root, 'game'), target)));
    referenceValues.add(normalizeReference(target));
  }
  referenceValues.delete('');
  if (referenceValues.size === 0) return { references, error: undefined };

  const exclude = '**/{.git,node_modules,_output,compiledShaders}/**';
  const patterns = ['**/*.blk', '**/*.json'];
  const files = new Map();
  try {
    for (const pattern of patterns) {
      const matches = await vscode.workspace.findFiles(new vscode.RelativePattern(project.root, pattern), exclude);
      for (const match of matches) files.set(path.resolve(match.fsPath), match.fsPath);
    }
  } catch (error) {
    return { references, error: error.message };
  }

  const ignoredDirectory = path.resolve(sceneDirectory);
  const ignoredScene = path.resolve(scenePath);
  const ignoredExports = new Set(exportTargets.map(filePath => path.resolve(filePath)));
  const generatedDirectories = [
    path.resolve(project.root, 'game', 'content'),
    path.resolve(project.root, 'game', 'res'),
    path.resolve(project.root, 'game', 'compiledShaders')
  ];
  for (const filePath of files.values()) {
    const absolutePath = path.resolve(filePath);
    if (absolutePath === ignoredScene ||
        isPathWithin(ignoredDirectory, absolutePath) ||
        ignoredExports.has(absolutePath) ||
        generatedDirectories.some(directory => isPathWithin(directory, absolutePath))) continue;

    let contents;
    try {
      contents = await fs.readFile(absolutePath, 'utf8');
    } catch {
      continue;
    }
    const lines = contents.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const normalizedLine = normalizeReference(lines[index]);
      if (!Array.from(referenceValues).some(value => containsPathReference(normalizedLine, value))) continue;
      references.push({
        file: path.relative(project.root, absolutePath),
        line: index + 1,
        text: lines[index].trim()
      });
    }
  }

  references.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
  return { references, error: undefined };
}

async function inspectSceneDeletion(vscodeApi, project, scenePath) {
  const vscode = vscodeApi;
  const levelPath = path.resolve(scenePath);
  const levelsRoot = path.resolve(project.root, 'develop', 'levels');
  if (!isPathWithin(levelsRoot, levelPath) || !levelPath.toLowerCase().endsWith('.level.blk')) {
    throw new Error(vscode.l10n.t('The selected file is not a scene in this project’s develop/levels folder.'));
  }

  const sceneDirectory = path.dirname(levelPath);
  const projectRoot = path.resolve(project.root);
  let realProjectRoot;
  let realLevelsRoot;
  try {
    [realProjectRoot, realLevelsRoot] = await Promise.all([
      fs.realpath(projectRoot),
      fs.realpath(levelsRoot)
    ]);
    if (!isPathWithin(realProjectRoot, realLevelsRoot)) {
      throw new Error(vscode.l10n.t('The develop/levels folder resolves outside the project.'));
    }
  } catch (error) {
    throw new Error(vscode.l10n.t('Scene folder could not be safely resolved: {error}', { error: error.message }));
  }
  let directoryInfo;
  try {
    directoryInfo = await fs.lstat(sceneDirectory);
  } catch (error) {
    throw new Error(vscode.l10n.t('Scene folder could not be inspected: {error}', { error: error.message }));
  }
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new Error(vscode.l10n.t('The scene folder is not a regular directory, so it cannot be safely deleted.'));
  }
  const sourceFileInfo = await fs.lstat(levelPath).catch(() => undefined);
  if (!sourceFileInfo?.isFile() || sourceFileInfo.isSymbolicLink()) {
    throw new Error(vscode.l10n.t('The selected scene file is not a regular file, so it cannot be safely deleted.'));
  }
  try {
    const realSceneDirectory = await fs.realpath(sceneDirectory);
    if (!isPathWithin(realLevelsRoot, realSceneDirectory)) {
      throw new Error(vscode.l10n.t('The scene folder resolves outside develop/levels, so it cannot be safely deleted.'));
    }
  } catch (error) {
    throw new Error(vscode.l10n.t('Scene folder could not be safely resolved: {error}', { error: error.message }));
  }

  const sceneTree = await inspectSceneTree(sceneDirectory);
  if (sceneTree.errors.length > 0) {
    return {
      canDelete: false,
      scenePath: levelPath,
      sceneDirectory,
      reason: vscode.l10n.t('Could not inspect every folder in the scene directory ({path}): {error}', { path: sceneTree.errors[0].path, error: sceneTree.errors[0].message })
    };
  }
  if (sceneTree.symbolicLinks.length > 0) {
    return {
      canDelete: false,
      scenePath: levelPath,
      sceneDirectory,
      reason: vscode.l10n.t('The scene folder contains symbolic links and cannot be safely moved as a whole: {path}', { path: sceneTree.symbolicLinks[0] })
    };
  }
  if (sceneTree.files.length !== 1 || path.resolve(sceneTree.files[0]) !== levelPath) {
    return {
      canDelete: false,
      scenePath: levelPath,
      sceneDirectory,
      reason: vscode.l10n.t('The folder contains {count} level files. Delete Scene only removes a folder that contains exactly one level.', { count: sceneTree.files.length })
    };
  }

  let levelContents;
  try {
    levelContents = await fs.readFile(levelPath, 'utf8');
  } catch (error) {
    throw new Error(vscode.l10n.t('Scene file could not be read: {error}', { error: error.message }));
  }
  const exports = await findExportTargets(vscode, project, levelPath, levelContents);
  const referenceScan = await findSceneReferences(
    vscode,
    project,
    sceneDirectory,
    levelPath,
    exports.exportPath,
    exports.targets
  );
  return {
    canDelete: true,
    scenePath: levelPath,
    sceneDirectory,
    exportPath: exports.exportPath,
    exportTargets: exports.targets,
    exportWarning: exports.warning,
    references: referenceScan.references,
    referenceScanError: referenceScan.error,
    targets: [sceneDirectory, ...exports.targets]
  };
}

function createSceneActions({ vscodeApi }) {
  return {
    inspectDeletion: (project, scenePath) => inspectSceneDeletion(vscodeApi, project, scenePath)
  };
}

module.exports = { createSceneActions, inspectSceneDeletion };
