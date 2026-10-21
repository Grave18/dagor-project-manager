const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

let bundles = {};

function initializeLocalization(context) {
  const directory = path.join(context.extensionPath, 'l10n');
  bundles = {};
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    console.error(`Failed to read localization directory: ${error.message}`);
    return;
  }

  for (const entry of entries) {
    const match = /^bundle\.l10n(?:\.([\w-]+))?\.json$/i.exec(entry.name);
    if (!entry.isFile() || !match) continue;
    const locale = match[1] || 'en';
    try {
      bundles[locale.toLowerCase()] = JSON.parse(fs.readFileSync(path.join(directory, entry.name), 'utf8'));
    } catch (error) {
      console.error(`Failed to load localization bundle ${entry.name}: ${error.message}`);
    }
  }
}

function interpolate(message, args) {
  return message.replace(/\{([^{}]+)\}/g, (placeholder, key) =>
    Object.prototype.hasOwnProperty.call(args || {}, key) ? String(args[key]) : placeholder);
}

function t(message, args) {
  const language = vscode.workspace.getConfiguration('dagorProjectManager').get('language') || 'system';
  const locale = String(language).toLowerCase();
  if (locale === 'system' || !bundles[locale]) return vscode.l10n.t(message, args);

  const localizedMessage = bundles[locale]?.[message] ?? bundles.en?.[message] ?? message;
  return interpolate(localizedMessage, args);
}

module.exports = { initializeLocalization, t };
