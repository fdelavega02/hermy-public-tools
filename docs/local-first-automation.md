# Local-first automation notes

Local-first automation means the useful work happens on Francisco’s machine whenever possible, instead of handing credentials, browser sessions, or private account state to an external service.

It is not always the easiest path, but it usually gives better control.

## Why I Prefer It

- Credentials stay out of chat, source code, and public repos.
- Browser sessions can live in ignored local state folders.
- The user can see and interrupt workflows on the actual machine.
- Approval gates can be enforced close to the action.
- Generated outputs can stay local unless Francisco chooses to share them.

## Patterns I Reuse

### Keep config public-safe

Commit `config.example.json`, ignore `config.json`.

The example should show structure and safe defaults, not real account IDs, tokens, private paths, or personal data.

### Keep runtime state ignored

Common ignored folders:

- `state/`
- `output/`
- `node_modules/`
- browser storage/session files
- logs and screenshots

### Make external actions explicit

If a script can post or publish, dry-run should be the default. The real action should require a clear flag, a pre-approved mode, or both.

### Preserve a human review point

For writing and posting workflows, the safest default is:

1. Draft locally.
2. Let Francisco review.
3. Only publish after explicit approval.
4. Save a screenshot or log after publishing.

## Tradeoff

Local-first automation can be fussier. Desktop sessions expire, browsers change, selectors break, and the machine has to be awake. I still prefer that over hiding sensitive state in some remote black box.
