# Example API usage report

This is fake sample output showing the kind of daily report `scripts/count_agent_api_turns.py` is meant to support.

```text
API usage for 2026-06-02, America/Indianapolis

Hermy-Own
- OpenAI Codex assistant turns: 14
- xAI assistant turns: 0

Hermione
- OpenAI Codex assistant turns: 9
- xAI assistant turns: 0

Project helper
- OpenAI Codex assistant turns: 3
- xAI assistant turns: 0
```

Real reports should be generated from local OpenClaw session JSONL files and should avoid including private transcript content.
