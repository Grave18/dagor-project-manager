# Delete Scene Implementation Plan

> Inline implementation in the current workspace. Steps are tracked here for review.

**Goal:** Add safe scene deletion from the Projects webview with a VS Code confirmation and an actionable Output log.

**Architecture:** Add a focused `sceneActions.js` module to inspect source folders, exports, and static references, and to delete selected paths. `ProjectWebviewProvider` owns confirmation, logging, trash fallback, and catalog refresh. `extension.js` registers a reusable Output channel and routes the scene context command.

**Tech Stack:** VS Code Extension API, Node.js `fs/promises` and `path`, existing webview context menus.

**Spec:** `docs/superpowers/specs/2026-10-18-delete-scene-design.md`

## Global Constraints

- Assets are never deleted with a scene.
- Configuration references are reported, never rewritten or deleted.
- Only a single-level scene folder is eligible for recursive deletion.
- Export candidates must resolve within the project's `game` directory.
- Failed trash moves require a separate confirmation before permanent deletion.

## Tasks

### Task 1: Inspect scene ownership and references

- [x] Create `sceneActions.js` with scene-folder validation, `exportPath` resolution, existing export discovery, and static exact-reference scanning.
- [x] Protect folders containing zero or multiple level files or symbolic links from recursive deletion.

### Task 2: Add the scene context action and confirmation flow

- [x] Add a **Delete Scene** command and scene-only webview context menu item.
- [x] Confirm the source folder, export files, and discovered references before moving anything to trash.
- [x] Refresh the project catalog after the source folder is removed.

### Task 3: Log deletion outcomes

- [x] Create one `Dagor Project Manager` Output channel and pass it to the provider.
- [x] Log each deleted or failed path, reference locations, skipped exports, and reminders that references and assets were left unchanged.
- [x] Ask before permanently deleting paths that could not be moved to trash.

## Verification

- [x] JavaScript syntax checks, package JSON parsing, and `git diff --check` passed.
- [ ] Automated tests and UI deletion flow were not run in this pass.

## Review Focus

- A malicious or malformed `exportPath` must never escape the project's `game` directory.
- A temporary directory containing multiple `.level.blk` files must not be recursively deleted.
- Partial failures must be visible in the log and must not claim full success.
