const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dagor-project-manager-l10n-'));
const temporarySource = path.join(temporaryRoot, 'src');
const outputDirectory = path.join(temporaryRoot, 'l10n');

try {
  fs.cpSync(path.join(root, 'src'), temporarySource, { recursive: true });
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(filePath);
      } else if (entry.isFile() && entry.name.endsWith('.js') && entry.name !== 'localization.js') {
        const source = fs.readFileSync(filePath, 'utf8');
        fs.writeFileSync(filePath, source.replace(/(?<![\w$.])t\(/g, 'vscode.l10n.t('));
      }
    }
  };
  visit(temporarySource);

  const cliPath = path.join(root, 'node_modules', '@vscode', 'l10n-dev', 'dist', 'cli.js');
  const result = spawnSync(process.execPath, [cliPath, 'export', '--outDir', outputDirectory, temporarySource], {
    cwd: root,
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status || 1;
  else fs.copyFileSync(path.join(outputDirectory, 'bundle.l10n.json'), path.join(root, 'l10n', 'bundle.l10n.json'));
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
