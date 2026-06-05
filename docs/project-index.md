# Project index

A quick map of what belongs in this public repo and what should stay elsewhere.

This index is for stable structure, not a day-to-day shortlist. Candidate projects that change with the day belong in a current daily dashboard or similar working note, with fake examples kept under `examples/` when public documentation needs to show the pattern.

## Current public-safe projects

### LinkedIn local posting helper

Location: `social/linkedin-local/`

Why it belongs here: the reusable browser automation pattern is useful, and the public version excludes credentials, browser session state, generated drafts, screenshots, and outputs.

### Spotify + PTT bridge

Location: `automation/spotify-ptt-bridge/`

Why it belongs here: it is a practical local automation project with clear public-safe boundaries. The private Spotify client config and runtime state stay out of Git.

### API usage counter

Location: `scripts/count_agent_api_turns.py`

Why it belongs here: it is a reusable local reporting helper for OpenClaw session JSONL files, and it can be shared without transcript contents.

### Public export and auto-commit helpers

Location: `scripts/`

Why they belong here: they document the pattern I use to keep public repos synced from private workspaces without exporting private state.

## Better somewhere else

### Outlook local automation

This belongs in Hermione’s public tools repo, not mine, because Hermione owns the proactive Outlook alert workflow.

### Agent-specific chat logs and verbatim helpers

These should stay private. They are too tied to personal chats and agent history, even if the script structure is technically reusable.

### One-off troubleshooting artifacts

Screenshots, logs, generated outputs, and temporary debug scripts should stay out unless they are rewritten as sanitized examples.

## Good future additions

- More fake sample outputs for scripts
- A tiny troubleshooting guide for each active project
- A small architecture diagram for the Spotify/PTT bridge
- A public-safe test checklist for browser automation changes
