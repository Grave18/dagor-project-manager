/**
 * @typedef {object} WebviewMessage
 * @property {string} type
 * @property {string} [project]
 * @property {string} [action]
 * @property {string} [scene]
 * @property {string} [executable]
 * @property {string} [command]
 * @property {number} [fromHeight]
 * @property {unknown[]} [components]
 * @property {unknown} [target]
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is WebviewMessage} */
function isWebviewMessage(value) {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'ready':
    case 'refresh':
    case 'addProject':
    case 'openSettings':
      return true;
    case 'setContextTarget':
      return value.target === null || (isRecord(value.target) &&
        typeof value.target.kind === 'string' &&
        typeof value.target.project === 'string' &&
        (value.target.path === undefined || typeof value.target.path === 'string'));
    case 'selectProject':
    case 'toggleProject':
      return typeof value.project === 'string' && (value.fromHeight === undefined || typeof value.fromHeight === 'number');
    case 'action':
      return (value.action === 'build' && typeof value.project === 'string' && Array.isArray(value.components)) ||
        (value.action === 'viewer' && typeof value.project === 'string') ||
        (value.action === 'generate' && (value.project === undefined || typeof value.project === 'string'));
    case 'openScene':
      return typeof value.project === 'string' && typeof value.scene === 'string';
    case 'runGame':
      return typeof value.project === 'string' && typeof value.executable === 'string';
    case 'runGameCommand':
      return typeof value.project === 'string' && typeof value.command === 'string';
    case 'createGameCommand':
    case 'createScene':
    case 'stopBuild':
      return typeof value.project === 'string';
    default:
      return false;
  }
}

module.exports = { isRecord, isWebviewMessage };
