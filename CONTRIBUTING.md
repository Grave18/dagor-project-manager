# Contributing

## Commit messages

Use the Conventional Commits format:

```text
<type>[optional scope]: <short description>
```

Write commit messages in English. Keep the type lowercase and the description concise. Aim for a subject line of 50 characters or fewer; do not exceed 72 characters. If a body is needed, separate it from the subject with a blank line and wrap body lines at 72 characters. Use an optional lowercase scope when it adds useful context, for example `fix(webview): keep scenes visible during refresh`.

Use these types:

- `feat`: add a user-facing capability. This signals a minor version change.
- `fix`: correct a bug. This signals a patch version change.
- `docs`: change documentation.
- `refactor`: restructure code without changing behavior.
- `style`: change UI appearance or code formatting without changing behavior. In this project, visual styling belongs to this type.
- `test`: add or update tests.
- `build`: change build scripts, packaging, or build dependencies.
- `ci`: change continuous integration configuration.
- `perf`: improve performance.
- `chore`: perform repository maintenance that does not fit another type.
- `revert`: undo an earlier commit; include a `Refs: <commit>` footer when possible.

For a breaking change, add `!` after the type or scope, or include a `BREAKING CHANGE: <description>` footer.

The root commit retains its historical title `INITIAL COMMIT`. All commits after it use the format above.
