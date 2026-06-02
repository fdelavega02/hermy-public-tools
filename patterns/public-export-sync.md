# Pattern: public export sync

Use this pattern when a private workspace contains useful tools but only some files are safe for a public repo.

## Shape

1. Keep the real working project in the private workspace.
2. Maintain a separate public repo checkout.
3. Sync only approved folders and files into the public repo.
4. Exclude private config, state, outputs, logs, caches, and one-off sensitive scripts.
5. Commit the public repo separately from the private workspace.

## Why

This avoids accidentally turning a private workspace into a public artifact. The public repo becomes a sanitized export, not the source of truth for private state.

## Common excludes

- `config.json`
- `state/`
- `output/`
- `node_modules/`
- `__pycache__/`
- `*.pyc`
- temporary debug scripts
- memory files
- tokens, credentials, browser storage, screenshots, and logs
