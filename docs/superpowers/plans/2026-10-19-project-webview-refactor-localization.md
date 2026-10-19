# Project Webview Refactor and Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Split the Projects webview into provider, renderer, CSS, and client JavaScript modules, and localize all extension-owned UI in English and Russian without changing behavior.

**Architecture:** `ProjectWebviewProvider` owns VS Code lifecycle, state, and message handling; a pure renderer produces the initial HTML from a display model; external CSS and client JavaScript are loaded as scoped webview resources. Package contribution strings use VS Code `package.nls` files, while runtime strings use `vscode.l10n.t` and `bundle.l10n` files; the webview receives any client-side labels from the extension host.

**Tech Stack:** CommonJS JavaScript, VS Code Extension API (`webview.asWebviewUri`, `vscode.l10n`), Node.js built-in test runner, `@vscode/l10n-dev` as a development dependency.

**Spec:** `docs/superpowers/specs/2026-10-19-project-webview-refactor-localization-design.md`

## Global Constraints

- Preserve the current project manager layout, interactions, messages, accessibility labels, animations, and command behavior.
- Store webview CSS and browser-side JavaScript in standalone files with normal syntax highlighting.
- Add English default text and Russian translations for all extension-owned user-facing strings.
- English is the source and fallback language. Russian is selected automatically when the VS Code display language is Russian; no extension-specific language setting is added.
- Localize extension-owned UI, but do not localize text emitted by Dagor tools such as `build.py`.
- Do not introduce TypeScript, a bundler, or a web framework.
- Use `webview.asWebviewUri` and restrict `localResourceRoots` to the webview asset directory.
- Keep dynamic project data HTML-escaped; preserve message types, payload shapes, selection behavior, and build-state updates.

## Review Focus

- **Project-derived strings containing HTML metacharacters, quotes, or Unicode:** renderer tests assert escaped values and valid markup attributes.
- **Missing or incomplete Russian translations:** localization checks assert every runtime source key has a Russian entry and that API fallback remains the English source.
- **Manifest localization-key drift:** tests assert all `%key%` references resolve in both `package.nls.json` and `package.nls.ru.json`.
- **Webview resource access and CSP:** provider tests assert generated asset URIs, narrow resource roots, external script/style references, and no inline executable JavaScript.
- **Full HTML rerender after selection or build-state changes:** integration tests assert selection, message payloads, build state, and the rendered Build/Stop Build labels remain correct.

---

### Task 1: Separate provider state from HTML rendering

**Files:**
- Create: `src/views/projectWebview/ProjectWebviewProvider.js`
- Create: `src/views/projectWebview/renderProjectWebview.js`
- Create: `test/projectWebview.test.js`
- Modify: `package.json` (include the focused renderer test in the test script)
- Modify: `src/views/projectWebview.js` (temporary rename before creating the directory with the same basename)
- Modify: `src/extension.js`
- Modify: `test/extension.test.js`

**Interfaces:**
- `ProjectWebviewProvider({ catalog, buildManager, actions, sceneActions, outputChannel })` owns view state and messages.
- `renderProjectWebview({ projects, selectedProject, selectedProjectRunning, isRefreshing, discoveryError, animation }) -> string` renders current markup and currently embedded assets without accessing VS Code APIs or invoking actions.
- `src/extension.js` imports `ProjectWebviewProvider` from `./views/projectWebview/ProjectWebviewProvider`.

- [x] **Step 1: Add renderer characterization tests**

Add tests for the existing project list, selected project card, empty states, context attributes, and escaping a project label/path containing `<`, `&`, quotes, and non-ASCII text.

- [x] **Step 2: Run the focused test and confirm the new renderer is missing**

Run: `node --test test/projectWebview.test.js`
Expected: FAIL because `renderProjectWebview` has not been implemented.

- [x] **Step 3: Move the current module aside, then create the view directory**

Rename `src/views/projectWebview.js` to `src/views/projectWebviewProvider.js` before creating `src/views/projectWebview/`; this avoids a file/directory name collision on Windows.

- [x] **Step 4: Extract pure render helpers and `renderProjectWebview`**

Move `escapeHtml`, `iconSvg`, project display path formatting, row/card markup, and empty-state markup out of the provider. Keep all current labels and markup unchanged in this task. Pass a complete display model into the renderer; it must not read catalog state or invoke actions.

- [x] **Step 5: Keep provider message handling unchanged and delegate HTML creation**

Move `ProjectWebviewProvider` into its module and replace `getHtml()` with a call to `renderProjectWebview`. Update `extension.js` and the extension test import to the new path. Preserve constructor dependencies and all current `postMessage` payloads.

- [x] **Step 6: Run focused and integration tests**

Run: `node --test test/projectWebview.test.js test/extension.test.js`
Expected: PASS; existing project/message behavior is unchanged, and renderer assertions pass.

- [x] **Step 7: Commit the provider/renderer extraction**

```bash
git add src/views/projectWebview src/extension.js test/projectWebview.test.js test/extension.test.js src/views/projectWebview.js
git commit -m "refactor: separate project webview rendering"
```

### Task 2: Extract CSS and client JavaScript as scoped webview assets

**Files:**
- Create: `src/views/projectWebview/projectWebview.css`
- Create: `src/views/projectWebview/projectWebviewClient.js`
- Modify: `src/views/projectWebview/ProjectWebviewProvider.js`
- Modify: `src/views/projectWebview/renderProjectWebview.js`
- Modify: `src/extension.js`
- Modify: `test/projectWebview.test.js`
- Modify: `test/extension.test.js`

**Interfaces:**
- `ProjectWebviewProvider({ ..., extensionUri })` receives the extension root URI for resource scoping.
- Renderer receives `{ webview, assetUris, ...displayModel }` and includes only the generated CSS and client script URIs in HTML.
- `extension.js` passes `context.extensionUri` to the provider.

- [x] **Step 1: Add resource/CSP assertions**

Extend provider tests to assert that HTML references CSS and JavaScript via `asWebviewUri`, the allowed resource root is only the webview assets directory, and the HTML has a CSP permitting those local resources but no inline executable script.

- [x] **Step 2: Run focused tests to confirm they fail before asset extraction**

Run: `node --test test/projectWebview.test.js`
Expected: FAIL because the provider does not yet configure external resource URIs or scoped roots.

- [x] **Step 3: Move the current stylesheet and browser script unchanged**

Copy the current CSS rules and browser event/message logic into the standalone `.css` and `.js` files. Keep all selectors, animation timings, message types, and payload fields unchanged.

- [x] **Step 4: Configure resource URIs, roots, and CSP**

Set `localResourceRoots` to the webview asset directory. Generate each asset URI with `webview.asWebviewUri`. Replace the inline executable script and style block with local resource links. Keep the current dynamic panel-opening animation working; retain only the inline-style allowance required by that animation. Validate asset paths before assigning HTML and report missing assets through the existing output channel.

- [x] **Step 5: Verify tests and syntax**

Run: `node --check src/views/projectWebview/ProjectWebviewProvider.js; node --check src/views/projectWebview/renderProjectWebview.js; node --check src/views/projectWebview/projectWebviewClient.js; node --test test/projectWebview.test.js test/extension.test.js`
Expected: all syntax checks and tests pass; generated HTML contains no inline executable JavaScript.

- [x] **Step 6: Commit the webview asset extraction**

```bash
git add src/views/projectWebview src/extension.js test/projectWebview.test.js test/extension.test.js
git commit -m "refactor: extract project webview assets"
```

### Task 3: Localize package contributions

**Files:**
- Create: `package.nls.json`
- Create: `package.nls.ru.json`
- Create: `test/localization.test.js`
- Modify: `package.json`
- Modify: `test/extension.test.js` (resolve `%key%` labels for behavior assertions while keeping raw manifest-key checks)

**Interfaces:**
- `package.json` user-facing metadata and contributed strings use `%key%` references.
- Both locale files contain identical key sets; the default file stores English and the `.ru` file stores Russian.

- [x] **Step 1: Add manifest localization-key parity tests in `test/localization.test.js`**

Test that every `%key%` reference in `package.json` resolves in both locale files and that the two locale files have identical key sets.

- [x] **Step 2: Confirm the parity test fails before localization files exist**

Run: `node --test test/localization.test.js`
Expected: FAIL because the locale files and `%key%` references are not yet present.

- [x] **Step 3: Move visible manifest strings to localized keys**

Replace user-facing command titles, submenu labels, configuration title/descriptions, and other localizable manifest text with `%key%` references. Keep command IDs, setting IDs, enum values, and machine-readable metadata unchanged.

- [x] **Step 4: Add complete English and Russian package translations**

Create `package.nls.json` and `package.nls.ru.json` with matching keys for every manifest reference. English is the current copy; Russian translations must preserve Dagor product names and command intent.

- [x] **Step 5: Include package localization checks in the standard test command**

Update `package.json`'s `test` script to include `test/localization.test.js`.

- [x] **Step 6: Run package localization tests**

Run: `node --test test/extension.test.js`
Expected: PASS; every manifest key resolves in both locales.

- [x] **Step 7: Commit package localization**

```bash
git add package.json package.nls.json package.nls.ru.json test/extension.test.js
git commit -m "feat: localize extension manifest"
```

### Task 4: Localize extension runtime and webview text

**Files:**
- Create: `l10n/bundle.l10n.json`
- Create: `l10n/bundle.l10n.ru.json`
- Modify: `test/localization.test.js`
- Modify: `package.json`
- Create: `package-lock.json` if dependency installation produces it; commit it for reproducible tooling.
- Modify: `src/extension.js`
- Modify: `src/build/buildManager.js`
- Modify: `src/dagor/dagorTools.js`
- Modify: `src/projects/projectActions.js`
- Modify: `src/projects/projectCatalog.js`
- Modify: `src/projects/projectGenerator.js`
- Modify: `src/scenes/sceneActions.js`
- Modify: `src/views/projectWebview/ProjectWebviewProvider.js`
- Modify: `src/views/projectWebview/renderProjectWebview.js`
- Modify: `src/views/projectWebview/projectWebviewClient.js`
- Modify: `test/extension.test.js`
- Modify: `test/projectWebview.test.js`

**Interfaces:**
- Extension-host code uses `vscode.l10n.t(message, args?)` for extension-owned runtime strings.
- `package.json` declares `"l10n": "./l10n"`.
- Renderer localizes all initial UI text and supplies encoded `buildLabel` and `stopBuildLabel` values to the client for dynamic build-state updates.
- Client code reads those values from the rendered DOM and contains no user-facing English literals.
- The VS Code test mock exposes `l10n.t(message, args?)`; tests can select English fallback or a Russian translation map.

- [x] **Step 1: Add runtime locale completeness tests**

Test that every string extracted from `vscode.l10n.t` has an English source entry and a Russian translation, including dynamic Build/Stop Build labels. Add an English passthrough `l10n.t` stub to the existing VS Code test mock.

- [x] **Step 2: Confirm runtime localization checks fail before migration**

Run: `node --test test/localization.test.js test/projectWebview.test.js test/extension.test.js`
Expected: FAIL because source calls and runtime locale bundles are not yet complete.

- [x] **Step 3: Add VS Code runtime localization configuration and extraction script**

Add the `l10n` manifest property, install `@vscode/l10n-dev` as a development dependency, and add a repeatable npm script using `npx @vscode/l10n-dev export --outDir ./l10n ./src` to extract the English runtime bundle.

- [x] **Step 4: Localize runtime strings in extension-host modules**

Replace extension-owned user-facing text in activation, tools, build, catalog, project, and scene actions with `vscode.l10n.t` calls, using injected VS Code APIs where modules already receive them. Keep project generation independent from VS Code: expose stable generator error codes and translate them at the extension command boundary. Preserve dynamic arguments through named or indexed placeholders. Do not translate external build-process output, command IDs, paths, protocol values, or component identifiers.

- [x] **Step 5: Localize renderer and dynamic webview labels**

Pass localized English/Russian strings into rendered initial markup. Encode dynamic labels in HTML attributes, and update the client to use those values for Build/Stop Build and accessible labels rather than hardcoded copy.

- [x] **Step 6: Generate English bundle and complete Russian translations**

Run the extraction script; review the generated English source bundle and add the matching Russian translations to `bundle.l10n.ru.json`. Do not leave untranslated keys or change message placeholders.

- [x] **Step 7: Run locale checks and focused tests**

Run: `npm run extract-l10n; node --test test/projectWebview.test.js test/extension.test.js`
Expected: extraction succeeds, locale keys match, English fallback and Russian strings render, and extension tests pass.

- [x] **Step 8: Commit runtime localization**

```bash
git add package.json package-lock.json l10n src test/extension.test.js test/projectWebview.test.js test/localization.test.js test/projectGenerator.test.js
git commit -m "feat: localize extension runtime"
```

### Task 5: Full compatibility and locale review

**Files:**
- Review: `package.json`, `package.nls.json`, `package.nls.ru.json`, `l10n/`, `src/views/projectWebview/`, all runtime modules, and `test/`

**Interfaces:**
- No new interfaces. This task verifies the user-facing behavior specified above.

- [ ] **Step 1: Audit remaining user-facing English literals**

Search extension runtime modules and browser client code for visible English text. Confirm that remaining English is limited to machine-readable identifiers, documented English source strings passed to `vscode.l10n.t`, or external Dagor output.

- [ ] **Step 2: Run all existing and new tests**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 3: Review diff and resource/security setup**

Run: `git diff --check` and inspect the rendered HTML fixtures. Confirm no inline executable JavaScript, scoped local resources, complete locale bundles, unchanged protocol messages, and no unrelated changes.

- [ ] **Step 4: Manually verify both display languages**

Open the Projects view in English and Russian display languages. Check empty/loading states, project selection, all card headings and actions, context menus, prompts, build-state transitions, and panel/section animations.

- [ ] **Step 5: Resolve review findings before handoff**

If a check fails, fix the owning task, rerun its focused test and the full suite, and repeat the affected manual check. Mark this task complete only after all checks pass.
