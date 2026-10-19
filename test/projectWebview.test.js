const assert = require('node:assert/strict');
const test = require('node:test');
const { renderProjectWebview } = require('../src/views/projectWebview/renderProjectWebview');

function makeProject(overrides = {}) {
  const root = 'D:/DagorEngine/Demo';
  return {
    root,
    workspaceRoot: 'D:/DagorEngine',
    applicationFile: `${root}/application.blk`,
    label: 'Demo',
    scenes: [{ uri: { fsPath: `${root}/develop/levels/demo/demo.level.blk` }, label: 'demo', relativePath: 'develop/levels/demo/demo.level.blk' }],
    games: [{ executable: `${root}/game/demo.exe`, label: 'demo', }],
    gameCommands: [{ command: `${root}/game/run.cmd`, label: 'run', invocation: 'demo.exe -level demo' }],
    ...overrides
  };
}

test('renderer keeps project, selected-card rows, and context metadata', () => {
  const project = makeProject();
  const html = renderProjectWebview({
    projects: [project], buildComponents: [], selectedProject: project.applicationFile,
    selectedProjectRunning: false, isRefreshing: false, discoveryError: undefined
  });

  assert.match(html, /class="project-row selected"/);
  assert.match(html, /data-context-kind="project"/);
  assert.match(html, /data-context-kind="scene"/);
  assert.match(html, /data-context-kind="game"/);
  assert.match(html, /data-context-kind="command"/);
  assert.match(html, /Build Project/);
  assert.match(html, /Open Scene/);
  assert.match(html, /Run Game/);
  assert.match(html, /Run Command/);
});

test('renderer escapes project-derived text and attributes', () => {
  const project = makeProject({
    label: 'Demo <& "雪">',
    root: 'D:/DagorEngine/Demo <& "雪">',
    applicationFile: 'D:/DagorEngine/Demo <& "雪">/application.blk'
  });
  const html = renderProjectWebview({ projects: [project], buildComponents: [], selectedProject: undefined });

  assert.match(html, /Demo &lt;&amp; &quot;雪&quot;&gt;/);
  assert.doesNotMatch(html, /data-select="D:\/DagorEngine\/Demo <&/);
});

test('renderer shows each discovery empty state', () => {
  const empty = renderProjectWebview({ projects: [], buildComponents: [], selectedProject: undefined });
  const refreshing = renderProjectWebview({ projects: [], buildComponents: [], selectedProject: undefined, isRefreshing: true });
  const failed = renderProjectWebview({ projects: [], buildComponents: [], selectedProject: undefined, discoveryError: new Error('offline') });

  assert.match(empty, /No Dagor projects found/);
  assert.match(refreshing, /Searching for Dagor projects/);
  assert.match(failed, /Dagor project search failed/);
});

test('renderer uses localized webview copy and dynamic build labels', () => {
  const project = makeProject();
  const html = renderProjectWebview({
    projects: [project], buildComponents: [], selectedProject: project.applicationFile,
    strings: {
      language: 'ru', refresh: 'Обновить', createProject: 'Создать проект',
      buildProject: 'Собрать проект', selectComponents: 'Выберите компоненты:',
      build: 'Сборка', stopBuild: 'Остановить сборку', openDaViewer: 'Открыть daViewer',
      openScene: 'Открыть сцену', scenesLocation: 'Сцены находятся в develop/levels',
      createScene: 'Создать сцену', runGame: 'Запустить игру',
      gamesLocation: 'Исполняемые файлы игры находятся в game/', runCommand: 'Запустить команду',
      commandsLocation: 'Файлы команд находятся в game/'
    }
  });

  assert.match(html, /<html lang="ru">/);
  assert.match(html, /Обновить/);
  assert.match(html, /Создать проект/);
  assert.match(html, /data-build-label="Сборка" data-stop-build-label="Остановить сборку"/);
});
