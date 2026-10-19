'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_MARKER = '__PROJECT_NAME__';
const PROJECT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const PROJECT_ERROR_CODES = {
  'The bundled starter template is missing: {path}': 'TEMPLATE_MISSING',
  'The bundled starter template is incomplete. Missing: {files}': 'TEMPLATE_INCOMPLETE',
  'Project name must start with a letter or number and contain only letters, numbers, underscores, or hyphens.': 'INVALID_NAME',
  'Template entry escapes the project folder: {path}': 'TEMPLATE_PATH_ESCAPE',
  'Template paths collide after name replacement: {path}': 'TEMPLATE_PATH_COLLISION',
  'The bundled starter template contains an unsupported symbolic link: {path}': 'TEMPLATE_SYMLINK',
  'The bundled starter template contains an unsupported file type: {path}': 'TEMPLATE_FILE_TYPE',
  'Generated project is missing required file: {path}': 'GENERATED_FILE_MISSING',
  'Template marker remains in generated path: {path}': 'UNRESOLVED_PATH_MARKER',
  'Template marker remains in generated file: {path}': 'UNRESOLVED_FILE_MARKER',
  'Failed to initialize the project Git repository: {error}': 'GIT_INIT_FAILED',
  'The selected folder is not a DagorEngine root: {path}': 'INVALID_ENGINE_ROOT',
  'A project folder already exists: {path}': 'DESTINATION_EXISTS'
};
function createProjectError(message, l10nMessage, l10nArgs = {}) {
  const error = new Error(message);
  error.code = `DAGOR_PROJECT_GENERATOR_${PROJECT_ERROR_CODES[l10nMessage] || 'UNKNOWN'}`;
  error.l10nMessage = l10nMessage;
  error.l10nArgs = l10nArgs;
  return error;
}
const TEXT_EXTENSIONS = new Set([
  '.blk', '.py', '.jam', '.cmd', '.das', '.txt', '.json', '.xml'
]);

function isTextFile(fileName) {
  return fileName.toLowerCase() === 'jamfile' || TEXT_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function isEngineRoot(directory) {
  try {
    return fs.existsSync(path.join(directory, 'build_all.py')) &&
      fs.existsSync(path.join(directory, 'tools', 'dagor_cdk')) &&
      fs.statSync(path.join(directory, 'tools', 'dagor_cdk')).isDirectory();
  } catch {
    return false;
  }
}

function addAncestors(startDirectory, roots) {
  let directory = path.resolve(startDirectory);
  while (true) {
    if (isEngineRoot(directory)) {
      const canonical = canonicalPath(directory);
      roots.set(process.platform === 'win32' ? canonical.toLowerCase() : canonical, canonical);
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
}

function canonicalPath(directory) {
  return fs.realpathSync(directory);
}

function findDagorEngineRoots(workspaceRoots = [], configuredToolsDirectory) {
  const roots = new Map();
  for (const workspaceRoot of workspaceRoots) {
    if (typeof workspaceRoot === 'string' && workspaceRoot.trim()) addAncestors(workspaceRoot, roots);
  }
  if (typeof configuredToolsDirectory === 'string' && configuredToolsDirectory.trim()) {
    addAncestors(configuredToolsDirectory, roots);
  }
  return [...roots.values()].sort((left, right) => left.localeCompare(right));
}

function validateTemplate(templateRoot) {
  if (!templateRoot || !fs.existsSync(templateRoot) || !fs.statSync(templateRoot).isDirectory()) {
    const template = templateRoot || '(empty path)';
    throw createProjectError(`The bundled starter template is missing: ${template}`, 'The bundled starter template is missing: {path}', { path: template });
  }
  const required = [
    'application.blk',
    'prog/build.py',
    'develop/environments/gameParams.blk',
    'develop/environments/global.blk',
    'develop/environments/weather_types.blk',
    'develop/environments/weather_preset_1.blk',
    'develop/levels/physmat.blk',
    'develop/assets/base/tex_special/stars.tex.blk',
    'develop/assets/base/tex_special/stars.tif',
    'develop/assets/base/tex_special/moon.tex.blk',
    'develop/assets/base/tex_special/moon.tif',
    `develop/levels/${PROJECT_MARKER}/${PROJECT_MARKER}.level.blk`,
    `develop/levels/${PROJECT_MARKER}/${PROJECT_MARKER}.level.local.blk`,
    `develop/levels/${PROJECT_MARKER}/heightmapLand/entities.blk`,
    'develop/assets/test_assets/.folder.blk',
    'develop/assets/test_assets/test_cube.lod00.dag',
    'develop/assets/test_assets/test_cube_dm.dag',
    'develop/assets/test_assets/test_cube_d.tif'
  ];
  const missing = required.filter(relative => !fs.existsSync(path.join(templateRoot, relative)));
  if (missing.length) {
    throw createProjectError(`The bundled starter template is incomplete. Missing: ${missing.join(', ')}`, 'The bundled starter template is incomplete. Missing: {files}', { files: missing.join(', ') });
  }
}

function validateProjectName(projectName) {
  if (typeof projectName !== 'string' || !PROJECT_NAME_PATTERN.test(projectName)) {
    throw createProjectError('Project name must start with a letter or number and contain only letters, numbers, underscores, or hyphens.', 'Project name must start with a letter or number and contain only letters, numbers, underscores, or hyphens.');
  }
}

function mappedRelativePath(relativePath, projectName) {
  return relativePath.split(path.sep).map(part => part.split(PROJECT_MARKER).join(projectName)).join(path.sep);
}

function copyTemplate(templateRoot, projectRoot, projectName) {
  const mappedEntries = new Set();
  const collisionKeys = new Set();
  const copiedFiles = [];

  function copyDirectory(sourceDirectory, relativeDirectory = '') {
    for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
      const relativeSource = path.join(relativeDirectory, entry.name);
      const relativeDestination = mappedRelativePath(relativeSource, projectName);
      const normalizedDestination = path.normalize(relativeDestination);
      if (path.isAbsolute(relativeDestination) || normalizedDestination === '..' ||
          normalizedDestination.startsWith(`..${path.sep}`)) {
        throw createProjectError(`Template entry escapes the project folder: ${relativeSource}`, 'Template entry escapes the project folder: {path}', { path: relativeSource });
      }
      // Windows paths are case-insensitive, so catch collisions even when the
      // template's source entries differ only by letter case.
      const collisionKey = normalizedDestination.toLocaleLowerCase('en-US');
      if (collisionKeys.has(collisionKey)) {
        throw createProjectError(`Template paths collide after name replacement: ${normalizedDestination}`, 'Template paths collide after name replacement: {path}', { path: normalizedDestination });
      }
      collisionKeys.add(collisionKey);
      mappedEntries.add(normalizedDestination);

      const sourcePath = path.join(sourceDirectory, entry.name);
      const destinationPath = path.join(projectRoot, normalizedDestination);
      if (entry.isSymbolicLink()) {
        throw createProjectError(`The bundled starter template contains an unsupported symbolic link: ${relativeSource}`, 'The bundled starter template contains an unsupported symbolic link: {path}', { path: relativeSource });
      }
      if (entry.isDirectory()) {
        fs.mkdirSync(destinationPath);
        copyDirectory(sourcePath, relativeSource);
      } else if (entry.isFile()) {
        const content = fs.readFileSync(sourcePath);
        const isText = isTextFile(entry.name);
        if (isText) {
          fs.writeFileSync(destinationPath, content.toString('utf8').split(PROJECT_MARKER).join(projectName), { encoding: 'utf8', flag: 'wx' });
        } else {
          fs.writeFileSync(destinationPath, content, { flag: 'wx' });
        }
        copiedFiles.push({ path: normalizedDestination, isText });
      } else {
        throw createProjectError(`The bundled starter template contains an unsupported file type: ${relativeSource}`, 'The bundled starter template contains an unsupported file type: {path}', { path: relativeSource });
      }
    }
  }

  copyDirectory(templateRoot);
  return { mappedEntries, copiedFiles };
}

function validateGeneratedProject(projectRoot, projectName, mappedEntries, copiedFiles) {
  const levelRelative = path.join('develop', 'levels', projectName, `${projectName}.level.blk`);
  const requiredFiles = [
    'application.blk',
    'prog/build.py',
    'develop/environments/gameParams.blk',
    'develop/environments/global.blk',
    'develop/environments/weather_types.blk',
    'develop/environments/weather_preset_1.blk',
    path.join('develop', 'levels', 'physmat.blk'),
    path.join('develop', 'assets', 'base', 'tex_special', 'stars.tex.blk'),
    path.join('develop', 'assets', 'base', 'tex_special', 'stars.tif'),
    path.join('develop', 'assets', 'base', 'tex_special', 'moon.tex.blk'),
    path.join('develop', 'assets', 'base', 'tex_special', 'moon.tif'),
    levelRelative,
    path.join('develop', 'levels', projectName, `${projectName}.level.local.blk`),
    path.join('develop', 'levels', projectName, 'heightmapLand', 'entities.blk'),
    path.join('develop', 'assets', 'test_assets', '.folder.blk'),
    path.join('develop', 'assets', 'test_assets', 'test_cube.lod00.dag'),
    path.join('develop', 'assets', 'test_assets', 'test_cube_dm.dag'),
    path.join('develop', 'assets', 'test_assets', 'test_cube_d.tif')];
  for (const relative of requiredFiles) {
    const filePath = path.join(projectRoot, relative);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw createProjectError(`Generated project is missing required file: ${relative}`, 'Generated project is missing required file: {path}', { path: relative });
    }
  }

  for (const entry of mappedEntries) {
    if (entry.includes(PROJECT_MARKER)) {
      throw createProjectError(`Template marker remains in generated path: ${entry}`, 'Template marker remains in generated path: {path}', { path: entry });
    }
  }
  for (const file of copiedFiles) {
    if (file.isText && fs.readFileSync(path.join(projectRoot, file.path), 'utf8').includes(PROJECT_MARKER)) {
      throw createProjectError(`Template marker remains in generated file: ${file.path}`, 'Template marker remains in generated file: {path}', { path: file.path });
    }
  }
}

function initializeGitRepository(projectRoot) {
  const result = spawnSync('git', ['init'], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.error) {
    throw createProjectError(`Failed to initialize the project Git repository: ${result.error.message}`, 'Failed to initialize the project Git repository: {error}', { error: result.error.message });
  }
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || '').trim();
    const detail = details || `git exited with code ${result.status}`;
    throw createProjectError(`Failed to initialize the project Git repository${details ? `: ${details}` : ` (${detail})`}`, 'Failed to initialize the project Git repository: {error}', { error: detail });
  }
}

function createProject({ projectName, engineRoot, templateRoot }) {
  validateProjectName(projectName);
  validateTemplate(templateRoot);
  if (!engineRoot || !fs.existsSync(engineRoot) || !fs.statSync(engineRoot).isDirectory() || !isEngineRoot(engineRoot)) {
    const folder = engineRoot || '(empty path)';
    throw createProjectError(`The selected folder is not a DagorEngine root: ${folder}`, 'The selected folder is not a DagorEngine root: {path}', { path: folder });
  }

  const canonicalEngineRoot = fs.realpathSync(engineRoot);
  const projectRoot = path.join(canonicalEngineRoot, projectName);
  let destinationExists = fs.existsSync(projectRoot);
  if (!destinationExists) {
    try { fs.lstatSync(projectRoot); destinationExists = true; } catch {}
  }
  if (destinationExists) {
    throw createProjectError(`A project folder already exists: ${projectRoot}`, 'A project folder already exists: {path}', { path: projectRoot });
  }

  let destinationCreated = false;
  try {
    fs.mkdirSync(projectRoot);
    destinationCreated = true;
    const { mappedEntries, copiedFiles } = copyTemplate(templateRoot, projectRoot, projectName);
    validateGeneratedProject(projectRoot, projectName, mappedEntries, copiedFiles);
    initializeGitRepository(projectRoot);
    return { projectRoot, applicationFile: path.join(projectRoot, 'application.blk') };
  } catch (error) {
    if (destinationCreated) fs.rmSync(projectRoot, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { createProject, findDagorEngineRoots };
