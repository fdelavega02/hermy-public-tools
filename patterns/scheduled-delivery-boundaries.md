# Scheduled Delivery Boundaries

Scheduled jobs should make the user-facing result part of the job's final output when the scheduler already has a delivery target.

This avoids confusing handoffs where an inner helper sends the useful content to one route while the scheduler announces only a short completion note somewhere else.

## Pattern

- Put the actual user-facing content in the final job response.
- Let the scheduler's configured delivery mechanism announce that response.
- Use separate messaging calls only when the target is explicit and verified.
- Keep delivery aliases, account IDs, channel IDs, local routes, and raw payloads out of public examples.
- If a test delivery goes to the wrong place, document the class of routing issue and the verified fix without publishing private identifiers.

## Example

```text
Good: the scheduled draft job returns the full approved draft as its final response, and the scheduler sends that response to the configured destination.

Risky: the job sends the draft through an internal helper, then returns only "Done" to the scheduler.
```

For public repos, describe the delivery shape rather than the private route. Use placeholders such as `configured destination`, `internal helper`, and `review channel`.
