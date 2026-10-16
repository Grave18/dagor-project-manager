# Add Project Design

## Goal

Add an **Add Project** action to Dagor Project Manager. It creates a usable starter project directly under the root of `DagorEngine`. The generated project contains one editable level with a plane and a cube under `develop/levels`. The project executable is produced by the normal build; no executable is copied from the template.

## Requirements

- DagorEngine must be discoverable. Creation must never fall back to an arbitrary workspace directory.
- The destination is exactly one directory below the engine root: `DagorEngine/<project-name>`.
- The starter template is bundled with the extension. It must not depend on a `templateProject` directory existing in an engine checkout.
- The template contains project configuration, `prog/build.py`, and the complete editable level data needed by daEditor.
- The level is stored at `develop/levels/<project-name>/<project-name>.level.blk` and contains the requested plane and cube.
- The template contains no prebuilt game executable. A successful build creates executable output in the project's `game` directory.
- Project-specific names and paths use explicit template markers. Replacement applies to text files and file/directory names; binary assets are copied as-is. Generation fails if a marker remains in generated text or paths.
- A destination name must be a single safe directory name. Existing destinations are never overwritten.
- On generation or validation failure, remove the newly created incomplete destination and report the failure.

## Engine Root Resolution

Resolve the engine root from workspace folders and their ancestors by checking for engine markers (`build_all.py` and `tools/dagor_cdk`). Also derive it from the configured Dagor CDK tools directory when available. If multiple roots are found, let the user choose. If none is found, show an error and create nothing.

## User Flow

1. Keep **Refresh** at the top right of the Projects view and place a left-aligned **Add Project** button directly below the project list, matching the supplied screenshot.
2. Ask for the project name.
3. Resolve the engine root and create the destination directory only if it does not exist.
4. Copy the bundled starter template, replacing markers in paths and text files.
5. Validate required files, the editable level location, and that no markers remain. Roll back the new destination if validation fails.
6. Refresh the project catalog so the project appears. The existing **Build Project** action builds it; **Run Game** remains empty until a game executable is generated.

## Implementation Boundaries

- `projectWebview.js`: render the button and send an Add Project message.
- `extension.js`: register/route the existing generate-project command or a dedicated command to the generator.
- A new project-generation module: resolve the engine root, validate the name, copy/template files, validate output, and roll back failed creation.
- `package.json`: contribute the user-facing command and title if the command is exposed through the Command Palette.
- `templates/`: keep the bundled project and editable level assets within the extension package.

Keep the generator independent of VS Code UI where possible so file operations and validation have clear inputs and outputs.

## Failure Handling

Show actionable messages for a missing engine root, ambiguous engine roots, invalid name, destination collision, missing/corrupt bundled template, copy failure, or failed post-copy validation. Never overwrite an existing project. Roll back only the destination created by the current generation attempt.

## Verification

Verify the generated path is an immediate child of `DagorEngine`, inspect the generated marker replacements and required project/level files, open the level in daEditor to confirm the plane and cube are editable, and run the normal build to confirm the executable is generated rather than copied.
