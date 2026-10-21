# Localization Language Setting Design

## Context

The extension currently has English source strings and Russian runtime translations in `l10n/bundle.l10n.json` and `l10n/bundle.l10n.ru.json`. Runtime text is localized with `vscode.l10n.t`, which selects a bundle from the VS Code display language. The user wants to choose the language used by the extension independently of the VS Code display language.

The VS Code API does not expose a locale override for `vscode.l10n.t`. The extension therefore needs a small runtime localization layer for user-selectable locales. VS Code continues to own localization of contributed command and menu labels.

## Goals

- Add a setting to select the extension runtime language.
- Offer `System`, `English`, and `Русский` in the settings dropdown, with the display labels localized through the existing `package.nls` files.
- Make the selected language apply to the project panel, notifications, dialogs, and other extension-generated runtime text.
- Update the open project panel when the setting changes.
- Preserve VS Code's own language selection for contributed commands, menus, and other manifest-rendered labels.
- Keep English as the fallback for missing runtime translations.

## Non-goals

- Add locales that do not yet have runtime translation bundles.
- Override VS Code's language for contributed command and menu labels.
- Change Dagor tool output, project data, or other text produced outside the extension.
- Change the default user experience: `System` follows VS Code's display language.

## User Setting

Add `dagorProjectManager.language` as a string enum with values `system`, `en`, and `ru`. Set the default to `system`. Use `enumItemLabels` so the setting UI displays human-readable choices instead of the stored identifiers. Localize the setting description and option labels using `package.nls.json` and `package.nls.ru.json`.

When `system` is selected, runtime messages use VS Code's current locale and existing fallback behavior. When `en` or `ru` is selected, runtime messages use that locale regardless of VS Code's display language. Unknown or missing values fall back to `system` behavior.

## Runtime Localization Design

Introduce a small localization service that owns the selected language and formats extension runtime messages. It loads the existing English and Russian runtime bundles, uses the English source bundle as fallback, and preserves the current named interpolation arguments such as `{project}` and `{error}`.

Route extension-generated runtime strings through this service instead of calling `vscode.l10n.t` directly. This includes webview labels and tooltips, Quick Picks, confirmation prompts, errors, notifications, and extension output-channel messages. The service must retain the English source text as the stable lookup key so the existing bundles and extraction workflow remain useful.

For `system`, the service delegates lookup to `vscode.l10n.t`, preserving VS Code's locale selection and fallback. For explicit `en` and `ru`, it resolves from the corresponding shipped bundle, falling back to the English source string if a key is absent. The service must not mutate VS Code's global locale or affect other extensions.

The project webview provider listens for changes to `dagorProjectManager.language` and rerenders the current view using the newly selected locale. Runtime messages shown after a setting change use the new language. Existing in-progress operations are not restarted solely because the setting changed.

## Manifest Localization Boundary

Contribution labels such as command titles and menu entries remain localized by VS Code using `package.nls.<locale>.json`. Changing `dagorProjectManager.language` does not alter those labels. The setting's own title, description, and dropdown labels are also manifest text and follow the VS Code display language.

The locale dropdown includes exactly the locales with runtime bundles: `System`, `English`, and `Русский`. Adding a future runtime locale requires adding its bundle and adding the matching enum value and localized display label.

## Error Handling

- If the configured value is missing or invalid, behave as `system`.
- If a locale bundle cannot be read or parsed, log a diagnostic and use English source text for that locale; extension activation and project discovery must continue.
- If a message key is absent from the chosen locale bundle, use the English source string.
- Preserve placeholder values exactly and do not interpret user-provided content as translation markup.

## Validation

- Verify the setting schema exposes `system`, `en`, and `ru`, and displays localized labels in the settings UI.
- Verify system mode uses the VS Code locale and the existing English fallback.
- Verify explicit English and Russian modes produce the selected language for panel text, notifications, dialogs, and output-channel messages regardless of VS Code locale.
- Change the setting while the project panel is open and verify it rerenders without losing the selected project or build state.
- Verify command and menu contribution labels remain controlled by VS Code's display language.
- Check that English and Russian runtime bundles have matching keys and that named placeholders remain intact.
- Run the existing test suite and add focused tests for locale resolution, fallback, interpolation, and configuration-change handling.

## Implementation Outline

1. Add and localize the `dagorProjectManager.language` enum setting.
2. Implement a runtime localization service with system, English, and Russian resolution, fallback, and interpolation.
3. Route extension-generated runtime messages through the service while keeping manifest contribution localization unchanged.
4. Connect configuration changes to the service and rerender the existing project webview.
5. Add locale resolution and bundle parity coverage, then run existing checks and manually verify all three settings modes.
