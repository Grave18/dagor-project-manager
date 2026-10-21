# Dagor Project Manager

Manage DagorEngine projects in VS Code. Build project components, open levels
in daEditor, browse assets with daViewer, and run game executables or command
files from a project panel.

## Requirements

- VS Code 1.85 or later
- A DagorEngine checkout with the Dagor CDK tools
- Python for running a project's `build.py`
- Git on `PATH` when creating a project. Each new project is initialized as a
  Git repository.

## Install

In VS Code, open the Extensions view (`Ctrl+Shift+X`), search for
**Dagor Project Manager**, and select **Install**.

## Find a project

Open DagorEngine, a project folder, or a folder inside DagorEngine in VS Code.
The extension discovers project folders containing `application.blk` and
`prog/build.py` (or `build.py` in the project root). Select the Dagor Project
Manager icon in the Activity Bar to see the projects. Use **Refresh** to search
again.

Each project card shows that project's scenes, game executables, and command
files. The card actions apply to the selected project.

## Project actions

- **Create Project** copies the bundled starter project into the DagorEngine
  root. It initializes a Git repository and starts the `editor_shaders` and
  `assets` builds needed by the starter project. Build output appears in the
  `Dagor Build: <project>` output channel.
- **Build Project** lets you select `code`, `shaders`, `assets`, `vromfs`, and
  `gui` components. A running build can be stopped from the same card.
- **Open daViewer** opens the selected project's `application.blk` in Dagor's
  asset viewer.
- **Open Scene** lists `*.level.blk` files under `develop/levels` and opens the
  selected level in daEditor with its project configuration.
- **Create Scene** creates an empty scene or one based on the starter scene,
  which includes a plane and a cube. New scenes are placed under
  `develop/levels/<scene-name>`.
- **Run Game** lists `.exe` files in `game/` and its immediate subfolders.
  Dedicated-server executables are excluded.
- **Run Command** lists `.cmd` files directly in `game/`. The command runs in
  the VS Code integrated terminal with `game/` as its working directory.
- **Create Command** creates a `.cmd` file directly in `game/` and opens it in
  the editor.

### Deleting items

Use the context menu on a project, scene, or command entry to delete it. The
extension asks for confirmation and normally moves deleted files to the system
trash.

Before deleting a scene, the extension checks for static text references and
reports what it found. It moves the scene folder and identified exported level
files to the trash. References are left unchanged, and **source assets are never
deleted** as part of scene deletion. Dynamic references may not be detected; the
inspection details are available in the **Dagor Project Manager** output
channel.

## Open Dagor files from Explorer (RMB Context Menu)

Right-click a Dagor file in the VS Code Explorer:

- Any `.blk` file can be opened in **blkEditor**.
- `application.blk` can also be opened in **daEditor** or **daViewer**.
- `*.level.blk` can also be opened in **daEditor**. The project folder must be
  part of the open workspace.

Right-click a discovered project folder for project actions such as building,
opening a scene, running the game, and creating a command file.

## Settings

Open Settings and search for **Dagor Project Manager**.

### General

- `dagorProjectManager.language` selects **System**, **English**, or an
  available translation. English is used when the system language has no
  translation.

### Tools

- `dagorProjectManager.toolsDirectory` points to the directory containing
  Dagor CDK executables. The extension checks this setting first, then the
  `DAGOR_CDK_DIR` environment variable, then searches parent folders of the
  open workspace for DagorEngine's CDK directory.
- `dagorProjectManager.daEditorExecutable` defaults to
  `daEditor3x-dev.exe`.
- `dagorProjectManager.daViewerExecutable` defaults to
  `assetViewer2-dev.exe`.
- `dagorProjectManager.blkEditorExecutable` defaults to
  `blkEditor-dev.exe`.

Executable settings accept either a filename in the CDK directory or an
absolute path.

### Build

- `dagorProjectManager.pythonExecutable` selects the Python executable used to
  run `build.py`. It defaults to `python`.

## Development

Run `npm ci` in this repository, then open it in VS Code and press `F5` to
start an Extension Development Host. To check the source locally, run:

```sh
npm test
npm run typecheck
```

### Project git repository
[https://github.com/Grave18/dagor-project-manager](https://github.com/Grave18/dagor-project-manager)
