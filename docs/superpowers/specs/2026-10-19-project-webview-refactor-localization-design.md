# Project Webview Refactor and Localization Design

## Context

`src/views/projectWebview.js` currently combines the VS Code webview provider, extension-side state and message handling, dynamic HTML rendering, inline CSS, and inline browser JavaScript. The module is 726 lines long. The project manager already has a working UI and its behavior must remain unchanged during this refactor.

The webview is only one part of the extension's user interface. Command names and menu labels live in `package.json`; prompts, errors, Quick Picks, and output messages are produced by extension-side JavaScript. Localization therefore needs to cover the full extension UI, including the webview, rather than only its markup.

## Goals

- Preserve the current project manager layout, interactions, messages, accessibility labels, animations, and command behavior.
- Separate webview lifecycle and message routing from HTML rendering and browser resources.
- Store webview CSS and browser-side JavaScript in standalone files with normal syntax highlighting.
- Add English default text and Russian translations for all extension-owned user-facing strings.
- Use VS Code's localization mechanisms and avoid introducing a UI framework or runtime localization framework.

## Non-goals

- Redesign the project manager UI or change its behavior.
- Localize text emitted by Dagor tools such as `build.py`; that output belongs to external programs.
- Introduce TypeScript, a bundler, or a web framework.
- Refactor unrelated project discovery, build, tool-launch, or scene logic except where it produces user-facing text that must be localized.

## Proposed Structure

```text
src/views/projectWebview/
  ProjectWebviewProvider.js
  renderProjectWebview.js
  projectWebview.css
  projectWebviewClient.js

package.nls.json
package.nls.ru.json
l10n/
  bundle.l10n.json
  bundle.l10n.ru.json
```

`ProjectWebviewProvider` owns the webview lifecycle, extension-side state, context targets, and messages received from the browser. It receives the extension URI through its constructor so it can set a narrow resource root for the webview assets.

`renderProjectWebview` receives a display model, the webview resource URI helpers, and already-localized runtime strings. It builds the HTML structure and escaped project-specific values. It does not access the project catalog or invoke actions. Existing icon and HTML-escaping helpers move to this renderer or a small renderer-local helper, not to a shared generic framework.

`projectWebview.css` contains the current visual rules. `projectWebviewClient.js` contains browser-side DOM interactions, animations, and the existing `postMessage` protocol. Both files remain plain source assets; no build step is introduced.

## Resource Loading and Security

- Load local assets with `webview.asWebviewUri` and restrict `localResourceRoots` to the webview asset directory.
- Use a Content Security Policy that permits only the required local webview resources. The browser script becomes an external resource; no inline executable script is needed.
- Keep the current dynamic project data HTML-escaped. Escape serialized strings placed in HTML attributes or bootstrap data as well.
- Preserve any inline-style capability still needed by the current panel-opening animation, or replace that mechanism only if the same animation behavior can be retained without inline styles. Do not weaken script restrictions to accommodate the extraction.
- Continue assigning `webview.html` only when the extension currently renders; splitting assets must not add extra full webview reloads.

VS Code webviews isolate local files and require `asWebviewUri`; their `localResourceRoots` and CSP should be kept as restrictive as possible. The webview guide also recommends extracting inline scripts and styles into local resources. [VS Code Webview API guide](https://code.visualstudio.com/api/extension-guides/webview)

## Localization

English is the source and fallback language. Russian is selected automatically when the VS Code display language is Russian; no extension-specific language setting is added.

Use VS Code's two localization paths:

- `package.nls.json` contains English defaults for strings referenced from `package.json` using `%key%` syntax. `package.nls.ru.json` provides Russian equivalents for the same keys.
- `l10n/bundle.l10n.json` is the English runtime string bundle and `l10n/bundle.l10n.ru.json` contains Russian translations. Set the manifest `l10n` property and use `vscode.l10n.t` for extension-side runtime strings.

Migrate extension-owned user-facing text across the manifest and extension code: webview labels and empty states, Quick Picks, confirmation prompts, notifications, errors, and extension-generated output-channel messages. Keep identifiers, message types, command IDs, paths, build component values, and other machine-readable strings unchanged. External Dagor build output remains untouched.

The webview browser script does not call `vscode.l10n` directly. The extension-side renderer localizes initial markup, and the provider supplies any localized labels that the client needs when updating text dynamically (for example, Build/Stop Build). Values passed to the browser must be safely encoded.

Use `@vscode/l10n-dev` as a development-only extraction/check tool for runtime strings, with a repeatable npm script. Keep manifest translations in the standard `package.nls` files. VS Code documents `vscode.l10n.t`, the `l10n` manifest property, generated `bundle.l10n.json`, and `package.nls.<locale>.json` separately because manifest contributions and runtime strings use different localization mechanisms. [VS Code localization API and bundle format](https://code.visualstudio.com/updates/v1_72), [VS Code localization API reference](https://code.visualstudio.com/api/references/vscode-api)

## Message Flow

1. The provider converts catalog and UI state into a display model.
2. Runtime strings used in HTML are localized through `vscode.l10n.t` before rendering.
3. The renderer creates markup and converts the CSS and client JavaScript paths using the webview API.
4. The client script sends the existing message types and payloads to the provider.
5. Dynamic localized client labels are supplied as escaped data by the renderer/provider and used without hardcoded English strings.

Message types, payload shapes, selection behavior, and build-state updates remain compatible with the current implementation.

## Error Handling

- If a required asset file is missing before HTML is rendered, report that through the existing extension output channel and keep activation/project discovery available.
- Missing translations fall back to the English source text through the VS Code localization API.
- A missing locale bundle must not prevent activation or project discovery.
- Malformed user-derived display values must continue to be escaped before insertion into HTML.

## Validation

- Run the existing Node test suite and preserve its assertions for commands, project actions, and webview message behavior.
- Add focused renderer/localization checks for escaped project data, localized webview strings, and valid locale bundle keys.
- Verify English fallback and Russian translations for the extension UI, including contributed command/menu labels and dynamic webview Build/Stop Build labels.
- Inspect the generated webview HTML to confirm local resource URIs, scoped resource roots, CSP, and the absence of inline executable JavaScript.
- Manually open the Projects view in both English and Russian VS Code display languages and check layout, context menus, project selection, build state, and animations.

## Migration Sequence

1. Extract the current provider without behavior changes and create the display-model boundary.
2. Extract the renderer and move HTML escaping, icons, and project markup into it.
3. Move CSS and client JavaScript into local assets; configure scoped resource loading and CSP.
4. Add VS Code localization bundles and package localization files; migrate extension-owned visible strings and supply localized dynamic webview labels.
5. Add extraction/validation scripts and focused checks, then run the existing suite and inspect both locales.

Each step should preserve the existing UI and message contract. Keep any independent issues or visual adjustments out of this refactor.
