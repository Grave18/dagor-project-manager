const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const l10nDirectory = path.join(root, 'l10n');
const localeIds = new Set(['en']);

JSON.parse(fs.readFileSync(path.join(l10nDirectory, 'bundle.l10n.json'), 'utf8'));

for (const filename of fs.readdirSync(l10nDirectory)) {
  const match = /^bundle\.l10n\.([\w-]+)\.json$/i.exec(filename);
  if (match) {
    JSON.parse(fs.readFileSync(path.join(l10nDirectory, filename), 'utf8'));
    localeIds.add(match[1].toLowerCase());
  }
}

const locales = [...localeIds].sort((left, right) => left.localeCompare(right));
const settingValues = ['system', ...locales];
const manifestPath = path.join(root, 'package.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const configurationNodes = Array.isArray(manifest.contributes.configuration)
  ? manifest.contributes.configuration
  : [manifest.contributes.configuration];
const languageSetting = configurationNodes
  .map(configuration => configuration.properties?.['dagorProjectManager.language'])
  .find(Boolean);
if (!languageSetting) throw new Error('Could not find dagorProjectManager.language in package.json');
languageSetting.enum = settingValues;
languageSetting.enumItemLabels = settingValues.map(value => `%configuration.language.option.${value}%`);
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

for (const [displayLocale, filename] of [['en', 'package.nls.json'], ['ru', 'package.nls.ru.json']]) {
  const translationsPath = path.join(root, filename);
  const translations = JSON.parse(fs.readFileSync(translationsPath, 'utf8'));
  translations['configuration.language.option.system'] = displayLocale === 'ru' ? 'Как в системе' : 'System';
  const displayNames = new Intl.DisplayNames([displayLocale], { type: 'language' });
  for (const locale of locales) {
    const label = displayNames.of(locale) || locale;
    const key = `configuration.language.option.${locale}`;
    translations[key] = label.charAt(0).toLocaleUpperCase(displayLocale) + label.slice(1);
  }
  fs.writeFileSync(translationsPath, `${JSON.stringify(translations, null, 2)}\n`);
}
