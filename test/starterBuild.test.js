const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const starterRoot = path.join(__dirname, '..', 'templates', 'starter-project');

test('starter shader build emits the tools shader dump required by daEditor', () => {
  const configPath = path.join(starterRoot, 'prog', 'shaders', 'shaders_tools11.blk');
  assert.ok(fs.existsSync(configPath), 'expected the editor shader configuration');
  const config = fs.readFileSync(configPath, 'utf8');
  assert.match(config, /include\s+"\.\.\/\.\.\/\.\.\/prog\/daNetGame\/shaders\/_build\/shaders_tools11\.blk"/);
  assert.match(config, /"@override:outDumpName":t="\.\.\/\.\.\/tools\/tools"/);

  const buildScript = fs.readFileSync(path.join(starterRoot, 'prog', 'build.py'), 'utf8');
  assert.match(buildScript, /"shaders_tools11\.blk"/);
  assert.match(buildScript, /tools_output_dir\s*\/\s*"tools\.ps50\.shdump\.bin"/);
});
