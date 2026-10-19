const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { spawn } = require('node:child_process');

function resolveExecutable(configuredPath, toolsDirectory, settingName) {
  const executablePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : toolsDirectory
      ? path.resolve(toolsDirectory, configuredPath)
      : undefined;

  if (!executablePath) {
    throw new Error(vscode.l10n.t('Set dagorProjectManager.toolsDirectory or configure an absolute path for {setting}.', { setting: settingName }));
  }

  if (!fs.existsSync(executablePath)) {
    throw new Error(vscode.l10n.t('Cannot find {setting}: {path}', { setting: settingName, path: executablePath }));
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
    vscode.window.showErrorMessage(vscode.l10n.t('Failed to start Dagor tool: {error}', { error: error.message }));
  });
  child.unref();
}

async function runTool(fileUri, kind) {
  if (!fileUri || fileUri.scheme !== 'file') {
    vscode.window.showErrorMessage(vscode.l10n.t('Select a local .blk file in the VS Code Explorer.'));
    return;
  }

  const selectedFile = fileUri.fsPath;
  if (path.extname(selectedFile).toLowerCase() !== '.blk') {
    vscode.window.showErrorMessage(vscode.l10n.t('The selected file is not a .blk file.'));
    return;
  }

  const config = vscode.workspace.getConfiguration('dagorProjectManager');
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(fileUri)?.uri.fsPath;
  const toolsDirectory = config.get('toolsDirectory') || process.env.DAGOR_CDK_DIR ||
    (workspaceRoot ? findToolsDirectory(workspaceRoot) : undefined);
  if (!toolsDirectory) {
    vscode.window.showErrorMessage(vscode.l10n.t('Set dagorProjectManager.toolsDirectory or the DAGOR_CDK_DIR environment variable.'));
    return;
  }

  try {
    const fileName = path.basename(selectedFile).toLowerCase();
    let executablePath;
    let args;
    let cwd = path.dirname(selectedFile);

    if (kind === 'blkEditor') {
      executablePath = resolveExecutable(config.get('blkEditorExecutable'), toolsDirectory, vscode.l10n.t('blkEditor executable'));
      args = [selectedFile];
    } else if (kind === 'daViewer') {
      if (fileName !== 'application.blk') {
        vscode.window.showErrorMessage(vscode.l10n.t('daViewer can be opened from application.blk.'));
        return;
      }
      executablePath = resolveExecutable(config.get('daViewerExecutable'), toolsDirectory, vscode.l10n.t('daViewer executable'));
      args = [selectedFile];
      cwd = path.dirname(selectedFile);
    } else {
      executablePath = resolveExecutable(config.get('daEditorExecutable'), toolsDirectory, vscode.l10n.t('daEditor executable'));
      if (fileName === 'application.blk') {
        args = [selectedFile];
        cwd = path.dirname(selectedFile);
      } else if (fileName.endsWith('.level.blk')) {
        if (!workspaceRoot) {
          vscode.window.showErrorMessage(vscode.l10n.t('Open the project folder in VS Code before opening a level.'));
          return;
        }
        const project = findProjectApplication(selectedFile, workspaceRoot);
        if (!project) {
          vscode.window.showErrorMessage(vscode.l10n.t('Cannot find application.blk in the selected level folder or its parent folders.'));
          return;
        }
        args = [project.applicationFile, selectedFile];
        cwd = project.projectRoot;
      } else {
        vscode.window.showErrorMessage(vscode.l10n.t('daEditor is available for application.blk and *.level.blk files.'));
        return;
      }
    }

    launch(executablePath, args, cwd);
  } catch (error) {
    vscode.window.showErrorMessage(error.message);
  }
}

function getToolsDirectory(config) {
  return config.get('toolsDirectory') || process.env.DAGOR_CDK_DIR ||
    (vscode.workspace.workspaceFolders || []).map(folder => folder.uri.fsPath).map(findToolsDirectory).find(Boolean);
}

async function openSceneInDaEditor(fileUri) {
  const root = vscode.workspace.getWorkspaceFolder(fileUri)?.uri.fsPath;
  if (!root) {
    vscode.window.showErrorMessage(vscode.l10n.t('Open a Dagor project folder in VS Code first.'));
    return;
  }
  await runTool(fileUri, 'daEditor');
}

async function openProjectDaViewer(project) {
  if (!project?.applicationFile) {
    vscode.window.showErrorMessage(vscode.l10n.t('Select a Dagor project in the sidebar.'));
    return;
  }
  await runTool(vscode.Uri.file(project.applicationFile), 'daViewer');
}

module.exports = {
  resolveExecutable,
  findProjectApplication,
  findToolsDirectory,
  launch,
  runTool,
  getToolsDirectory,
  openSceneInDaEditor,
  openProjectDaViewer
};
