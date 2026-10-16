# Dagor Project Manager Modularization Design

## Context

The extension's 940-line `extension.js` currently combines project discovery, tool launching, project actions, build process management, watcher lifecycle, command registration, and the full webview implementation. The existing 593-line test harness is separate and will remain unchanged.

Formatting or local cleanup would leave these responsibilities coupled. Extracting only the webview would still leave discovery, launching, and build lifecycle mixed in the entry point. This design separates those responsibilities while preserving behavior.

## Goal

Split the extension by responsibility without changing its commands, UI, file matching, process behavior, error messages, or VS Code manifest entry point.

## Module Boundaries

- `extension.js`: composition root. Creates the catalog, build manager, project actions, and webview provider; registers extension commands and general watchers; connects dependencies.
- `projectCatalog.js`: `ProjectCatalog` and project discovery helpers. Owns discovery and refresh state for projects, scenes, games, and command files.
- `dagorTools.js`: tool path resolution, executable validation, process launch, and opening BLK files with Dagor tools.
- `buildManager.js`: build start/stop, child-process lifecycle, running-build state, and the game executable watcher's pause/resume behavior.
- `projectActions.js`: Explorer folder resolution, Quick Picks, and actions for opening scenes, running games, and running command files. Uses injected catalog/build/tool dependencies.
- `projectWebview.js`: `ProjectWebviewProvider`, its HTML/CSS/JS, and message handling. Receives action callbacks through its constructor instead of importing process or filesystem behavior directly.

`package.json` continues to load `./extension.js`. No new dependencies or shared generic framework are introduced.

## Dependency Flow

`extension.js` constructs and connects the modules. The catalog provides project data to the action layer and webview. Project actions use the catalog, tool launcher, and build manager. The webview calls injected actions and renders catalog data. The build manager owns its running-build state and executable watcher lifecycle. General project, scene, command, and build-script watchers remain registered during activation as they are now.

Dependencies are passed explicitly so modules do not share mutable module-level globals for catalog, subscriptions, or build state.

## Compatibility Requirements

- Keep all contributed command IDs, Explorer menu behavior, and the `package.json` `main` value.
- Preserve discovery roots and glob patterns, including `develop/levels` scene discovery, root-level `.cmd` discovery, and executable discovery depth.
- Preserve build output, cancellation, watcher pause/resume, tool arguments, terminal commands, and existing user-facing messages.
- Preserve webview markup, labels, empty states, animations, accessibility attributes, and message behavior.
- Keep the existing `test/extension.test.js` file and its fixtures in place; do not expand this work into a test-harness rewrite.

## Migration Sequence

1. Extract project catalog and discovery into `projectCatalog.js`.
2. Extract tool resolution and launching into `dagorTools.js`.
3. Extract build process and executable-watcher lifecycle into `buildManager.js`.
4. Extract Explorer project actions into `projectActions.js` and inject their dependencies.
5. Extract the webview provider into `projectWebview.js` and wire its callbacks from `extension.js`.
6. Reduce `extension.js` to activation and module composition; confirm package entry point and compatibility requirements above.

Each step moves existing logic with minimal edits; behavior changes and unrelated cleanup are out of scope.

## Validation

The existing test suite remains unchanged as the regression reference. Review the final diff for unchanged command IDs, watcher patterns, tool invocation arguments, rendered UI strings, and package entry point. Run syntax and whitespace checks after the extraction.
