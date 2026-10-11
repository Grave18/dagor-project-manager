# Dagor Project Manager for VS Code

Adds a **Dagor Project Manager** submenu to the VS Code Explorer file context menu and a separate **Dagor Project Manager** panel on the Activity Bar.

The **Dagor Project Manager: Projects** view is implemented as a custom panel interface: projects are shown as individual rows; selecting a row expands a project card with actions. The project list is determined by `application.blk` and the corresponding `prog/build.py`; only scenes from that project are shown for each project.

In the project card:

- **Build Project** expands a list of components (`code`, `shaders`, `assets`, `vromfs`, `gui`) with multi-select. The button in the component list starts the build for the selected set. While the build is running, it is replaced by a red **Stop Build** button that stops the process. Output is available in a separate channel **Dagor Build: <name>**.
- **Open daViewer** launches daViewer with the selected project's `application.blk`.
- **Open Scene** expands `*.level.blk` levels for that project; selecting a level launches daEditor with the corresponding `application.blk`.
- **Run Game** lists `.exe` files from the project's `game` folder and its immediate subfolders, except dedicated-server executables (`*-ded-*.exe`). The displayed name omits `.exe`. Selecting an entry launches the executable directly, without additional arguments.
- **Run Command**, below **Run Game**, lists `.cmd` files from the `game` folder and its immediate subfolders. Selecting one opens a VS Code integrated terminal in the `game` folder and runs the command file.
- **Generate Project** is currently a placeholder and does not change any files.
- **Stop Build** stops the running build.

The list of projects, scenes, and game executables updates when files are created/modified and when workspace folders are added. Updates are also available in the panel header.

In the Explorer menu:

- any `.blk`, including `.folder.blk` → **Open with Dagor blkEditor**;
- `application.blk` → also **Open with Dagor daEditor** and **Open with Dagor daViewer**;
- `*.level.blk` → also **Open with Dagor daEditor**.

For levels, the launch format is `daEditor3x-dev.exe <application.blk> <level.blk>`. For `application.blk`, daEditor and daViewer are launched with the project configuration path.

## Installation without Marketplace

1. Open the repository root in VS Code.
2. Press `Ctrl+Shift+P`, run **Developer: Install Extension from Location...**, and select the folder `project_stalker/tools/vscode-dagor-blk`.
3. Reload the VS Code window if prompted.

To temporarily load the extension during development, open this folder as a separate project and press `F5` to launch the Extension Development Host.

## Tool Paths

The extension first uses the `dagorBlk.toolsDirectory` VS Code setting, then the `DAGOR_CDK_DIR` environment variable. If neither is set, it searches for `tools/dagor_cdk/windows-x86_64` (or `windows-arm64`) upward from the open workspace folder.

If needed, specify the path in VS Code user or workspace settings:

```json
{
  "dagorBlk.toolsDirectory": "D:\\path\\to\\DagorEngine\\tools\\dagor_cdk\\windows-x86_64"
}
```

Executable names are configurable via `dagorBlk.blkEditorExecutable`, `dagorBlk.daEditorExecutable`, and `dagorBlk.daViewerExecutable`; each value can be a name inside the CDK directory or an absolute path. Defaults are `blkEditor-dev.exe`, `daEditor3x-dev.exe`, and `assetViewer2-dev.exe` respectively. The build interpreter can be specified via `dagorBlk.pythonExecutable` (default `python`).
