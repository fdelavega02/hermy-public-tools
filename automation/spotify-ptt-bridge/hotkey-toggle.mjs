import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const server = 'http://127.0.0.1:8787';
const action = process.argv[2] || 'toggle';
const body = JSON.stringify({ deliver: false });
const logPath = path.join(os.homedir(), '.openclaw', 'workspace-twin', 'automation', 'spotify-ptt-bridge', 'state', 'hotkey-toggle.log');

async function logLine(line) {
  await appendFile(logPath, `${new Date().toISOString()} ${line}\n`, 'utf8').catch(() => {});
}

async function main() {
  await logLine(`invoked action=${action}`);
  const path = action === 'start' ? '/api/ptt/start' : action === 'stop' ? '/api/ptt/stop' : '/api/ptt/toggle';
  const res = await fetch(server + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    await logLine(`error status=${res.status} body=${text || ''}`);
    throw new Error(text || `HTTP ${res.status}`);
  }
  try {
    const data = JSON.parse(text);
    await logLine(`ok active=${Boolean(data.active)}`);
    console.log(data.active ? 'PTT active' : 'PTT idle');
  } catch {
    await logLine(`ok raw=${text}`);
    console.log(text);
  }
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
