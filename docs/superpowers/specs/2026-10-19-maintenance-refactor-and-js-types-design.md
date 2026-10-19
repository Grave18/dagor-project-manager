# Dagor Project Manager: maintenance refactor and gradual JavaScript typing

**Date:** 2026-10-19
**Status:** Approved and implemented

## Goal

Address a concrete webview trust-boundary bug, remove small verified duplication, and reduce the amount of unrelated work handled by `ProjectWebviewProvider`. Check whether JSDoc-based JavaScript type checking is useful before considering a full TypeScript migration.

Keep the extension's CommonJS JavaScript runtime and current user-facing behavior.

## Proposed changes

### 1. Treat webview messages as requests, not project data

The webview currently sends a serialized project object with actions. The provider looks up a matching project in the catalog, but build, stop-build, and viewer actions can fall back to the object sent by the webview. Scene opening can also take a scene path from that object. A message from the webview must not supply the project structure or filesystem paths that the extension acts on.

- Change project-bearing messages to send only the project's `applicationFile` identifier.
- Resolve that identifier against the current project catalog for every action; reject unknown projects.
- Resolve scene, executable, and command identifiers against the catalog entry. Ignore paths and project structures that are not catalog-owned.
- Keep the existing build-component allowlist and validate the message type/action and expected primitive fields before dispatch.
- Add focused tests for unknown project identifiers, forged scene paths, and action payloads with the wrong shape.

### 2. Share path containment logic

`projectActions.js` and `sceneActions.js` define the same `isPathWithin` helper. Move the helper to a small shared path utility module and have both callers import it. Preserve its current behavior and add coverage for the root itself, nested paths, sibling-prefix paths, parent traversal, and absolute paths.

### 3. Move scene deletion orchestration out of the webview provider

`ProjectWebviewProvider` currently owns webview lifecycle and routing as well as the full scene deletion inspection, confirmation, logging, trash/fallback deletion, and catalog refresh flow. Extract that flow to a scene deletion controller/service. The provider should retain context-menu target handling and delegate a canonical project identifier and scene path; the service should re-resolve them through the catalog before acting.

Keep the existing safety behavior: inspect before confirmation, report references and export files, leave assets untouched, use the system trash first, require a separate confirmation for permanent deletion, log partial failures, and refresh the catalog after deleting the scene directory.

### 4. Remove only confirmed dead code

- Remove `BUILD_COMPONENTS.description` values if the repository-wide search still shows no consumer; retain labels and values.
- Remove the empty `deactivate()` export if no extension cleanup is registered there and the manifest/runtime does not rely on it.
- Do not remove template files, generated assets, tests, or documentation as cleanup without separate evidence.

### 5. Trial JSDoc-based checking before a TypeScript port

Keep source files as `.js`. Add TypeScript compiler and VS Code API declarations as development-only tooling, then run a bounded `checkJs` pilot over the webview message boundary and the refactored services. Add JSDoc types for message variants and injected service interfaces where they clarify the contract. Do not emit JavaScript or change the extension's runtime/module format.

Review the pilot diagnostics before expanding it. If the pilot requires broad annotations or suppressions to produce value, stop at the pilot and revisit the migration decision rather than adding `any` or blanket ignores.

## Out of scope

- Converting all `.js` files to `.ts`.
- Changing the UI, localization, commands, or project-generation behavior.
- Reworking scene-reference scanning performance without measurements on a large project.
- Introducing runtime validation libraries or a new module system.

## Acceptance criteria

- Webview messages cannot make actions operate on a project, scene, executable, or command that is absent from the current catalog.
- Existing intended webview actions continue to work with canonical catalog data.
- Both path-containment callers use one shared implementation with equivalent behavior.
- Scene deletion behavior and safeguards remain unchanged after extraction.
- Dead-code removals are backed by repository-wide usage checks.
- The JSDoc pilot has a documented result and a repeatable check command; no emitted runtime files or blanket type suppressions are introduced.
- Existing tests pass, with focused regression tests added for the changed message and deletion contracts.

## Risks and mitigations

- **Message contract drift:** update client and provider together and cover each supported message path with tests.
- **Deletion behavior regression:** preserve the current confirmation text and branches; test cancellation, trash success/failure, permanent-delete confirmation, and partial failure.
- **Noisy type-check diagnostics:** keep the first pilot bounded and report what remains before widening its scope.
- **Path helper behavior changes:** move the implementation without changing its predicate and test boundary cases.

## TypeScript recommendation

Do not migrate the project wholesale yet. JSDoc plus `checkJs` can add useful checks around VS Code API calls, message payloads, and service contracts while keeping the existing JavaScript runtime. A full TypeScript port becomes easier to assess after this pilot shows how much annotation work the current code needs and whether the checks catch meaningful mistakes.

## References

- [TypeScript: JavaScript projects utilizing TypeScript](https://www.typescriptlang.org/docs/handbook/intro-to-js-ts.html)
- [TypeScript: `checkJs` compiler option](https://www.typescriptlang.org/tsconfig/checkJs.html)
- [VS Code: Extension Anatomy](https://code.visualstudio.com/api/get-started/extension-anatomy)
- [VS Code: Webview API](https://code.visualstudio.com/api/extension-guides/webview)
