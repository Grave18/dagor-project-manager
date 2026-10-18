const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const starterRoot = path.join(__dirname, '..', 'templates', 'starter-project');
const levelRoot = path.join(starterRoot, 'develop', 'levels', '__PROJECT_NAME__');

test('starter level loads editable Plane and Cube entities with their referenced assets', () => {
  const level = fs.readFileSync(path.join(levelRoot, '__PROJECT_NAME__.level.blk'), 'utf8');
  assert.match(level, /_riEntMgr:b=yes/);
  assert.match(level, /staticGeometry:b=no/);
  assert.match(level, /heightmapLand:b=yes/);

  const entities = fs.readFileSync(path.join(levelRoot, 'heightmapLand', 'entities.blk'), 'utf8');
  assert.match(entities, /name:t="Plane"[\s\S]*?entName:t="test_cube:rendInst"[\s\S]*?tm:m=\[\[30, 0, 0\]/);
  assert.match(entities, /name:t="Cube"[\s\S]*?entName:t="test_cube:rendInst"[\s\S]*?\[0, 0\.5, 0\]/);

  const camera = fs.readFileSync(path.join(levelRoot, '__PROJECT_NAME__.level.local.blk'), 'utf8');
  assert.match(camera, /viewMatrix3:p3=-0\.15, 1\.84, 4\.61/);
  for (const asset of ['.folder.blk', 'test_cube.lod00.dag', 'test_cube_dm.dag', 'test_cube_d.tif']) {
    assert.ok(fs.existsSync(path.join(starterRoot, 'develop', 'assets', 'test_assets', asset)), `missing ${asset}`);
  }
});
