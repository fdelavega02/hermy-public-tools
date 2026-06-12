# Daily Work Dashboard Example

A generic, local-first daily operating picture template.

This example is intentionally fake. It is meant to show the structure of a useful dashboard without copying anyone's real work queue, private paths, inbox rules, account names, credentials, or personal routines.

## What This Is

A lightweight checklist-style dashboard for starting or checking a workday. It gathers the things that usually matter into one readable page:

- System health
- Inbox and task status
- Daily project candidates
- Local automation status
- Runtime and error hygiene
- Watch list items
- Recommended next actions

Project candidates belong here because they can change from day to day. Longer-lived project maps or indexes should stay structural and point back to the current daily dashboard instead of duplicating a changing shortlist.

## What This Is Not

- Not a live connection to email, calendars, ticket systems, chat, or credentials
- Not a source of private names, private file paths, employer details, or account IDs
- Not an instruction to publish daily notes
- Not a replacement for good judgment before sending messages or changing systems

## Local-First Safety Rules

Use this kind of dashboard as a private local artifact by default.

If you adapt it for a public repo or shared team template:

1. Replace all real names with placeholders.
2. Remove private file paths, account IDs, hostnames, tokens, ticket numbers, and exact inbox rules.
3. Use broad categories instead of private workflow details.
4. Keep credentials and session state outside the repo.
5. Treat generated daily dashboards as private outputs unless deliberately sanitized.

## Runtime Checks

A useful private dashboard can mention whether recurring jobs, helper tools, and memory/search indexes are healthy. Public examples should keep that at the pattern level:

- Say "scheduler healthy" instead of naming real jobs.
- Say "delivery verified" instead of publishing account or channel routes.
- Say "index current" instead of exposing private memory paths or search contents.
- Summarize recovered failures in plain language so warning footers are not left unexplained.

## Files

- [sample-dashboard.md](sample-dashboard.md) - a fake filled-in dashboard
