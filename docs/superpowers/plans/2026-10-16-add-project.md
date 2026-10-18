# Add Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a button that creates a named Dagor project directly in the DagorEngine root, with an editable plane-and-cube level and a build script that produces the executable later.

**Architecture:** Bundle a small, complete starter project inside the extension. A focused generator resolves a real engine root, copies the bundle while replacing explicit markers in text and paths, validates the result, and removes only a newly created incomplete destination on failure. The webview button invokes the existing Generate Project command, which owns VS Code prompts and refreshes the project catalog after success.

**Tech Stack:** VS Code extension API, Node.js built-in `fs` and `path`, Dagor project BLK/Python files, existing Dagor CDK tools.

**Spec:** `docs/superpowers/specs/2026-10-16-add-project-design.md`

## Global Constraints

- DagorEngine must be discoverable. Creation must never fall back to an arbitrary workspace directory.
- The destination is exactly one directory below the engine root: `DagorEngine/<project-name>`.
- The starter template is bundled with the extension. It must not depend on a `templateProject` directory existing in an engine checkout.
- The template contains project configuration, `prog/build.py`, and the complete editable level data needed by daEditor.
- The level is stored at `develop/levels/<project-name>/<project-name>.level.blk` and contains the requested plane and cube.
- The template contains no prebuilt game executable. A successful build creates executable output in the project's `game` directory.
- Project-specific names and paths use explicit template markers. Replacement applies to text files and file/directory names; binary assets are copied as-is. Generation fails if a marker remains in generated text or paths.
- A destination name must be a single safe directory name. Existing destinations are never overwritten.
- On generation or validation failure, remove the newly created incomplete destination and report the failure.

## Review Focus

- A workspace contains no DagorEngine ancestor: show an error and create nothing.
- Multiple engine roots are discoverable: ask the user to choose one before creating anything.
- The name is empty, contains path separators, or names an existing directory: reject it without touching existing files.
- A bundled or generated path/text file still contains a template marker: fail validation and roll back the newly created destination.
- A bundled binary mesh asset contains arbitrary bytes: copy it unchanged; never decode and rewrite it as text.

---

### Task 1: Bundle the starter project and editable level

**Files:**
- Create: `templates/starter-project/application.blk`
- Create: `templates/starter-project/prog/**` (minimal build configuration and source files)
- Create: `templates/starter-project/develop/levels/__PROJECT_NAME__/__PROJECT_NAME__.level.blk`
- Create: `templates/starter-project/develop/levels/__PROJECT_NAME__/heightmapLand/entities.blk` and `.level.local.blk`
- Create: `templates/starter-project/develop/levels/__PROJECT_NAME__/**` (all editor plugin and built-scene data required for the level)
- Create: `templates/starter-project/develop/assets/**` (only assets referenced by the starter level or project configuration)
- Create: `test/starterLevel.test.js`

**Interfaces:**
- Produces: a self-contained project tree whose project-specific text and path names use the marker `__PROJECT_NAME__`.

- [x] Build the project files from the known Dagor starter configuration and include the build script at `prog/build.py`; keep all generated outputs and executables out of the bundle.
- [x] Use the verified `heightmapLand/entities.blk` representation so Plane and Cube appear as editable entities in daEditor; save the startup camera in the level-local settings.
- [x] Include the test cube mesh, texture, and folder metadata referenced by both entities; keep binary assets byte-for-byte.
- [x] Add the matching daEditor level metadata and associated plugin files under `develop/levels/__PROJECT_NAME__`; enable the entity manager and heightmapLand plugin and set its export target to a project-local runtime level path.
- [x] Inspect the bundled tree for absolute machine paths, files unrelated to this minimal project, and unintended executables; remove those before proceeding.

### Task 2: Implement safe template generation

**Files:**
- Create: `projectGenerator.js`
- Create: `test/projectGenerator.test.js`
- Modify: `test/extension.test.js`

**Interfaces:**
- `findDagorEngineRoots(workspaceRoots: string[], configuredToolsDirectory?: string): string[]` returns deduplicated canonical engine-root paths that contain `build_all.py` and `tools/dagor_cdk`.
- `createProject({ projectName: string, engineRoot: string, templateRoot: string }): { projectRoot: string, applicationFile: string }` copies and validates the project or throws an actionable `Error`.

- [x] Implement root discovery from each workspace folder and its ancestors, plus the engine root inferred from the configured Dagor CDK tools directory; accept only roots containing both engine markers.
- [x] Validate `projectName` as one directory name using `^[A-Za-z0-9][A-Za-z0-9_-]*$`; reject empty names, dot segments, separators, and an existing destination before writing.
- [x] Add failing tests for engine-root discovery (zero, one, and multiple roots), invalid names, destination collision, marker replacements, byte-preserved binary assets, and rollback when copied output fails validation.
- [x] Validate that `templateRoot` contains the required project and level files before creating the destination; report an actionable error if the bundled template is missing or incomplete.
- [x] Copy template directories and files into `engineRoot/projectName`, replacing `__PROJECT_NAME__` in relative paths and an explicit allowlist of UTF-8 text extensions (`.blk`, `.py`, `.jam`, `.cmd`, `.das`, `.txt`, `.json`, `.xml`) plus the extensionless `prog/jamfile`; copy all other files byte-for-byte and reject destination path collisions after marker replacement.
- [x] Validate `application.blk`, `prog/build.py`, the marker-named `.level.blk`, referenced level assets, and the absence of `__PROJECT_NAME__` in generated paths and text files.
- [x] Wrap copy and validation in rollback logic that recursively removes only the destination created by the current call, then rethrows the original error.
- [x] Run `node --test test/projectGenerator.test.js` and confirm all generation and rollback cases pass.
- [x] Run `node --check projectGenerator.js` and inspect the diff for path traversal, accidental binary rewriting, and unsafe cleanup targets.

### Task 3: Connect the button and VS Code flow

**Files:**
- Modify: `projectWebview.js`
- Modify: `extension.js`
- Modify: `package.json`

**Interfaces:**
- Webview emits `{ type: 'addProject' }` when its Add Project button is activated.
- `ProjectWebviewProvider.handleMessage` routes `addProject` to the contributed `dagorProjectManager.generateProject` command.
- The command prompts for a name, chooses among multiple roots with Quick Pick, calls `createProject(...)`, and refreshes `catalog` after success.

- [x] Render **Add Project** as a left-aligned button immediately below `.project-list`; keep **Refresh** in the toolbar at the top right.
- [x] Add a failing extension test for the webview's Add Project placement/message and the command's catalog refresh after successful creation.
- [x] Add webview click handling that posts `addProject`, and route that message to `vscode.commands.executeCommand('dagorProjectManager.generateProject')`.
- [x] Replace the existing “not implemented” command handler with a flow that reads workspace roots and the existing `dagorProjectManager.toolsDirectory` setting, resolves engine candidates, prompts when more than one is found, asks for a project name, and invokes `createProject` with `templateRoot = path.join(context.extensionPath, 'templates', 'starter-project')`.
- [x] On success, refresh the catalog and report the created project path; on cancellation, make no changes; on failure, show the generator's actionable error.
- [x] Update the manifest command title to **Add Dagor Project** while preserving the command id; confirm the project list refresh discovers the new project through its `application.blk` and `prog/build.py`.
- [x] Run `node --check extension.js` and `node --check projectWebview.js`; inspect the rendered markup and CSS changes for the requested button placement.
- [x] Run the focused extension tests and the existing `npm test` suite.

### Task 4: Verify the generated project with Dagor tools

**Files:**
- No additional source files; fix any defects in the files from Tasks 1–3.

**Interfaces:**
- Consumes: `createProject(...)` and the button flow from Tasks 1–3.

- [x] Create a uniquely named project through the Add Project button and confirm its absolute path is an immediate child of the selected `DagorEngine` root (verified against a temporary engine-root fixture).
- [x] Confirm the catalog displays it with **Build Project**, an Open Scene entry under `develop/levels`, and no Run Game entry before a build (verified by the extension integration test).
- [ ] Open the generated `.level.blk` in daEditor and confirm `Plane` and `Cube` are visible and can be edited as separate objects.
- [ ] Run **Build Project** and confirm the executable appears in the generated project's `game` output; verify no executable was present in the bundled template.
- [x] Confirm an occupied destination is rejected without altering its contents and that an injected post-copy validation failure removes only the new incomplete destination.

The daEditor launch and a real engine build remain manual checks; running them would write the temporary verification project and build outputs into the user's existing DagorEngine tree.

