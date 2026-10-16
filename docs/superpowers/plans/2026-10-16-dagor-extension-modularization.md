# Dagor Project Manager Modularization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Split the extension into responsibility-based modules without changing user-visible or runtime behavior.

**Architecture:** Keep `extension.js` as the VS Code entry point and composition root. Move project discovery, Dagor tool launching, build lifecycle, Explorer project actions, and webview rendering into separate modules with explicit dependencies.

**Tech Stack:** CommonJS JavaScript, Node.js built-ins, VS Code Extension API, existing `node:test` harness.

**Spec:** `docs/superpowers/specs/2026-10-16-dagor-extension-modularization-design.md`

## Global Constraints

- Keep all contributed command IDs, Explorer menu behavior, and the `package.json` `main` value.
- Preserve discovery roots and glob patterns, including `develop/levels` scene discovery, root-level `.cmd` discovery, and executable discovery depth.
- Preserve build output, cancellation, watcher pause/resume, tool arguments, terminal commands, and existing user-facing messages.
- Preserve webview markup, labels, empty states, animations, accessibility attributes, and message behavior.
- Keep the existing `test/extension.test.js` file and its fixtures in place; do not expand this work into a test-harness rewrite.
- Do not add dependencies, change behavior, or include unrelated cleanup.

## Review Focus

- Local-only URI checks and missing tool executables retain their current errors and early returns.
- Nested Dagor projects and workspace roots continue to resolve to the same project.
- Missing or nested `game`, `develop/levels`, and `prog` directories retain the same discovery behavior.
- Build start errors, exit/close races, cancellation, and concurrent project builds retain the same lifecycle.
- Webview project switching, empty states, build-state updates, and folder-action messages retain the same behavior.

## Files and Interfaces

- Create `projectCatalog.js`, exporting `ProjectCatalog` and any discovery helpers used by other modules. Accept an injected `ensureExecutableWatcher()` callback for the existing refresh-time watcher recovery.
- Create `dagorTools.js`, exporting the current tool resolution, validation, launch, and BLK-opening functions.
- Create `buildManager.js`, exporting `BuildManager`. Its constructor receives `{ vscodeApi, spawnProcess, refreshCatalog, subscriptions }`; it exposes `start(project, components, onBuildStateChange)` and `stop(project, onBuildStateChange)`.
- Create `projectActions.js`, exporting `createProjectActions({ vscodeApi, catalog, toolRunner, buildManager })`. It returns the folder lookup, Quick Pick, scene, game, command-file, and viewer actions currently registered by the extension.
- Create `projectWebview.js`, exporting `ProjectWebviewProvider`. Its constructor receives `{ catalog, actions, buildManager }`; it renders the current UI and routes webview messages through those dependencies.
- Modify `extension.js` to instantiate the modules, register commands and general watchers, and connect callbacks. Keep its public exports `{ activate, deactivate }`.
- Leave `package.json`, `README.md`, and `test/extension.test.js` unchanged.

## Tasks

### Task 1: Extract project catalog

**Files:**
- Create: `projectCatalog.js`
- Modify: `extension.js`

**Interfaces:**
- Produce: `ProjectCatalog({ ensureExecutableWatcher })` with existing `refresh()` and `discoverProjects()` behavior; default the callback to a no-op and export helpers needed by later modules.
- Consume: existing VS Code workspace API and filesystem helpers.

- [x] Move `ProjectCatalog`, project discovery, and game/scene/command/build-script discovery helpers into `projectCatalog.js` without changing search patterns, returned object fields, sorting, or refresh events.
- [x] Update `extension.js` to import and instantiate `ProjectCatalog` from the new module, passing the existing watcher recovery callback.
- [x] Run `node --check extension.js; node --check projectCatalog.js` and `git diff --check`.

### Task 2: Extract Dagor tool launching

**Files:**
- Create: `dagorTools.js`
- Modify: `extension.js`

**Interfaces:**
- Produce: exports for `findProjectApplication`, `findToolsDirectory`, `resolveExecutable`, `launch`, `runTool`, `getToolsDirectory`, `openSceneInDaEditor`, and `openProjectDaViewer`, retaining current arguments and return behavior.
- Consume: existing VS Code configuration, filesystem, path, and process behavior.

- [x] Move tool path resolution, executable validation, launch, and BLK-opening logic to `dagorTools.js` without changing executable selection, arguments, working directories, or error text.
- [x] Update current callers in `extension.js` to import from `dagorTools.js`.
- [x] Run `node --check extension.js; node --check dagorTools.js` and `git diff --check`.

### Task 3: Extract build lifecycle and executable watcher ownership

**Files:**
- Create: `buildManager.js`
- Modify: `projectCatalog.js`
- Modify: `extension.js`

**Interfaces:**
- Produce: `BuildManager({ vscodeApi, spawnProcess, refreshCatalog, subscriptions })` with `start(project, components, onBuildStateChange)`, `stop(project, onBuildStateChange)`, and `ensureExecutableWatcher()`.
- Consume: the existing catalog refresh callback, VS Code APIs, process spawn, and extension subscriptions.

- [x] Move `runningBuilds`, build start/stop logic, child event handlers, and executable watcher create/pause/resume lifecycle into `BuildManager`.
- [x] Pass `BuildManager.ensureExecutableWatcher()` to `ProjectCatalog` so refresh retains its current watcher recovery behavior without owning watcher state.
- [x] Preserve current build validation, output text, child process options, watcher glob, completion idempotence, and stop behavior.
- [x] Update `extension.js` to construct the manager and route direct/folder build commands through it.
- [x] Run `node --check extension.js; node --check buildManager.js` and `git diff --check`.

### Task 4: Extract Explorer project actions

**Files:**
- Create: `projectActions.js`
- Modify: `extension.js`

**Interfaces:**
- Produce: `createProjectActions({ vscodeApi, catalog, toolRunner, buildManager })` returning actions for folder lookup, Quick Picks, opening scenes/viewer, and running games/command files.
- Consume: `ProjectCatalog`, `dagorTools.js`, and `BuildManager` from prior tasks.

- [x] Move `findProjectForFolder`, path containment, Quick Pick helpers, and project scene/game/command/viewer action functions into `projectActions.js`.
- [x] Preserve local URI checks, nested-project selection, labels/descriptions, terminal `call` command, and launch options.
- [x] Update `extension.js` to register Explorer commands from the returned actions.
- [x] Run `node --check extension.js; node --check projectActions.js` and `git diff --check`.

### Task 5: Extract the webview provider

**Files:**
- Create: `projectWebview.js`
- Modify: `extension.js`

**Interfaces:**
- Produce: `ProjectWebviewProvider({ catalog, actions, buildManager })` with the existing `resolveWebviewView`, `render`, and message-handling behavior.
- Consume: the catalog and action callbacks from prior tasks.

- [x] Move the provider, icon definitions, HTML/CSS/JS rendering, and webview message routing into `projectWebview.js`.
- [x] Replace direct calls to module functions with the injected action/build manager callbacks.
- [x] Preserve markup, strings, animation behavior, escaping, CSP nonce, accessibility states, and message payloads.
- [x] Update `extension.js` to instantiate the provider with injected dependencies.
- [x] Run `node --check extension.js; node --check projectWebview.js` and `git diff --check`.

### Task 6: Finish composition root and compatibility review

**Files:**
- Modify: `extension.js`
- Review: `package.json`, `projectCatalog.js`, `dagorTools.js`, `buildManager.js`, `projectActions.js`, `projectWebview.js`

**Interfaces:**
- Consume: all extracted module exports from Tasks 1–5.
- Produce: an `extension.js` limited to activation, dependency construction, command/watcher registration, and `{ activate, deactivate }` exports.

- [x] Remove duplicate moved implementations and unused imports from `extension.js`.
- [x] Compare command IDs, watcher globs, launch arguments, terminal commands, UI labels/empty states, and package entry point against the spec.
- [x] Run `node --check extension.js; node --check projectCatalog.js; node --check dagorTools.js; node --check buildManager.js; node --check projectActions.js; node --check projectWebview.js` and `git diff --check`.
