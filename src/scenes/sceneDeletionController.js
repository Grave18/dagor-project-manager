const path = require('node:path');

/**
 * @typedef {{file: string, line: number, text: string}} SceneReference
 * @typedef {{
 *   canDelete: boolean,
 *   reason?: string,
 *   references: SceneReference[],
 *   referenceScanError?: string,
 *   sceneDirectory: string,
 *   exportTargets: string[],
 *   exportWarning?: string,
 *   targets: string[]
 * }} SceneDeletionDetails
 * @typedef {{
 *   applicationFile: string,
 *   label: string,
 *   root: string,
 *   scenes: Array<{uri: import('vscode').Uri, label: string}>
 * }} DeletionProject
 * @typedef {{
 *   projects: DeletionProject[],
 *   refresh: () => Promise<void>
 * }} DeletionCatalog
 * @typedef {{
 *   inspectDeletion: (project: DeletionProject, scenePath: string) => Promise<SceneDeletionDetails>
 * }} SceneDeletionActions
 * @typedef {{appendLine: (value: string) => void, show: (preserveFocus?: boolean) => void}} DeletionOutput
 * @typedef {{
 *   vscodeApi: typeof import('vscode'),
 *   catalog: DeletionCatalog,
 *   sceneActions: SceneDeletionActions,
 *   outputChannel?: DeletionOutput
 * }} SceneDeletionDependencies
 */

/**
 * @param {SceneDeletionDependencies} dependencies
 * @returns {{deleteScene: (projectId: string, scenePath: string) => Promise<void>}}
 */
function createSceneDeletionController({ vscodeApi, catalog, sceneActions, outputChannel }) {
  async function deleteScene(projectId, scenePath) {
    if (typeof projectId !== 'string' || typeof scenePath !== 'string') return;
    const project = catalog.projects.find(item => item.applicationFile === projectId);
    const scene = project?.scenes.find(item => path.resolve(item.uri.fsPath) === path.resolve(scenePath));
    if (!project || !scene) return;

    /** @type {SceneDeletionDetails} */
    let details;
    try {
      details = await sceneActions.inspectDeletion(project, scene.uri.fsPath);
    } catch (error) {
      outputChannel?.show(true);
      outputChannel?.appendLine(`[DAGOR_PM] ${vscodeApi.l10n.t('Could not inspect scene {scene}: {error}', { scene: scene.label, error: error.message })}`);
      vscodeApi.window.showErrorMessage(vscodeApi.l10n.t('Could not inspect scene {scene}: {error}', { scene: scene.label, error: error.message }));
      return;
    }

    if (!details.canDelete) {
      outputChannel?.show(true);
      outputChannel?.appendLine(`[DAGOR_PM] ${vscodeApi.l10n.t('Refused to delete scene {scene}.', { scene: scene.label })}`);
      outputChannel?.appendLine(`[DAGOR_PM] ${details.reason}`);
      vscodeApi.window.showWarningMessage(vscodeApi.l10n.t('Cannot safely delete scene "{scene}".', { scene: scene.label }), { modal: true, detail: details.reason }, vscodeApi.l10n.t('OK'));
      return;
    }

    const listedReferences = details.references.slice(0, 10);
    const referenceLines = details.references.length > 0
      ? `${listedReferences.map(reference => `${reference.file}:${reference.line}`).join('\n')}${details.references.length > listedReferences.length ? `\n…and ${details.references.length - listedReferences.length} more; see Output.` : ''}`
      : details.referenceScanError
        ? vscodeApi.l10n.t('Reference scan failed: {error}', { error: details.referenceScanError })
        : vscodeApi.l10n.t('No static references found.');
    const confirmationDetail = [
      vscodeApi.l10n.t('Scene folder (to system trash):\n{path}', { path: details.sceneDirectory }),
      details.exportTargets.length > 0
        ? vscodeApi.l10n.t('Export files (to system trash):\n{paths}{warning}', { paths: details.exportTargets.join('\n'), warning: details.exportWarning ? `\n${vscodeApi.l10n.t('Attention: {warning}', { warning: details.exportWarning })}` : '' })
        : vscodeApi.l10n.t('Export files: none found{warning}', { warning: details.exportWarning ? ` (${details.exportWarning})` : '' }),
      vscodeApi.l10n.t('References (will be left unchanged):\n{references}', { references: referenceLines }),
      vscodeApi.l10n.t('Static scanning may not detect references assembled or loaded by code.'),
      vscodeApi.l10n.t('Assets will not be deleted.')
    ].join('\n\n');
    const output = outputChannel;
    output?.appendLine('');
    output?.appendLine(`[DAGOR_PM] ${vscodeApi.l10n.t('Scene deletion inspection: {scene} in {project}.', { scene: scene.label, project: project.label })}`);
    output?.appendLine(`[DAGOR_PM] ${vscodeApi.l10n.t('Scene folder: {path}', { path: details.sceneDirectory })}`);
    if (details.exportTargets.length > 0) {
      for (const exportPath of details.exportTargets) output?.appendLine(`[DAGOR_PM] ${vscodeApi.l10n.t('Export target: {path}', { path: exportPath })}`);
    }
    if (details.exportWarning || details.exportTargets.length === 0) {
      output?.appendLine(`[DAGOR_PM] ${vscodeApi.l10n.t('Attention: {warning}', { warning: details.exportWarning || vscodeApi.l10n.t('No export files were identified.') })}`);
    }
    if (details.referenceScanError) {
      output?.appendLine(`[DAGOR_PM] ${vscodeApi.l10n.t('Attention: static reference scan failed: {error}', { error: details.referenceScanError })}`);
    } else if (details.references.length > 0) {
      output?.appendLine(`[DAGOR_PM] ${vscodeApi.l10n.t('Attention: these references were found and will not be changed:')}`);
      for (const reference of details.references) {
        output?.appendLine(`  ${reference.file}:${reference.line}: ${reference.text}`);
      }
    } else {
      output?.appendLine(`[DAGOR_PM] ${vscodeApi.l10n.t('No direct textual references were found. Dynamic references may not be detected.')}`);
    }
    output?.appendLine(`[DAGOR_PM] ${vscodeApi.l10n.t('Assets are not part of scene deletion and will be left untouched.')}`);
    if (details.references.length > listedReferences.length || details.referenceScanError) output?.show(true);
    const confirmation = await vscodeApi.window.showWarningMessage(
      vscodeApi.l10n.t('Delete scene "{scene}"?', { scene: scene.label }),
      { modal: true, detail: confirmationDetail },
      vscodeApi.l10n.t('Delete Scene'),
      vscodeApi.l10n.t('Cancel')
    );
    if (confirmation !== vscodeApi.l10n.t('Delete Scene')) return;

    output?.show(true);
    output?.appendLine(`[DAGOR_PM] ${vscodeApi.l10n.t('User confirmed deletion of scene {scene}.', { scene: scene.label })}`);

    const deletedPaths = [];
    let failedTargets = [];
    for (const targetPath of details.targets) {
      try {
        await vscodeApi.workspace.fs.delete(vscodeApi.Uri.file(targetPath), { recursive: true, useTrash: true });
        deletedPaths.push(targetPath);
        output?.appendLine(`[DAGOR_PM] ${vscodeApi.l10n.t('Moved to system trash: {path}', { path: targetPath })}`);
      } catch (error) {
        failedTargets.push({ path: targetPath, message: error.message });
        output?.appendLine(`[DAGOR_PM] ${vscodeApi.l10n.t('Failed to move to system trash: {path} ({error})', { path: targetPath, error: error.message })}`);
      }
    }

    if (failedTargets.length > 0) {
      const fallbackChoice = await vscodeApi.window.showWarningMessage(
        vscodeApi.l10n.t('Some files for scene "{scene}" could not be moved to the system trash.', { scene: scene.label }),
        {
          modal: true,
          detail: vscodeApi.l10n.t('Permanently deleting these paths cannot be undone:\n{paths}', { paths: failedTargets.map(item => `${item.path}\n${item.message}`).join('\n') })
        },
        vscodeApi.l10n.t('Permanently Delete'),
        vscodeApi.l10n.t('Cancel')
      );
      if (fallbackChoice === vscodeApi.l10n.t('Permanently Delete')) {
        const retryTargets = failedTargets;
        failedTargets = [];
        for (const item of retryTargets) {
          try {
            await vscodeApi.workspace.fs.delete(vscodeApi.Uri.file(item.path), { recursive: true });
            deletedPaths.push(item.path);
            output?.appendLine(`[DAGOR_PM] ${vscodeApi.l10n.t('Permanently deleted: {path}', { path: item.path })}`);
          } catch (error) {
            failedTargets.push({ path: item.path, message: error.message });
            output?.appendLine(`[DAGOR_PM] ${vscodeApi.l10n.t('Permanent deletion failed: {path} ({error})', { path: item.path, error: error.message })}`);
          }
        }
      } else {
        output?.appendLine(`[DAGOR_PM] ${vscodeApi.l10n.t('Permanent deletion was cancelled; failed paths were left in place.')}`);
      }
    }

    const sourceFolderDeleted = deletedPaths.includes(details.sceneDirectory);
    if (sourceFolderDeleted) {
      try {
        await catalog.refresh();
      } catch (error) {
        output?.appendLine(`[DAGOR_PM] ${vscodeApi.l10n.t('Attention: scene was deleted, but the project list could not be refreshed: {error}', { error: error.message })}`);
      }
    }
    if (failedTargets.length > 0) {
      output?.appendLine(`[DAGOR_PM] ${vscodeApi.l10n.t('Scene deletion partially completed: {count} path(s) remain.', { count: failedTargets.length })}`);
      vscodeApi.window.showWarningMessage(vscodeApi.l10n.t('Scene "{scene}" was only partially deleted. See the Dagor Project Manager output.', { scene: scene.label }));
    } else {
      output?.appendLine(`[DAGOR_PM] ${vscodeApi.l10n.t('Scene deletion finished. {count} path(s) removed.', { count: deletedPaths.length })}`);
      if (!sourceFolderDeleted) {
        vscodeApi.window.showErrorMessage(vscodeApi.l10n.t('Scene folder {path} was not deleted. See the Dagor Project Manager output.', { path: details.sceneDirectory }));
      }
    }
  }

  return { deleteScene };
}

module.exports = { createSceneDeletionController };
