const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createProject, findDagorEngineRoots } = require('../src/projects/projectGenerator');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dagor-project-generator-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const engineRoot = path.join(root, 'DagorEngine');
  fs.mkdirSync(path.join(engineRoot, 'tools', 'dagor_cdk'), { recursive: true });
  fs.writeFileSync(path.join(engineRoot, 'build_all.py'), '# engine marker');
  const templateRoot = path.join(root, 'template');
  fs.mkdirSync(path.join(templateRoot, 'prog'), { recursive: true });
  fs.mkdirSync(path.join(templateRoot, 'develop', 'levels', '__PROJECT_NAME__', 'heightmapLand'), { recursive: true });
  fs.mkdirSync(path.join(templateRoot, 'develop', 'assets', 'test_assets'), { recursive: true });
  fs.writeFileSync(path.join(templateRoot, 'application.blk'), 'name:t="__PROJECT_NAME__"');
  fs.writeFileSync(path.join(templateRoot, 'prog', 'build.py'), 'PROJECT="__PROJECT_NAME__"');
  fs.writeFileSync(path.join(templateRoot, 'prog', 'jamfile'), 'Location=__PROJECT_NAME__/prog');
  for (const relative of [
    'develop/environments/gameParams.blk',
    'develop/environments/global.blk',
    'develop/environments/weather_types.blk',
    'develop/environments/weather_preset_1.blk',
    'develop/levels/physmat.blk',
    'develop/assets/base/tex_special/stars.tex.blk',
    'develop/assets/base/tex_special/stars.tif',
    'develop/assets/base/tex_special/moon.tex.blk',
    'develop/assets/base/tex_special/moon.tif'
  ]) {
    const filePath = path.join(templateRoot, relative);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'template fixture');
  }
  fs.writeFileSync(path.join(templateRoot, 'develop', 'levels', '__PROJECT_NAME__', '__PROJECT_NAME__.level.blk'),
    'exportPath:t="levels/__PROJECT_NAME__.bin"');
  fs.writeFileSync(path.join(templateRoot, 'develop', 'levels', '__PROJECT_NAME__', '__PROJECT_NAME__.level.local.blk'),
    'project:t="__PROJECT_NAME__" viewport0{}');
  fs.writeFileSync(path.join(templateRoot, 'develop', 'levels', '__PROJECT_NAME__', 'heightmapLand', 'entities.blk'),
    'name:t="Plane" name:t="Cube" project:t="__PROJECT_NAME__"');
  fs.writeFileSync(path.join(templateRoot, 'develop', 'assets', 'test_assets', '.folder.blk'), '');
  fs.writeFileSync(path.join(templateRoot, 'develop', 'assets', 'test_assets', 'test_cube.lod00.dag'),
    Buffer.from([0x44, 0x41, 0x47, 0x01, 0x02]));
  fs.writeFileSync(path.join(templateRoot, 'develop', 'assets', 'test_assets', 'test_cube_dm.dag'), Buffer.from([0x44]));
  fs.writeFileSync(path.join(templateRoot, 'develop', 'assets', 'test_assets', 'test_cube_d.tif'), Buffer.from([0x49]));
  return { root, engineRoot, templateRoot };
}

test('discovers zero, one, multiple, and configured engine roots', t => {
  const { root, engineRoot } = fixture(t);
  assert.deepEqual(findDagorEngineRoots([path.join(root, 'elsewhere')]), []);
  assert.deepEqual(findDagorEngineRoots([engineRoot]), [engineRoot]);

  const secondRoot = path.join(root, 'second', 'DagorEngine');
  fs.mkdirSync(path.join(secondRoot, 'tools', 'dagor_cdk'), { recursive: true });
  fs.writeFileSync(path.join(secondRoot, 'build_all.py'), '');
  assert.deepEqual(findDagorEngineRoots([engineRoot, secondRoot]).sort(), [engineRoot, secondRoot].sort());

  const toolsDir = path.join(engineRoot, 'tools', 'dagor_cdk', 'windows-x86_64');
  assert.deepEqual(findDagorEngineRoots([], toolsDir), [engineRoot]);
});

test('rejects invalid names and an occupied destination without changing it', t => {
  const { engineRoot, templateRoot } = fixture(t);
  for (const projectName of ['', '.', '..', 'two/parts', 'two\\parts', '_leading']) {
    assert.throws(() => createProject({ projectName, engineRoot, templateRoot }), /project name/i);
  }

  const existing = path.join(engineRoot, 'AlreadyThere');
  fs.mkdirSync(existing);
  fs.writeFileSync(path.join(existing, 'keep.txt'), 'keep');
  assert.throws(() => createProject({ projectName: 'AlreadyThere', engineRoot, templateRoot }), /already exists/i);
  assert.equal(fs.readFileSync(path.join(existing, 'keep.txt'), 'utf8'), 'keep');
});

test('replaces markers in names and allowlisted text while preserving binary bytes', t => {
  const { engineRoot, templateRoot } = fixture(t);
  const result = createProject({ projectName: 'NewProject', engineRoot, templateRoot });
  assert.equal(result.projectRoot, path.join(engineRoot, 'NewProject'));
  assert.equal(result.applicationFile, path.join(result.projectRoot, 'application.blk'));
  assert.equal(fs.readFileSync(path.join(result.projectRoot, 'application.blk'), 'utf8'), 'name:t="NewProject"');
  assert.equal(fs.readFileSync(path.join(result.projectRoot, 'prog', 'jamfile'), 'utf8'), 'Location=NewProject/prog');
  assert.ok(fs.existsSync(path.join(result.projectRoot, 'develop', 'levels', 'NewProject', 'NewProject.level.blk')));
  assert.match(fs.readFileSync(path.join(result.projectRoot, 'develop', 'levels', 'NewProject', 'NewProject.level.local.blk'), 'utf8'), /project:t="NewProject"/);
  assert.match(fs.readFileSync(path.join(result.projectRoot, 'develop', 'levels', 'NewProject', 'heightmapLand', 'entities.blk'), 'utf8'), /project:t="NewProject"/);
  assert.deepEqual(fs.readFileSync(path.join(result.projectRoot, 'develop', 'assets', 'test_assets', 'test_cube.lod00.dag')),
    Buffer.from([0x44, 0x41, 0x47, 0x01, 0x02]));
  assert.doesNotMatch(walkText(result.projectRoot), /__PROJECT_NAME__/);
});

test('rejects template paths that collide after marker replacement and rolls back', t => {
  const { engineRoot, templateRoot } = fixture(t);
  fs.writeFileSync(path.join(templateRoot, '__PROJECT_NAME__.txt'), 'first');
  fs.writeFileSync(path.join(templateRoot, 'NewProject.txt'), 'second');
  const destination = path.join(engineRoot, 'NewProject');
  assert.throws(() => createProject({ projectName: 'NewProject', engineRoot, templateRoot }), /collide/i);
  assert.equal(fs.existsSync(destination), false);
});

test('rejects template paths that collide on case-insensitive filesystems', t => {
  const { engineRoot, templateRoot } = fixture(t);
  fs.writeFileSync(path.join(templateRoot, '__PROJECT_NAME__.txt'), 'first');
  fs.writeFileSync(path.join(templateRoot, 'newproject.txt'), 'second');
  const destination = path.join(engineRoot, 'NewProject');
  assert.throws(() => createProject({ projectName: 'NewProject', engineRoot, templateRoot }), /collide/i);
  assert.equal(fs.existsSync(destination), false);
});

test('rejects a template with missing referenced mesh before creating the destination', t => {
  const { engineRoot, templateRoot } = fixture(t);
  fs.rmSync(path.join(templateRoot, 'develop', 'assets', 'test_assets', 'test_cube.lod00.dag'));
  const destination = path.join(engineRoot, 'BrokenProject');
  assert.throws(() => createProject({ projectName: 'BrokenProject', engineRoot, templateRoot }), /template is incomplete/i);
  assert.equal(fs.existsSync(destination), false);
});

function walkText(root) {
  return fs.readdirSync(root, { withFileTypes: true }).map(entry => {
    const fullPath = path.join(root, entry.name);
    return entry.isDirectory() ? walkText(fullPath) : fs.readFileSync(fullPath, 'utf8');
  }).join('\n');
}
