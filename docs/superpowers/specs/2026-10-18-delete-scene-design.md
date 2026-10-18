# Delete Scene Design

## Goal

Add **Delete Scene** to a scene row's context menu. Deletion moves the scene's source folder and its identifiable game exports to the system trash. Scene references are reported for review but are not edited. Assets are never deleted as part of this operation.

## Requirements

- Show a centered VS Code confirmation before deleting.
- A normal scene is its folder under `develop/levels`, containing exactly one `*.level.blk`; move that entire folder to the system trash.
- If the folder contains multiple level files, refuse deletion and explain that the folder cannot safely be treated as one scene.
- Parse `exportPath` from the source level. Delete the matching exported `.bin` and same-basename `.blk` only when they resolve inside the project's `game` directory and exist.
- Find exact textual references to the scene export in project BLK and JSON configuration/source files. List their project-relative paths and line numbers in the confirmation and the VS Code Output log. Do not change or delete these files.
- Never delete assets as part of scene deletion.
- Create/reuse an Output channel named **Dagor Project Manager**. After confirmation, show it and log the target scene, each removed path, discovered references, skipped exports, and errors/partial completion.
- Move targets to the system trash. If that fails, ask separately before permanently deleting only the failed target.
- Refresh the project catalog after successful source-folder deletion.

## Scope and Safety

Reference scanning is static and may not discover paths assembled or loaded dynamically by code. The output must say that references were left unchanged and that assets were not deleted. The separate future task to find unreferenced assets remains independent.
