# Future Work

## Find assets with no project references

- Add a project-wide scan that identifies assets with no discoverable references from levels or project configuration.
- Report candidate unused assets for review; do not delete them automatically or as part of scene deletion.
- Treat the results as candidates, since references loaded dynamically by code or indirect systems may not be discoverable by a static scan.
