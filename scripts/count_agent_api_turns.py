#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import re
from zoneinfo import ZoneInfo

TZ = ZoneInfo('America/Indianapolis')
parser = argparse.ArgumentParser(description='Count per-agent Codex, xAI assistant turns, and locally logged ElevenLabs TTS uses for a date.')
parser.add_argument('--date', help='YYYY-MM-DD in America/Indianapolis, default today')
parser.add_argument('--openclaw-home', default=os.environ.get('OPENCLAW_HOME', str(Path.home() / '.openclaw')), help='OpenClaw home directory, default $OPENCLAW_HOME or ~/.openclaw')
parser.add_argument('--workspace', default=os.environ.get('TWIN_WORKSPACE'), help='Workspace containing the Spotify/PTT bridge, default <openclaw-home>/workspace-twin')
args = parser.parse_args()
OPENCLAW_HOME = Path(args.openclaw_home).expanduser()
BASE = OPENCLAW_HOME / 'agents'
WORKSPACE = Path(args.workspace).expanduser() if args.workspace else OPENCLAW_HOME / 'workspace-twin'
BRIDGE_VOICE_LOG = WORKSPACE / 'automation/spotify-ptt-bridge/state/voice-command.log'
TARGET_DATE = datetime.strptime(args.date, '%Y-%m-%d').date() if args.date else datetime.now(TZ).date()
CODEX_PROVIDERS = {'openai-codex', 'codex'}
CODEX_APIS = {'openai-codex-responses', 'openai-chatgpt-responses'}
XAI_PROVIDERS = {'xai'}
ELEVENLABS_AUDIT_CONTEXTS = {'elevenlabs.tts', 'elevenlabs.voices'}
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


def has_elevenlabs_audit(obj) -> bool:
    stack = [obj]
    while stack:
        value = stack.pop()
        if isinstance(value, dict):
            if value.get('auditContext') in ELEVENLABS_AUDIT_CONTEXTS:
                return True
            stack.extend(value.values())
        elif isinstance(value, list):
            stack.extend(value)
    return False


def add_bridge_elevenlabs_counts(counts: dict) -> None:
    """Count local PTT speech events.

    OpenClaw session JSONL files record assistant/model turns, but the Spotify/PTT
    bridge invokes `openclaw infer tts convert` from its own Node process. Those
    CLI TTS calls do not currently create per-agent session message records, so
    the bridge's voice-command log is the durable local evidence for successful
    PTT speech attempts.
    """
    if not BRIDGE_VOICE_LOG.exists():
        return
    twin = counts.setdefault('twin', {'codex': 0, 'xai': 0, 'elevenlabs': 0})
    with BRIDGE_VOICE_LOG.open('r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            dt = parse_ts(obj.get('at'))
            if not dt or dt.date() != TARGET_DATE:
                continue
            if obj.get('assistantText') and not obj.get('error'):
                twin['elevenlabs'] += 1


counts = {}
for agent_dir in sorted(BASE.iterdir()):
    if not agent_dir.is_dir() or agent_dir.name in SKIP_AGENTS:
        continue
    sessions_dir = agent_dir / 'sessions'
    agent_counts = {'codex': 0, 'xai': 0, 'elevenlabs': 0}
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
                    dt = parse_ts(obj.get('timestamp'))
                    if not dt or dt.date() != TARGET_DATE:
                        continue
                    if obj.get('type') == 'message':
                        msg = obj.get('message') or {}
                        if msg.get('role') != 'assistant':
                            continue
                        bucket = bucket_for(msg)
                        if not bucket:
                            continue
                        agent_counts[bucket] += 1
                        continue
                    if has_elevenlabs_audit(obj):
                        agent_counts['elevenlabs'] += 1
    counts[agent_dir.name] = agent_counts

add_bridge_elevenlabs_counts(counts)

sorted_items = sorted(
    counts.items(),
    key=lambda kv: (-(kv[1]['codex'] + kv[1]['xai'] + kv[1]['elevenlabs']), -kv[1]['codex'], -kv[1]['xai'], -kv[1]['elevenlabs'], kv[0]),
)

total_codex = 0
total_xai = 0
total_elevenlabs = 0
for agent, agent_counts in sorted_items:
    codex = agent_counts['codex']
    xai = agent_counts['xai']
    elevenlabs = agent_counts['elevenlabs']
    total = codex + xai + elevenlabs
    total_codex += codex
    total_xai += xai
    total_elevenlabs += elevenlabs
    print(f'- {agent}: total {total} | codex {codex} | xAI {xai} | elevenlabs {elevenlabs}')

print(f'Total: {total_codex + total_xai + total_elevenlabs}')
print(f'Codex total: {total_codex}')
print(f'xAI total: {total_xai}')
print(f'ElevenLabs total: {total_elevenlabs}')
