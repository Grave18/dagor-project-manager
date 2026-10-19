# Maintenance Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make webview actions operate only on current catalog data, extract duplicated and oversized responsibilities, and add a bounded JavaScript type-check command without converting source files to TypeScript.

**Architecture:** Webview messages carry catalog identifiers; the extension resolves all action targets against the current catalog. A shared path utility replaces duplicate containment helpers, while a scene deletion controller owns inspection, confirmation, logging, deletion, and refresh. TypeScript is development-only tooling for JSDoc checks with no emitted JavaScript.

**Tech Stack:** CommonJS JavaScript, VS Code API, JSDoc, TypeScript compiler in check-only mode.

**Spec:** `docs/superpowers/specs/2026-10-19-maintenance-refactor-and-js-types-design.md`

## Global Constraints

- Keep the extension's CommonJS JavaScript runtime and current user-facing behavior.
- Webview messages cannot provide project structures or filesystem paths for extension actions.
- Scene deletion keeps its current safeguards and leaves assets untouched.
- Do not convert `.js` files to `.ts`, emit JavaScript, or change the module system.
- Do not optimize scene-reference scanning without measurements on a large project.

## Review Focus

- Unknown or object-shaped project identifiers: no action is dispatched.
- Scene/executable/command paths not present in the catalog: no action is dispatched.
- Malformed messages and components: safely ignored or filtered.
- Scene deletion cancellation, trash failure, permanent-delete cancellation, and partial failure: preserve the existing branches and reporting.
- Windows path prefixes and parent traversal: shared containment behavior remains equivalent.

## Files

- Create `src/utils/pathUtils.js` for the single `isPathWithin` predicate.
- Modify `src/projects/projectActions.js` and `src/scenes/sceneActions.js` to import the shared predicate.
- Create `src/scenes/sceneDeletionController.js` for the scene deletion orchestration currently in the webview provider.
- Create `src/views/projectWebview/webviewMessages.js` for request-shape validation and its JSDoc contract.
- Modify `src/extension.js` to construct and inject the controller.
- Modify `src/views/projectWebview/ProjectWebviewProvider.js`, `projectWebviewClient.js`, and `renderProjectWebview.js` to validate and use canonical catalog identifiers.
- Modify `src/build/buildManager.js` and `src/extension.js` only for verified dead code.
- Modify `package.json` and its lockfile; create `tsconfig.json` for check-only JSDoc pilot.
- Modify `test/extension.test.js` and `test/projectWebview.test.js`; create `test/pathUtils.test.js` and `test/sceneDeletionController.test.js`.

## Tasks

### Task 1: Canonicalize webview message data

**Files:** modify the provider, renderer, and webview client.

- [x] Remove the serialized `data-project-data` payload; client messages send only `data-project` (`applicationFile`).
- [x] Add a record guard and route `ready` state through the existing message handler.
- [x] Reject messages with invalid type/project identifiers; remove all `project || projectData` fallbacks.
- [x] Resolve scene paths through `project.scenes`; validate game executable and command values against the canonical project before dispatch.
- [x] Keep build component filtering and ensure unknown action names have no effect.
- [x] Add tests proving unknown projects and forged scene paths never reach action methods.

### Task 2: Share path containment and remove proven dead fields

**Files:** create `src/utils/pathUtils.js`; modify both action modules, `buildManager.js`, and `extension.js`.

- [x] Move the existing `isPathWithin` predicate verbatim to the shared utility and import it from both callers.
- [x] Add boundary tests for identical, nested, sibling-prefix, parent-traversal, and absolute paths.
- [x] Remove only unused `BUILD_COMPONENTS.description` properties.
- [x] Remove the empty `deactivate` export only after confirming no cleanup subscriptions or call-site depend on it.

### Task 3: Extract scene deletion orchestration

**Files:** create `src/scenes/sceneDeletionController.js`; modify provider and `src/extension.js`.

- [x] Create `createSceneDeletionController({ vscodeApi, catalog, sceneActions, outputChannel })` exposing `deleteScene(projectId, scenePath)`.
- [x] Move the provider's scene inspection, confirmation, output logging, trash/permanent-delete fallback, partial-failure handling, and catalog refresh into that controller without changing behavior.
- [x] Re-resolve the project and scene from the catalog at the time of deletion.
- [x] Leave the provider method as context-target extraction plus delegation; remove its now-unused `sceneActions` dependency.
- [x] Add controller coverage for unknown scenes, declined confirmation, fallback cancellation, and trash/permanent-delete failure handling.

### Task 4: Add the bounded JSDoc type-check pilot

**Files:** modify `package.json` and lockfile; create `tsconfig.json`; add JSDoc contracts to the provider and new shared/controller modules as needed.

- [x] Add development-only `typescript` and `@types/vscode` versions compatible with `engines.vscode`.
- [x] Configure `allowJs`, `checkJs`, `noEmit`, CommonJS resolution, and a bounded include set for the message boundary and refactored services.
- [x] Add a `typecheck` script and resolve actionable diagnostics without blanket suppressions.
- [x] Keep all shipped source as `.js` and verify no compiler output is created.

### Task 5: Review and verify the change set

- [x] Run `npm run typecheck` and review every diagnostic.
- [x] Run the focused regression tests and the full existing test command.
- [x] Run `node --check` on modified JavaScript files.
- [x] Run `git diff --check` and manually inspect the full diff for unchanged deletion safeguards and trusted action targets.

## Interfaces

- `isPathWithin(directory, candidate) -> boolean` is exported by `src/utils/pathUtils.js`.
- `isWebviewMessage(value) -> boolean` validates payload shape before provider routing.
- `createSceneDeletionController(dependencies) -> { deleteScene(projectId, scenePath) }` resolves canonical entities through `catalog.projects`.
- `ProjectWebviewProvider` receives `sceneDeletionController`; `deleteContextScene()` delegates only a project identifier and a scene path.

## Execution note

The user explicitly selected the current `main` branch in this project context. Continue there; do not create or switch worktrees/branches. The source remains JavaScript. The check-only compiler pilot is allowed by the approved spec and must not emit runtime files.
