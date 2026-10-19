const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const english = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.json'), 'utf8'));
const russian = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.ru.json'), 'utf8'));

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
