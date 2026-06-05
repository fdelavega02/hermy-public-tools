# Cron Migration Checklist

When an automation platform changes how scheduled jobs are stored or run, treat it like a small migration instead of assuming every job survived intact.

This checklist is public-safe and intentionally generic. It does not include private job names, targets, account IDs, tokens, local channel IDs, or alert rules.

## After an Update

1. Confirm where jobs are stored now.
2. Check whether old job files were archived, migrated, or still active.
3. List enabled and disabled jobs.
4. Verify each important job has the expected schedule, timezone, model/runtime, permissions, and delivery target.
5. Run one low-risk job manually if the scheduler supports it.
6. Read recent run history for failures that started after the update.
7. Patch disabled legacy jobs too if they may be re-enabled later.
8. Record what changed in private notes, then publish only sanitized lessons.

## Things To Avoid

- Do not paste private cron payloads into public docs.
- Do not publish exact DM channels, webhook URLs, account IDs, inbox filters, or machine-local paths.
- Do not assume a successful migration means the runtime has the same tools or permissions as before.
- Do not leave old duplicate delivery targets around if they could notify the wrong place after reactivation.

## Good Public Summary Shape

Useful public notes should describe the pattern:

- Storage moved from one backend to another.
- Some jobs needed runtime/tool permission updates.
- Manual test runs confirmed the patch.
- Private delivery details stayed private.

