#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
import re
from zoneinfo import ZoneInfo

BASE = Path('/home/fdelavega02/.openclaw/agents')
TZ = ZoneInfo('America/Indianapolis')
parser = argparse.ArgumentParser(description='Count per-agent Codex and xAI assistant API turns for a date.')
parser.add_argument('--date', help='YYYY-MM-DD in America/Indianapolis, default today')
args = parser.parse_args()
TARGET_DATE = datetime.strptime(args.date, '%Y-%m-%d').date() if args.date else datetime.now(TZ).date()
CODEX_PROVIDERS = {'openai-codex'}
CODEX_APIS = {'openai-codex-responses'}
XAI_PROVIDERS = {'xai'}
SKIP_AGENTS = {'leon-kennedy', 'leon-kennedy-archived'}
PRIMARY_SESSION_RE = re.compile(r'^[0-9a-f-]{36}\.jsonl$')


def parse_ts(value):
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc).astimezone(TZ)
    if isinstance(value, str):
        s = value.replace('Z', '+00:00')
        try:
            dt = datetime.fromisoformat(s)
        except ValueError:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(TZ)
    return None


def bucket_for(msg: dict) -> str | None:
    provider = msg.get('provider')
    api = msg.get('api')
    if provider in CODEX_PROVIDERS or api in CODEX_APIS:
        return 'codex'
    # `openai-responses` is used by multiple providers, including OpenClaw's
    # delivery-mirror records. Count xAI only when the provider is explicitly xAI.
    if provider in XAI_PROVIDERS:
        return 'xai'
    return None


counts = {}
for agent_dir in sorted(BASE.iterdir()):
    if not agent_dir.is_dir() or agent_dir.name in SKIP_AGENTS:
        continue
    sessions_dir = agent_dir / 'sessions'
    agent_counts = {'codex': 0, 'xai': 0}
    if sessions_dir.exists():
        for path in sessions_dir.iterdir():
            if not path.is_file() or not PRIMARY_SESSION_RE.match(path.name):
                continue
            with path.open('r', encoding='utf-8', errors='ignore') as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if obj.get('type') != 'message':
                        continue
                    msg = obj.get('message') or {}
                    if msg.get('role') != 'assistant':
                        continue
                    bucket = bucket_for(msg)
                    if not bucket:
                        continue
                    dt = parse_ts(obj.get('timestamp'))
                    if not dt or dt.date() != TARGET_DATE:
                        continue
                    agent_counts[bucket] += 1
    counts[agent_dir.name] = agent_counts

sorted_items = sorted(
    counts.items(),
    key=lambda kv: (-(kv[1]['codex'] + kv[1]['xai']), -kv[1]['codex'], -kv[1]['xai'], kv[0]),
)

total_codex = 0
total_xai = 0
for agent, agent_counts in sorted_items:
    codex = agent_counts['codex']
    xai = agent_counts['xai']
    total = codex + xai
    total_codex += codex
    total_xai += xai
    print(f'- {agent}: total {total} | codex {codex} | xAI {xai}')

print(f'Total: {total_codex + total_xai}')
print(f'Codex total: {total_codex}')
print(f'xAI total: {total_xai}')
