# Recovered Tool Failures

Automation logs can look alarming when an early tool step fails and a later step recovers. The final summary should make that recovery explicit so readers do not have to guess whether the run is still broken.

This note is public-safe and intentionally generic. It does not include private job names, delivery targets, account IDs, local paths, credentials, raw logs, or workflow payloads.

## Pattern

When a step fails but the automation recovers:

1. Name the failed class of step without private details.
2. Explain the recovery in one sentence.
3. Say what final verification passed.
4. Avoid leaving a success summary beside an unexplained failure footer.

## Example

```text
Recovered: the first push was rejected because the remote moved. The repo was fetched, fast-forwarded, rechecked, and pushed successfully.
```

For public repos, keep examples generic. Do not publish private branch names, remotes, local worktree paths, account identifiers, channel IDs, or raw command transcripts.
