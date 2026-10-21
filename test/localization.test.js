const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const english = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.json'), 'utf8'));
const russian = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.ru.json'), 'utf8'));
const runtimeEnglish = JSON.parse(fs.readFileSync(path.join(root, 'l10n', 'bundle.l10n.json'), 'utf8'));
const runtimeRussian = JSON.parse(fs.readFileSync(path.join(root, 'l10n', 'bundle.l10n.ru.json'), 'utf8'));

function findLocalizationReferences(value, keys = new Set()) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/%([\w.-]+)%/g)) keys.add(match[1]);
  } else if (Array.isArray(value)) {
    value.forEach(item => findLocalizationReferences(item, keys));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach(item => findLocalizationReferences(item, keys));
  }
  return keys;
}

test('every manifest localization key exists in English and Russian with matching key sets', () => {
  const references = findLocalizationReferences(manifest);
  assert.deepEqual([...references].filter(key => !(key in english)), []);
  assert.deepEqual([...references].filter(key => !(key in russian)), []);
  assert.deepEqual(Object.keys(english).sort(), Object.keys(russian).sort());
});

test('runtime localization calls are present in both bundles with matching placeholders', () => {
  assert.equal(manifest.l10n, './l10n');
  const sourceFiles = [];
  const collectFiles = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) collectFiles(entryPath);
      else if (entry.isFile() && entry.name.endsWith('.js')) sourceFiles.push(entryPath);
    }
  };
  collectFiles(path.join(root, 'src'));
  const sources = sourceFiles.flatMap(file =>
    [...fs.readFileSync(file, 'utf8').matchAll(/(?<![\w$.])t\(\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")/g)]
      .map(match => (match[1] ?? match[2]).replace(/\\n/g, '\n').replace(/\\(["'\\])/g, '$1'))
  );
  for (const source of new Set(sources)) {
    assert.ok(source in runtimeEnglish, `missing English runtime source: ${source}`);
    assert.ok(source in runtimeRussian, `missing Russian runtime translation: ${source}`);
    assert.equal(runtimeEnglish[source], source, `English source bundle changed source text: ${source}`);
    const placeholders = value => [...value.matchAll(/\{([\w]+)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(placeholders(runtimeRussian[source]), placeholders(runtimeEnglish[source]), `placeholder mismatch: ${source}`);
  }
  assert.deepEqual(Object.keys(runtimeEnglish).sort(), Object.keys(runtimeRussian).sort());

  const availableLocales = new Set(['en']);
  for (const filename of fs.readdirSync(path.join(root, 'l10n'))) {
    const match = /^bundle\.l10n\.([\w-]+)\.json$/i.exec(filename);
    if (match) availableLocales.add(match[1].toLowerCase());
  }
  assert.deepEqual(manifest.contributes.configuration.properties['dagorProjectManager.language'].enum,
    ['system', ...[...availableLocales].sort((left, right) => left.localeCompare(right))]);
});
