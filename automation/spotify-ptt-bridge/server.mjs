import http from 'node:http';
import { readFile, writeFile, mkdir, rm, stat, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import {
  appendRecentResponse,
  appendSharedMemory,
  buildAntiRepeatInstruction,
  looksRepeatedResponse,
  memoryBlock,
  readRecentResponses,
  readSharedMemory,
} from '../streamlabels-hermy-bridge/ollama-memory.mjs';
import { banterOverrideForText, isBanterOverrideText } from '../streamlabels-hermy-bridge/banter-overrides.mjs';
import { appendGamblingDisclaimer, cleanHermyResponse } from '../streamlabels-hermy-bridge/response-cleanup.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const CONFIG_PATH = path.join(ROOT, 'config.json');
const EXAMPLE_CONFIG_PATH = path.join(ROOT, 'config.example.json');
const STATE_DIR = path.join(ROOT, 'state');
const TOKEN_PATH = path.join(STATE_DIR, 'spotify-token.json');
const AUTH_PATH = path.join(STATE_DIR, 'spotify-auth.json');
const COMMAND_LOG_PATH = path.join(STATE_DIR, 'voice-command.log');
const STREAM_HERMY_ROOT = path.resolve(ROOT, '../streamlabels-hermy-bridge');
const STREAM_HERMY_CONFIG_PATH = path.join(STREAM_HERMY_ROOT, 'config.json');

let pttSession = null;

const DEFAULTS = {
  server: { port: 8787 },
  spotify: {
    clientId: '',
    redirectUri: 'http://127.0.0.1:8787/callback',
    scopes: ['user-read-playback-state', 'user-modify-playback-state', 'playlist-read-private', 'playlist-read-collaborative'],
  },
  openclaw: {
    agentId: '',
    sessionId: '',
    thinking: 'medium',
    deliver: true,
    replyChannel: 'discord',
    replyAccountId: '',
    replyTo: '',
    profiles: {},
  },
  output: {
    reactionFile: '../streamlabels-hermy-bridge/output/hermy_reaction.txt',
    clearAfterMs: 15000,
  },
  transcription: {
    model: '',
    language: 'en',
  },
  recorder: {
    cmd: 'pw-record',
    device: '',
    rate: 16000,
    channels: 1,
    format: 's16',
    maxMs: 20000,
  },
  clip: {
    enabled: true,
    script: './ptt/clip-replay.sh',
  },
};

function base64Url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomString(bytes = 32) {
  return base64Url(crypto.randomBytes(bytes));
}

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest();
}

async function loadConfig() {
  let cfg = {};
  if (existsSync(CONFIG_PATH)) {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    cfg = JSON.parse(raw);
  }
  const merged = {
    server: { ...DEFAULTS.server, ...(cfg.server ?? {}) },
    spotify: { ...DEFAULTS.spotify, ...(cfg.spotify ?? {}), playlists: { ...(DEFAULTS.spotify.playlists ?? {}), ...(cfg.spotify?.playlists ?? {}) } },
    openclaw: { ...DEFAULTS.openclaw, ...(cfg.openclaw ?? {}) },
    output: { ...DEFAULTS.output, ...(cfg.output ?? {}) },
    transcription: { ...DEFAULTS.transcription, ...(cfg.transcription ?? {}) },
    recorder: { ...DEFAULTS.recorder, ...(cfg.recorder ?? {}) },
    clip: { ...DEFAULTS.clip, ...(cfg.clip ?? {}) },
  };
  if (process.env.SPOTIFY_CLIENT_ID) merged.spotify.clientId = process.env.SPOTIFY_CLIENT_ID;
  if (process.env.SPOTIFY_REDIRECT_URI) merged.spotify.redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  if (process.env.OPENCLAW_SESSION_ID) merged.openclaw.sessionId = process.env.OPENCLAW_SESSION_ID;
  if (process.env.OPENCLAW_THINKING) merged.openclaw.thinking = process.env.OPENCLAW_THINKING;
  if (process.env.OPENCLAW_DELIVER) merged.openclaw.deliver = process.env.OPENCLAW_DELIVER !== '0';
  if (process.env.OPENCLAW_REPLY_CHANNEL) merged.openclaw.replyChannel = process.env.OPENCLAW_REPLY_CHANNEL;
  if (process.env.OPENCLAW_REPLY_ACCOUNT_ID) merged.openclaw.replyAccountId = process.env.OPENCLAW_REPLY_ACCOUNT_ID;
  if (process.env.OPENCLAW_REPLY_TO) merged.openclaw.replyTo = process.env.OPENCLAW_REPLY_TO;
  if (process.env.TRANSCRIPTION_MODEL) merged.transcription.model = process.env.TRANSCRIPTION_MODEL;
  if (process.env.TRANSCRIPTION_LANGUAGE) merged.transcription.language = process.env.TRANSCRIPTION_LANGUAGE;
  if (process.env.PTT_RECORDER_CMD) merged.recorder.cmd = process.env.PTT_RECORDER_CMD;
  if (process.env.PTT_RECORDER_DEVICE) merged.recorder.device = process.env.PTT_RECORDER_DEVICE;
  if (process.env.PTT_RECORDER_RATE) merged.recorder.rate = Number(process.env.PTT_RECORDER_RATE) || merged.recorder.rate;
  if (process.env.PTT_RECORDER_CHANNELS) merged.recorder.channels = Number(process.env.PTT_RECORDER_CHANNELS) || merged.recorder.channels;
  if (process.env.PTT_RECORDER_FORMAT) merged.recorder.format = process.env.PTT_RECORDER_FORMAT;
  return merged;
}

async function ensureState() {
  await mkdir(STATE_DIR, { recursive: true });
}

async function logVoiceCommand(entry) {
  await ensureState();
  await appendFile(COMMAND_LOG_PATH, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8').catch(() => {});
}

async function readJsonFile(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath, data) {
  await ensureState();
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function writeTextFile(filePath, text, clearAfterMs) {
  if (!filePath) return null;
  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  const body = `${String(text || '').trim()}\n`;
  await writeFile(resolvedPath, body, 'utf8');
  const clearDelay = Number(clearAfterMs) || 0;
  if (clearDelay > 0) {
    setTimeout(async () => {
      try {
        const current = await readFile(resolvedPath, 'utf8').catch(() => '');
        if (current.trim() === String(text || '').trim()) {
          await writeFile(resolvedPath, '', 'utf8');
        }
      } catch (error) {
        console.error('[spotify-ptt] reaction clear failed:', error.message);
      }
    }, clearDelay).unref?.();
  }
  return resolvedPath;
}

async function loadTokens() {
  return readJsonFile(TOKEN_PATH);
}

async function saveTokens(tokens) {
  await writeJsonFile(TOKEN_PATH, tokens);
}

async function deleteAuthState() {
  try { await rm(AUTH_PATH); } catch {}
}

async function saveAuthState(data) {
  await writeJsonFile(AUTH_PATH, data);
}

async function loadAuthState() {
  return readJsonFile(AUTH_PATH);
}

async function refreshAccessToken(cfg) {
  const tokens = await loadTokens();
  if (!tokens?.refresh_token) throw new Error('No Spotify refresh token saved yet. Connect Spotify first.');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: cfg.spotify.clientId,
  });

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify token refresh failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const next = {
    ...tokens,
    access_token: data.access_token,
    token_type: data.token_type ?? 'Bearer',
    scope: data.scope ?? tokens.scope,
    expires_in: data.expires_in,
    expires_at: Date.now() + (Number(data.expires_in ?? 3600) * 1000),
    refresh_token: data.refresh_token ?? tokens.refresh_token,
  };
  await saveTokens(next);
  return next;
}

async function getAccessToken(cfg) {
  const tokens = await loadTokens();
  if (!tokens?.access_token) throw new Error('Spotify is not connected yet. Click Connect Spotify.');
  if (!tokens.expires_at || Date.now() > tokens.expires_at - 60_000) {
    return refreshAccessToken(cfg);
  }
  return tokens;
}

async function spotifyRequest(cfg, method, endpoint, body) {
  const tokens = await getAccessToken(cfg);
  const url = `https://api.spotify.com${endpoint}`;
  const init = {
    method,
    headers: {
      Authorization: `${tokens.token_type ?? 'Bearer'} ${tokens.access_token}`,
    },
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res = await fetch(url, init);
  if (res.status === 401 && tokens.refresh_token) {
    const fresh = await refreshAccessToken(cfg);
    init.headers.Authorization = `${fresh.token_type ?? 'Bearer'} ${fresh.access_token}`;
    res = await fetch(url, init);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify API error ${res.status}: ${text}`);
  }

  if (res.status === 202 || res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function isNoActiveSpotifyDeviceError(error) {
  const message = String(error?.message || error || '');
  return message.includes('NO_ACTIVE_DEVICE') || message.includes('No active device found');
}

async function getPreferredSpotifyDevice(cfg) {
  const data = await spotifyRequest(cfg, 'GET', '/v1/me/player/devices');
  const devices = Array.isArray(data?.devices) ? data.devices : [];
  const active = devices.find(device => device.is_active && !device.is_restricted);
  if (active) return { device: active, activated: false };

  const preferredName = cfg.spotify?.preferredDeviceName || cfg.spotify?.deviceName || '';
  const preferred = preferredName
    ? devices.find(device => !device.is_restricted && String(device.name || '').toLowerCase() === String(preferredName).toLowerCase())
    : null;
  const fallback = preferred || devices.find(device => !device.is_restricted) || devices[0] || null;
  if (!fallback?.id) {
    throw new Error('Spotify has no available playback device. Open Spotify on this computer or another device, then try again.');
  }
  return { device: fallback, activated: true };
}

async function ensureSpotifyPlaybackDevice(cfg, { play = false } = {}) {
  const { device, activated } = await getPreferredSpotifyDevice(cfg);
  if (activated) {
    await spotifyRequest(cfg, 'PUT', '/v1/me/player', { device_ids: [device.id], play: Boolean(play) });
  }
  return { device, activated };
}

async function spotifyPlay(cfg, body, { skipIfAlreadyPlaying = false } = {}) {
  if (skipIfAlreadyPlaying && body === undefined) {
    const player = await spotifyRequest(cfg, 'GET', '/v1/me/player').catch(() => null);
    if (player?.is_playing === true) {
      return { result: { alreadyPlaying: true }, recoveredDevice: null, alreadyPlaying: true };
    }
  }

  try {
    return { result: await spotifyRequest(cfg, 'PUT', '/v1/me/player/play', body), recoveredDevice: null, alreadyPlaying: false };
  } catch (error) {
    if (!isNoActiveSpotifyDeviceError(error)) throw error;
    const recoveredDevice = await ensureSpotifyPlaybackDevice(cfg, { play: true });
    return { result: await spotifyRequest(cfg, 'PUT', '/v1/me/player/play', body), recoveredDevice, alreadyPlaying: false };
  }
}

async function runOpenClaw(args, timeoutSeconds = 120) {
  const result = await execFileAsync('openclaw', args, {
    timeout: timeoutSeconds * 1000,
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true,
  });
  return { stdout: result.stdout?.toString?.() ?? String(result.stdout ?? ''), stderr: result.stderr?.toString?.() ?? String(result.stderr ?? '') };
}

async function transcribeAudioFile(cfg, audioPath) {
  const args = ['infer', 'audio', 'transcribe', '--file', audioPath, '--json'];
  if (cfg.transcription.language) {
    args.push('--language', cfg.transcription.language);
  }
  if (cfg.transcription.model) {
    args.push('--model', cfg.transcription.model);
  }
  const { stdout } = await runOpenClaw(args, 180);
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = { raw: stdout };
  }
  return parsed;
}

function extractTranscript(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload.trim();
  if (typeof payload.text === 'string') return payload.text.trim();
  if (typeof payload.transcript === 'string') return payload.transcript.trim();
  if (typeof payload.output === 'string') return payload.output.trim();
  if (payload.result && typeof payload.result.text === 'string') return payload.result.text.trim();
  if (Array.isArray(payload.outputs)) {
    const joined = payload.outputs
      .map(item => item?.text ?? item?.transcript ?? item?.output)
      .filter(Boolean)
      .join('\n')
      .trim();
    if (joined) return joined;
  }
  if (Array.isArray(payload.result?.outputs)) {
    const joined = payload.result.outputs
      .map(item => item?.text ?? item?.transcript ?? item?.output)
      .filter(Boolean)
      .join('\n')
      .trim();
    if (joined) return joined;
  }
  return '';
}

function extractAssistantText(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload.trim();
  if (payload.finalAssistantVisibleText) return String(payload.finalAssistantVisibleText).trim();
  if (payload.result?.finalAssistantVisibleText) return String(payload.result.finalAssistantVisibleText).trim();
  if (Array.isArray(payload.payloads)) {
    const joined = payload.payloads.map(item => item?.text).filter(Boolean).join('\n').trim();
    if (joined) return joined;
  }
  if (payload.result?.payloads) {
    const joined = payload.result.payloads.map(item => item?.text).filter(Boolean).join('\n').trim();
    if (joined) return joined;
  }
  return '';
}

async function playAudioFile(audioPath) {
  const player = process.env.PTT_PLAYER_CMD || 'ffplay';
  const args = process.env.PTT_PLAYER_ARGS
    ? process.env.PTT_PLAYER_ARGS.split(' ').filter(Boolean)
    : ['-nodisp', '-autoexit', '-loglevel', 'quiet', audioPath];
  await execFileAsync(player, args, {
    timeout: 300000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
}

async function speakTextLocally(text) {
  const cleanText = String(text || '').trim();
  if (!cleanText) return { skipped: true, reason: 'empty text' };
  const speechPath = path.join(os.tmpdir(), `ptt-speech-${Date.now()}-${randomString(6)}.mp3`);
  try {
    const args = [
      'infer', 'tts', 'convert',
      '--text', cleanText,
      '--output', speechPath,
      '--voice', 'nDJIICjR9zfJExIFeSCN',
      '--model', 'elevenlabs/eleven_multilingual_v2',
      '--json',
    ];
    const { stdout } = await runOpenClaw(args, 240);
    let parsed = null;
    try { parsed = JSON.parse(stdout); } catch { parsed = { raw: stdout }; }
    await playAudioFile(speechPath);
    return { ok: true, parsed };
  } finally {
    await rm(speechPath, { force: true }).catch(() => {});
  }
}

async function trySpeakTextLocally(text) {
  try {
    return await speakTextLocally(text);
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}


function normalizePlaylistName(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|my|playlist|spotify)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPlaylistRequest(normalizedText) {
  const patterns = [
    /\b(?:switch|change)\s+(?:spotify|music)?\s*(?:to|over to)\s+(?:my\s+)?(.+?)(?:\s+playlist)?$/,
    /\b(?:play|start|put on)\s+(?:my\s+)?(.+?)\s+playlist$/,
    /\b(?:play|start|put on)\s+(?:playlist\s+)?(.+)$/,
  ];
  for (const pattern of patterns) {
    const match = normalizedText.match(pattern);
    if (!match?.[1]) continue;
    const name = match[1]
      .replace(/\b(?:on spotify|in spotify|please|for me)\b/g, '')
      .trim();
    if (name && !/^(music|spotify|it|something)$/.test(name)) return name;
  }
  return '';
}

function configuredPlaylistEntries(cfg) {
  const playlists = cfg.spotify?.playlists || {};
  return Object.entries(playlists)
    .map(([alias, value]) => {
      if (!value) return null;
      if (typeof value === 'string') return { alias, name: alias, uri: value };
      return { alias, name: value.name || alias, uri: value.uri || value.contextUri || '', id: value.id || '' };
    })
    .filter(item => item?.uri || item?.id);
}

async function fetchUserPlaylists(cfg) {
  const items = [];
  let endpoint = '/v1/me/playlists?limit=50';
  for (let page = 0; endpoint && page < 10; page += 1) {
    const data = await spotifyRequest(cfg, 'GET', endpoint);
    for (const item of data?.items || []) {
      if (item?.uri && item?.name) items.push({ name: item.name, uri: item.uri, id: item.id });
    }
    endpoint = data?.next ? data.next.replace('https://api.spotify.com', '') : '';
  }
  return items;
}

function bestPlaylistMatch(request, playlists) {
  const wanted = normalizePlaylistName(request);
  if (!wanted) return null;
  const candidates = playlists.map(item => ({ ...item, keys: [item.alias, item.name].filter(Boolean).map(normalizePlaylistName) }));
  return candidates.find(item => item.keys.includes(wanted))
    || candidates.find(item => item.keys.some(key => key && (key.includes(wanted) || wanted.includes(key))))
    || null;
}

async function switchToPlaylist(cfg, request) {
  const configured = configuredPlaylistEntries(cfg);
  let match = bestPlaylistMatch(request, configured);
  let source = 'configured';
  if (!match) {
    try {
      const playlists = await fetchUserPlaylists(cfg);
      match = bestPlaylistMatch(request, playlists);
      source = 'spotify-library';
    } catch (error) {
      if (String(error?.message || error).includes('Insufficient client scope')) {
        throw new Error('Spotify needs to be reconnected with playlist-read scopes before I can search your library playlists. Open the bridge, connect Spotify again, then retry. You can also add playlist aliases under spotify.playlists in config.json.');
      }
      throw error;
    }
  }
  if (!match) {
    const known = configured.map(item => item.alias || item.name).filter(Boolean).slice(0, 8);
    const hint = known.length ? ` Known aliases: ${known.join(', ')}.` : ' Add aliases under spotify.playlists in config.json, or reconnect Spotify with playlist-read scopes.';
    throw new Error(`I could not find a Spotify playlist matching "${request}".${hint}`);
  }
  const contextUri = match.uri || `spotify:playlist:${match.id}`;
  await ensureSpotifyPlaybackDevice(cfg, { play: false });
  const player = await spotifyRequest(cfg, 'GET', '/v1/me/player').catch(() => null);
  let shuffleChanged = false;
  if (player?.shuffle_state !== true) {
    await spotifyRequest(cfg, 'PUT', '/v1/me/player/shuffle?state=true');
    shuffleChanged = true;
  }
  const playResult = await spotifyPlay(cfg, { context_uri: contextUri });
  return { result: playResult.result, recoveredDevice: playResult.recoveredDevice, playlist: { name: match.name || match.alias || request, uri: contextUri, source }, shuffle: { enabled: true, changed: shuffleChanged } };
}

async function handleClipVoiceCommand(cfg, transcript) {
  const text = String(transcript || '').trim();
  const normalized = text.toLowerCase().replace(/[.!?]+$/g, '').trim();
  if (!normalized || cfg.clip?.enabled === false) return null;
  if (!/\b(clip that|clip it|save that clip|save clip|save that|record that)\b/.test(normalized)) return null;

  const script = cfg.clip?.script || './ptt/clip-replay.sh';
  const scriptPath = path.isAbsolute(script) ? script : path.join(ROOT, script);
  const { stdout, stderr } = await execFileAsync(scriptPath, ['save'], { cwd: ROOT, timeout: 10000 });
  const output = [stdout, stderr].filter(Boolean).join('\n').trim();
  const assistantText = output.includes('Saved clip:')
    ? 'Clipped it.'
    : output.includes('Replay buffer just started')
      ? 'Clip buffer is starting. Say clip that again in a few seconds.'
      : 'Clip save triggered.';
  const localSpeech = await trySpeakTextLocally(assistantText);
  return { handled: true, action: 'clip-that', result: { output }, assistantText, localSpeech };
}

async function handleSpotifyVoiceCommand(cfg, transcript) {
  const text = String(transcript || '').trim();
  const normalized = text.toLowerCase().replace(/[.!?]+$/g, '').trim();
  if (!normalized) return null;

  let assistantText = '';
  let action = '';
  let result = null;

  const playlistRequest = extractPlaylistRequest(normalized);
  if (playlistRequest) {
    const switched = await switchToPlaylist(cfg, playlistRequest);
    result = switched;
    action = 'playlist';
    assistantText = `Playing ${switched.playlist.name}.`;
  }

  const volumeMatch = normalized.match(/(?:set\s+)?(?:spotify\s+)?volume(?:\s+(?:to|at))?\s+(\d{1,3})\b/) || normalized.match(/\b(?:turn|set)\s+(?:it|music|spotify)?\s*(?:to\s+)?(\d{1,3})\s*(?:percent|%)\b/);
  if (!action && volumeMatch) {
    const volumePercent = Math.max(0, Math.min(100, Number(volumeMatch[1])));
    result = await spotifyRequest(cfg, 'PUT', `/v1/me/player/volume?volume_percent=${encodeURIComponent(volumePercent)}`);
    action = 'volume';
    assistantText = `Set Spotify volume to ${volumePercent}.`;
  } else if (!action && /\b(pause|pause spotify|pause music|stop music|stop spotify|pause it|stop it)\b/.test(normalized)) {
    const player = await spotifyRequest(cfg, 'GET', '/v1/me/player').catch(() => null);
    if (player && player.is_playing === false) {
      result = { alreadyPaused: true };
      assistantText = 'Spotify is already paused.';
    } else {
      result = await spotifyRequest(cfg, 'PUT', '/v1/me/player/pause');
      assistantText = 'Paused Spotify.';
    }
    action = 'pause';
  } else if (!action && /\b(play|resume|play spotify|resume spotify|play music|resume music)\b/.test(normalized)) {
    result = await spotifyPlay(cfg, undefined, { skipIfAlreadyPlaying: true });
    action = 'play';
    assistantText = result.alreadyPlaying
      ? 'Spotify is already playing.'
      : result.recoveredDevice?.device?.name
        ? `Resumed Spotify on ${result.recoveredDevice.device.name}.`
        : 'Resumed Spotify.';
  } else if (!action && /\b(next|skip|skip song|next song|next track)\b/.test(normalized)) {
    result = await spotifyRequest(cfg, 'POST', '/v1/me/player/next');
    action = 'next';
    assistantText = 'Skipped to the next track.';
  } else if (!action && /\b(restart|restart song|restart track|restart this song|start over|start this song over|replay|play from the beginning|beginning)\b/.test(normalized)) {
    const player = await spotifyRequest(cfg, 'GET', '/v1/me/player').catch(() => null);
    if (player?.is_playing === false) {
      result = await spotifyPlay(cfg, { position_ms: 0 });
    } else {
      result = await spotifyRequest(cfg, 'PUT', '/v1/me/player/seek?position_ms=0');
    }
    action = 'restart';
    assistantText = 'Restarted the current track.';
  } else if (!action && /\b(previous|prev|back|last song|previous song|previous track)\b/.test(normalized)) {
    result = await spotifyRequest(cfg, 'POST', '/v1/me/player/previous');
    action = 'previous';
    assistantText = 'Went to the previous track.';
  } else if (!action && /\b(mute|mute spotify|mute music)\b/.test(normalized)) {
    result = await spotifyRequest(cfg, 'PUT', '/v1/me/player/volume?volume_percent=0');
    action = 'mute';
    assistantText = 'Muted Spotify.';
  }

  if (!action) return null;
  const localSpeech = await trySpeakTextLocally(assistantText);
  return { handled: true, action, result, assistantText, localSpeech };
}

async function handleTranscript(cfg, transcript, options = {}) {
  const profile = options.profile || 'spotify';
  const clipCommand = await handleClipVoiceCommand(cfg, transcript).catch(error => ({ handled: true, action: 'clip-error', error: error?.message || String(error), assistantText: `Clip command failed: ${error?.message || String(error)}` }));
  if (clipCommand?.handled) {
    await logVoiceCommand({ transcript, profile, type: 'clip', action: clipCommand.action, assistantText: clipCommand.assistantText, error: clipCommand.error || null, result: clipCommand.result || null, reason: options.reason || null });
    return { command: clipCommand };
  }

  const command = profile !== 'spotify'
    ? null
    : await handleSpotifyVoiceCommand(cfg, transcript).catch(error => ({ handled: true, action: 'spotify-error', error: error?.message || String(error), assistantText: `Spotify command failed: ${error?.message || String(error)}` }));
  if (command?.handled) {
    await logVoiceCommand({ transcript, profile, type: 'spotify', action: command.action, assistantText: command.assistantText, error: command.error || null, reason: options.reason || null });
    return { command };
  }
  if (profile === 'hermy-tv') {
    const sent = await sendTranscriptToOllamaHermy(cfg, transcript, { profile });
    await logVoiceCommand({ transcript, profile, type: 'ollama-hermy-tv', assistantText: sent?.assistantText || null, error: sent?.localSpeech?.error || null, reason: options.reason || null, model: sent?.model || null });
    return { sent };
  }

  const deliverToDiscord = options.deliver === true;
  const sent = await sendTranscriptToOpenClaw(cfg, transcript, { deliverToDiscord, profile });
  if (sent) {
    await logVoiceCommand({ transcript, profile, type: 'openclaw', assistantText: sent?.assistantText || null, error: sent?.localSpeech?.error || null, reason: options.reason || null });
    return { sent };
  }
  await logVoiceCommand({ transcript, profile, type: 'none', reason: options.reason || null });
  return { sent: null };
}

async function sendTranscriptToOpenClaw(cfg, transcript, options = {}) {
  if (!transcript) return null;
  const profileCfg = resolveOpenClawProfile(cfg, options.profile);
  if (!profileCfg?.sessionId) {
    return { skipped: true, reason: 'No openclaw.sessionId configured' };
  }
  const voicePrompt = [
    'This message came from push-to-talk voice input.',
    'Reply in normal text only, keep it concise, and do not emit TTS directives.',
    'The bridge will speak the reply locally on the PC.',
    '',
    transcript,
  ].join('\n');
  const args = ['agent'];
  if (profileCfg.agentId) args.push('--agent', profileCfg.agentId);
  args.push('--session-id', profileCfg.sessionId, '--message', voicePrompt, '--thinking', profileCfg.thinking ?? 'medium', '--timeout', '120', '--json');
  if (options.deliverToDiscord === true && profileCfg.deliver !== false) {
    if (profileCfg.replyChannel) args.push('--reply-channel', profileCfg.replyChannel);
    if (profileCfg.replyAccountId) args.push('--reply-account', profileCfg.replyAccountId);
    if (profileCfg.replyTo) args.push('--reply-to', profileCfg.replyTo);
    args.push('--deliver');
  }
  const { stdout, stderr } = await runOpenClaw(args, 240);
  let payload = null;
  try { payload = JSON.parse(stdout); } catch { payload = { raw: stdout }; }
  const assistantText = extractAssistantText(payload);
  if (assistantText && String(options.profile || '').trim() === 'hermy-tv') {
    const reactionFile = cfg.output?.reactionFile;
    try {
      const writtenPath = await writeTextFile(reactionFile, assistantText, cfg.output?.clearAfterMs);
      if (writtenPath) {
        console.log(`[spotify-ptt] mirrored Hermy-TV reply to ${writtenPath}`);
      }
    } catch (error) {
      console.error('[spotify-ptt] reaction mirror failed:', error.message);
    }
  }
  let localSpeech = null;
  if (assistantText) {
    localSpeech = await trySpeakTextLocally(assistantText);
  }
  return { stdout, stderr, assistantText, localSpeech };
}

async function loadOllamaHermyConfig() {
  let streamCfg = {};
  if (existsSync(STREAM_HERMY_CONFIG_PATH)) {
    streamCfg = JSON.parse(await readFile(STREAM_HERMY_CONFIG_PATH, 'utf8'));
  }
  const ollama = {
    endpoint: 'http://127.0.0.1:11434/api/generate',
    model: 'hermy-tv:latest',
    timeoutSeconds: 30,
    loreFile: './ollama-tv-lore.md',
    prompt: "You are Hermy-TV, Francisco's Twitch.tv stream cohost. Talk normally in plain, casual English. Keep replies concise.",
    ...(streamCfg.ollama ?? {}),
  };
  const memory = {
    enabled: true,
    dir: './memory/ollama-tv',
    ...(streamCfg.memory ?? {}),
  };
  const lorePath = resolveStreamHermyPath(ollama.loreFile);
  const lore = ollama.loreFile
    ? (await readFile(lorePath, 'utf8').catch(() => '')).trim()
    : '';
  return { ollama: { ...ollama, lore }, memory };
}

function resolveStreamHermyPath(filePath) {
  if (!filePath) return filePath;
  return path.isAbsolute(filePath) ? filePath : path.join(STREAM_HERMY_ROOT, filePath);
}

function buildOllamaHermyVoicePrompt(hermyCfg, sharedMemory, transcript, extraInstruction = '') {
  return [
    hermyCfg.ollama.prompt,
    hermyCfg.ollama.lore ? `\nHermy-TV lore:\n${hermyCfg.ollama.lore}` : '',
    memoryBlock(sharedMemory),
    '',
    'This message came from Francisco through Ctrl+F3 push-to-talk voice input.',
    'Reply as Hermy-TV in normal text only. Keep it concise because ElevenLabs will read it aloud.',
    extraInstruction,
    '',
    `Francisco: ${transcript}`,
    'Hermy-TV:',
  ].join('\n');
}

async function postOllamaHermy(hermyCfg, prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(hermyCfg.ollama.timeoutSeconds || 30) * 1000);
  try {
    const response = await fetch(hermyCfg.ollama.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: hermyCfg.ollama.model,
        prompt,
        stream: false,
        options: {
          temperature: 0.55,
          top_p: 0.8,
          num_predict: 160,
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`ollama ${response.status}: ${await response.text()}`);
    }
    const body = await response.json();
    return String(body.response ?? '').trim();
  } finally {
    clearTimeout(timeout);
  }
}

async function sendTranscriptToOllamaHermy(cfg, transcript, options = {}) {
  const hermyCfg = await loadOllamaHermyConfig();
  const override = banterOverrideForText(transcript);
  const sharedMemory = override ? '' : await readSharedMemory(hermyCfg.memory, STREAM_HERMY_ROOT);
  const recentResponses = await readRecentResponses(hermyCfg.memory, STREAM_HERMY_ROOT);
  let assistantText = appendGamblingDisclaimer(
    cleanHermyResponse(override || await postOllamaHermy(hermyCfg, buildOllamaHermyVoicePrompt(hermyCfg, sharedMemory, transcript))),
    transcript,
  );
  if (!override && looksRepeatedResponse(assistantText, recentResponses)) {
    assistantText = appendGamblingDisclaimer(
      cleanHermyResponse(await postOllamaHermy(
        hermyCfg,
        buildOllamaHermyVoicePrompt(hermyCfg, sharedMemory, transcript, buildAntiRepeatInstruction(recentResponses)),
      )),
      transcript,
    );
  }

  if (assistantText) {
    const reactionFile = cfg.output?.reactionFile;
    try {
      const writtenPath = await writeTextFile(reactionFile, assistantText, cfg.output?.clearAfterMs);
      if (writtenPath) {
        console.log(`[spotify-ptt] mirrored Ollama Hermy-TV reply to ${writtenPath}`);
      }
    } catch (error) {
      console.error('[spotify-ptt] reaction mirror failed:', error.message);
    }
    if (!isBanterOverrideText(transcript) && !isBanterOverrideText(assistantText)) {
      await appendSharedMemory(hermyCfg.memory, STREAM_HERMY_ROOT, {
        source: 'ctrl-f3-ptt',
        user: transcript,
        assistant: assistantText,
      });
    }
    await appendRecentResponse(hermyCfg.memory, STREAM_HERMY_ROOT, assistantText);
  }

  const localSpeech = assistantText ? await trySpeakTextLocally(assistantText) : null;
  return { assistantText, localSpeech, model: hermyCfg.ollama.model, profile: options.profile || 'hermy-tv' };
}

function resolveOpenClawProfile(cfg, profile) {
  const base = cfg.openclaw ?? {};
  const profileName = String(profile || '').trim();
  const overrides = profileName ? (base.profiles?.[profileName] ?? {}) : {};
  const merged = { ...base, ...overrides };
  delete merged.profiles;
  return merged;
}

function makeTempRecordingPath() {
  return path.join(os.tmpdir(), `spotify-ptt-${Date.now()}-${randomString(6)}.wav`);
}

function getRecorderCommand(cfg) {
  const recorder = cfg.recorder ?? {};
  return {
    cmd: recorder.cmd || 'pw-record',
    args: process.env.PTT_RECORDER_ARGS
      ? process.env.PTT_RECORDER_ARGS.split(' ').filter(Boolean)
      : [
          '--target', recorder.device,
          '--rate', String(recorder.rate ?? 16000),
          '--channels', String(recorder.channels ?? 1),
          '--format', recorder.format ?? 's16',
        ],
  };
}

async function startPttRecording(cfg, options = {}) {
  if (pttSession?.active) {
    return { active: true, startedAt: pttSession.startedAt };
  }

  await ensureState();
  const tempPath = makeTempRecordingPath();
  const { cmd, args } = getRecorderCommand(cfg);
  const child = spawn(cmd, [...args, tempPath], {
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: false,
  });

  pttSession = {
    active: true,
    startedAt: new Date().toISOString(),
    tempPath,
    child,
    finalizing: false,
    timer: null,
    profile: options.profile || 'spotify',
    deliver: options.deliver !== false,
  };

  const maxMs = Number(cfg.recorder?.maxMs ?? 20000);
  if (Number.isFinite(maxMs) && maxMs > 0) {
    pttSession.timer = setTimeout(() => {
      stopPttRecording(cfg, { deliver: pttSession?.deliver !== false, reason: 'auto-timeout', profile: pttSession?.profile || options.profile || 'spotify' })
        .catch(error => console.error('PTT auto-stop failed:', error));
    }, maxMs);
    pttSession.timer.unref?.();
  }

  child.on('error', async error => {
    pttSession = null;
    console.error('PTT recorder error:', error);
  });

  child.stderr?.on('data', chunk => {
    const msg = chunk.toString('utf8').trim();
    if (msg) console.error('[ptt recorder]', msg);
  });

  child.on('close', async () => {
    if (!pttSession || pttSession.child !== child) return;
    const session = pttSession;
    pttSession = null;
    if (session.timer) clearTimeout(session.timer);
    if (session.finalizing) return;
    try {
      const st = await stat(session.tempPath).catch(() => null);
      if (!st || st.size === 0) {
        await rm(session.tempPath, { force: true });
        return;
      }
      const raw = await transcribeAudioFile(cfg, session.tempPath);
      const transcript = extractTranscript(raw);
      if (transcript) {
        await handleTranscript(cfg, transcript, { deliver: session.deliver !== false, profile: session.profile || 'spotify' });
      }
    } catch (error) {
      console.error('PTT finalize failed:', error);
    } finally {
      await rm(session.tempPath, { force: true }).catch(() => {});
    }
  });

  return { active: true, startedAt: pttSession.startedAt };
}

async function stopPttRecording(cfg, options = {}) {
  if (!pttSession?.active) {
    return { active: false };
  }

  const session = pttSession;
  pttSession = null;
  session.finalizing = true;
  if (session.timer) clearTimeout(session.timer);

  await new Promise(resolve => {
    const timer = setTimeout(() => {
      try { session.child.kill('SIGKILL'); } catch {}
      resolve();
    }, 3000);
    session.child.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
    try { session.child.kill('SIGINT'); } catch { resolve(); }
  });

  try {
    const st = await stat(session.tempPath).catch(() => null);
    if (!st || st.size === 0) {
      await rm(session.tempPath, { force: true });
      return { active: false, transcript: '' };
    }
    try {
      const raw = await transcribeAudioFile(cfg, session.tempPath);
      const transcript = extractTranscript(raw);
      let handled = null;
      if (transcript) {
        handled = await handleTranscript(cfg, transcript, { ...options, deliver: options.deliver !== false, profile: options.profile || session.profile || 'spotify' });
      }
      return { active: false, transcript, ...handled };
    } catch (error) {
      return { active: false, transcript: '', error: error?.message || String(error) };
    }
  } finally {
    await rm(session.tempPath, { force: true }).catch(() => {});
  }
}

async function cleanupOrphanRecorders() {
  await execFileAsync('pkill', ['-f', 'pw-record .*spotify-ptt-']).catch(() => {});
  const tmpDir = os.tmpdir();
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(tmpDir).catch(() => []);
  await Promise.all(entries
    .filter(name => name.startsWith('spotify-ptt-'))
    .map(name => rm(path.join(tmpDir, name), { force: true }).catch(() => {})));
}

async function togglePttRecording(cfg, options = {}) {
  if (pttSession?.active) {
    return stopPttRecording(cfg, options);
  }
  return startPttRecording(cfg, options);
}

async function recordBodyToTempFile(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 25 * 1024 * 1024) {
      throw new Error('Audio upload too large. Keep clips under 25 MB.');
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  const ext = /ogg|opus/.test(req.headers['content-type'] ?? '') ? '.ogg' : '.webm';
  const filePath = path.join(os.tmpdir(), `spotify-ptt-${Date.now()}-${randomString(6)}${ext}`);
  await writeFile(filePath, body);
  return filePath;
}

function sendJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

function sendText(res, code, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': contentType });
  res.end(text);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function pageHtml(cfg) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Spotify + PTT bridge</title>
<style>
  :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }
  body { margin: 0; background: #111; color: #f3f3f3; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 24px; display: grid; gap: 16px; }
  .card { background: #181818; border: 1px solid #2c2c2c; border-radius: 16px; padding: 16px; box-shadow: 0 8px 30px rgba(0,0,0,.2); }
  .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  button, select, input, textarea, a.btn {
    background: #2a2a2a; color: #fff; border: 1px solid #444; border-radius: 12px; padding: 10px 14px; font: inherit;
  }
  button:hover, a.btn:hover { background: #363636; }
  button.primary { background: #1db954; color: #08130b; border-color: #1db954; font-weight: 700; }
  button.primary:hover { background: #1ed760; }
  button.warn { background: #8b2f2f; }
  .status { white-space: pre-wrap; line-height: 1.4; background: #101010; border-radius: 12px; padding: 12px; border: 1px solid #2a2a2a; }
  .muted { color: #a3a3a3; }
  .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
  textarea { width: 100%; min-height: 120px; resize: vertical; }
  .devices { display: grid; gap: 8px; }
  .device { display:flex; gap:8px; align-items:center; justify-content:space-between; border: 1px solid #333; border-radius: 12px; padding: 10px; }
  .device small { color: #9f9f9f; }
  .ptt { width: 100%; min-height: 84px; font-size: 1.05rem; }
  .list { display:grid; gap:8px; }
  .pill { display:inline-block; padding: 4px 10px; border-radius:999px; background:#232323; border:1px solid #343434; font-size:.9rem; }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="row">
      <h1 style="margin:0; font-size:1.4rem;">Spotify + push-to-talk bridge</h1>
      <span class="pill" id="connPill">Loading…</span>
    </div>
    <p class="muted">Mic audio is recorded only while you hold the button, then it is transcribed and the audio file is deleted.</p>
    <div class="row">
      <a class="btn primary" href="/auth/spotify">Connect Spotify</a>
      <button id="refreshBtn">Refresh status</button>
      <label class="row" style="gap:6px;">
        <input type="checkbox" id="deliverBox" checked />
        send transcript into OpenClaw chat
      </label>
    </div>
    <div class="status" id="statusBox">Loading…</div>
  </div>

  <div class="grid">
    <div class="card">
      <h2 style="margin-top:0;">Spotify</h2>
      <div class="row">
      <button id="playBtn">Play</button>
        <button id="pauseBtn">Pause</button>
        <button id="restartBtn">Restart</button>
        <button id="prevBtn">Prev</button>
        <button id="nextBtn">Next</button>
      </div>
      <div class="row" style="margin-top:12px;">
        <label>Volume <input id="volumeInput" type="number" min="0" max="100" step="1" value="50" style="width:80px;" /></label>
        <button id="volumeBtn">Set</button>
      </div>
      <div style="margin-top:12px;">
        <div class="muted">Devices</div>
        <div class="devices" id="devicesBox"></div>
      </div>
    </div>

    <div class="card">
      <h2 style="margin-top:0;">Push to talk</h2>
      <button class="primary ptt" id="pttBtn">Hold to talk</button>
      <p class="muted">Hold the button, or hold Space while this page is focused. The global KDE hotkey is still toggle-based.</p>
      <div class="status" id="pttStatus">Idle.</div>
      <div style="margin-top:12px;">
        <div class="muted">Transcript</div>
        <textarea id="transcriptBox" readonly placeholder="Transcript will appear here."></textarea>
      </div>
    </div>
  </div>
</div>

<script>
const statusBox = document.getElementById('statusBox');
const pttStatus = document.getElementById('pttStatus');
const transcriptBox = document.getElementById('transcriptBox');
const connPill = document.getElementById('connPill');
const devicesBox = document.getElementById('devicesBox');
const deliverBox = document.getElementById('deliverBox');
const pttBtn = document.getElementById('pttBtn');
let pttActive = false;
let pttBusy = false;
let pointerHolding = false;

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.error || text || ('HTTP ' + res.status));
  return data;
}

function setStatus(data) {
  connPill.textContent = data.spotifyConnected ? 'Spotify connected' : 'Spotify not connected';
  pttActive = Boolean(data.ptt?.active);
  const isPlaying = Boolean(data.spotify?.isPlaying);
  statusBox.textContent = [
    'Spotify: ' + (data.spotifyConnected ? 'connected' : 'not connected'),
    data.spotify?.user ? ('User: ' + data.spotify.user) : 'User: unknown',
    data.spotify?.deviceName ? ('Active device: ' + data.spotify.deviceName) : 'Active device: none',
    data.openclaw?.sessionId ? ('OpenClaw session: ' + data.openclaw.sessionId) : 'OpenClaw session: not configured',
    data.transcription?.model ? ('Transcription model: ' + data.transcription.model) : 'Transcription model: default',
    'PTT: ' + (data.ptt?.active ? 'recording' : 'idle'),
    'Page ready.'
  ].join('\\n');
  pttBtn.textContent = data.ptt?.active ? 'Release to stop' : 'Hold to talk';
  document.getElementById('playBtn').classList.toggle('primary', isPlaying);
  document.getElementById('pauseBtn').classList.toggle('primary', !isPlaying && Boolean(data.spotify?.deviceName));
  const activeDevice = data.spotify?.devices?.find(device => device.is_active) || null;
  if (activeDevice?.volume_percent != null) document.getElementById('volumeInput').value = activeDevice.volume_percent;
  devicesBox.innerHTML = '';
  for (const device of data.spotify?.devices || []) {
    const div = document.createElement('div');
    div.className = 'device';
    const left = document.createElement('div');
    left.innerHTML = '<strong>' + escapeHtml(device.name) + '</strong><br><small>' + escapeHtml((device.type || 'device') + (device.is_active ? ' • active' : '') + (device.volume_percent != null ? (' • ' + device.volume_percent + '%') : '')) + '</small>';
    const right = document.createElement('button');
    right.textContent = 'Use';
    right.onclick = async () => {
      try {
        await api('/api/spotify/transfer', { method: 'POST', body: JSON.stringify({ deviceId: device.id, play: true }) });
        await refresh();
      } catch (err) {
        alert(err.message);
      }
    };
    div.append(left, right);
    devicesBox.appendChild(div);
  }
}

async function refresh() {
  const data = await api('/api/status');
  setStatus(data);
}

async function spotify(action, payload = {}) {
  return api('/api/spotify/' + action, { method: 'POST', body: JSON.stringify(payload) });
}

document.getElementById('refreshBtn').onclick = refresh;
document.getElementById('playBtn').onclick = () => spotify('play').then(refresh).catch(err => alert(err.message));
document.getElementById('pauseBtn').onclick = () => spotify('pause').then(refresh).catch(err => alert(err.message));
document.getElementById('restartBtn').onclick = () => spotify('restart').then(refresh).catch(err => alert(err.message));
document.getElementById('prevBtn').onclick = () => spotify('previous').then(refresh).catch(err => alert(err.message));
document.getElementById('nextBtn').onclick = () => spotify('next').then(refresh).catch(err => alert(err.message));
function setVolumeFromInput() {
  const input = document.getElementById('volumeInput');
  const raw = Number(input.value);
  if (!Number.isFinite(raw) || raw < 0 || raw > 100) {
    alert('Volume must be a number from 0 to 100.');
    return;
  }
  const volumePercent = Math.round(raw);
  input.value = volumePercent;
  spotify('volume', { volumePercent }).then(refresh).catch(err => alert(err.message));
}
document.getElementById('volumeBtn').onclick = setVolumeFromInput;
document.getElementById('volumeInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    setVolumeFromInput();
  }
});

async function setRecording(shouldRecord) {
  if (pttBusy) return;
  if (shouldRecord === pttActive) return;
  pttBusy = true;
  pttBtn.textContent = shouldRecord ? 'Starting…' : 'Stopping…';
  pttStatus.textContent = shouldRecord ? 'Starting recording…' : 'Stopping recording…';
  try {
    const data = await api(shouldRecord ? '/api/ptt/start' : '/api/ptt/stop', {
      method: 'POST',
      body: JSON.stringify({ deliver: deliverBox.checked }),
    });
    if (data.command?.assistantText) transcriptBox.value = data.transcript + '\\n\\n' + data.command.assistantText;
    else if (data.transcript) transcriptBox.value = data.transcript;
    else if (data.error) transcriptBox.value = 'Transcription failed: ' + data.error;
    pttStatus.textContent = data.error
      ? 'Recording stopped, but transcription failed: ' + data.error
      : (data.command?.assistantText ? data.command.assistantText : (data.transcript ? 'Transcript sent.' : (data.active ? 'Recording…' : 'Idle.')));
  } catch (err) {
    pttStatus.textContent = 'PTT error: ' + err.message;
  } finally {
    pttBusy = false;
    await refresh();
  }
}

pttBtn.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  e.preventDefault();
  pointerHolding = true;
  setRecording(true);
});
pttBtn.addEventListener('pointerup', e => {
  e.preventDefault();
  pointerHolding = false;
  setRecording(false);
});
pttBtn.addEventListener('pointercancel', () => {
  pointerHolding = false;
  setRecording(false);
});
pttBtn.addEventListener('pointerleave', () => {
  if (pointerHolding) {
    pointerHolding = false;
    setRecording(false);
  }
});
window.addEventListener('keydown', e => {
  if (e.code === 'Space' && !e.repeat && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    setRecording(true);
  }
});
window.addEventListener('keyup', e => {
  if (e.code === 'Space' && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    setRecording(false);
  }
});

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

refresh().catch(err => {
  statusBox.textContent = 'Failed to load status: ' + err.message;
  connPill.textContent = 'Offline';
});
</script>
</body>
</html>`;
}

async function spotifyStatus(cfg) {
  const out = { connected: false, user: null, deviceName: null, devices: [], isPlaying: false, track: null };
  try {
    const me = await spotifyRequest(cfg, 'GET', '/v1/me');
    out.connected = true;
    out.user = me.display_name || me.id || null;
    const devices = await spotifyRequest(cfg, 'GET', '/v1/me/player/devices');
    out.devices = devices?.devices || [];
    const active = out.devices.find(d => d.is_active) || null;
    out.deviceName = active?.name || null;
    const player = await spotifyRequest(cfg, 'GET', '/v1/me/player').catch(() => null);
    out.isPlaying = Boolean(player?.is_playing);
    out.track = player?.item?.name || null;
  } catch {
    const tokens = await loadTokens();
    out.connected = Boolean(tokens?.access_token);
  }
  return out;
}

async function handleAuthStart(cfg, res) {
  if (!cfg.spotify.clientId || cfg.spotify.clientId === 'YOUR_SPOTIFY_CLIENT_ID') {
    sendText(res, 400, 'Set spotify.clientId in config.json first.');
    return;
  }
  const verifier = randomString(64);
  const challenge = base64Url(sha256(verifier));
  const state = randomString(24);
  await saveAuthState({ verifier, state, createdAt: new Date().toISOString() });
  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', cfg.spotify.clientId);
  authUrl.searchParams.set('scope', cfg.spotify.scopes.join(' '));
  authUrl.searchParams.set('redirect_uri', cfg.spotify.redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('code_challenge', challenge);
  res.writeHead(302, { Location: authUrl.toString() });
  res.end();
}

async function handleCallback(req, res, cfg, url) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('error');
  if (err) {
    sendText(res, 400, `Spotify auth failed: ${err}`);
    return;
  }
  if (!code || !state) {
    sendText(res, 400, 'Missing OAuth code or state.');
    return;
  }
  const authState = await loadAuthState();
  if (!authState || authState.state !== state) {
    sendText(res, 400, 'OAuth state mismatch. Try connecting Spotify again.');
    return;
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.spotify.redirectUri,
    client_id: cfg.spotify.clientId,
    code_verifier: authState.verifier,
  });

  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    sendText(res, 500, `Token exchange failed: ${tokenRes.status} ${text}`);
    return;
  }

  const token = await tokenRes.json();
  const saved = {
    ...token,
    expires_at: Date.now() + (Number(token.expires_in ?? 3600) * 1000),
    obtained_at: new Date().toISOString(),
  };
  await saveTokens(saved);
  await deleteAuthState();
  sendText(res, 200, 'Spotify connected. You can close this tab and return to the bridge.');
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function main() {
  const cfg = await loadConfig();
  await ensureState();
  await cleanupOrphanRecorders();
  const port = Number(cfg.server.port ?? 8787);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${port}`}`);
      if (req.method === 'GET' && url.pathname === '/') {
        sendText(res, 200, pageHtml(cfg), 'text/html; charset=utf-8');
        return;
      }
      if (req.method === 'GET' && url.pathname === '/auth/spotify') {
        await handleAuthStart(cfg, res);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/callback') {
        await handleCallback(req, res, cfg, url);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        const [spotify, tokens] = await Promise.all([spotifyStatus(cfg), loadTokens()]);
        sendJson(res, 200, {
          spotifyConnected: Boolean(tokens?.access_token),
          spotify,
          openclaw: {
            sessionId: cfg.openclaw.sessionId,
            deliver: cfg.openclaw.deliver !== false,
          },
          transcription: cfg.transcription,
          ptt: {
            active: Boolean(pttSession?.active),
            startedAt: pttSession?.startedAt ?? null,
            profile: pttSession?.profile ?? null,
          },
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/spotify/devices') {
        const data = await spotifyRequest(cfg, 'GET', '/v1/me/player/devices');
        sendJson(res, 200, data);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/ptt/start') {
        const body = await readJson(req).catch(() => ({}));
        const data = await startPttRecording(cfg, { profile: body.profile || 'spotify' });
        sendJson(res, 200, { ...data, deliver: body.deliver !== false });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/ptt/stop') {
        const body = await readJson(req).catch(() => ({}));
        const data = await stopPttRecording(cfg, { deliver: body.deliver !== false, profile: body.profile || undefined });
        sendJson(res, 200, { ...data, deliver: body.deliver !== false });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/ptt/toggle') {
        const body = await readJson(req).catch(() => ({}));
        const data = await togglePttRecording(cfg, { deliver: body.deliver !== false, profile: body.profile || 'spotify' });
        sendJson(res, 200, { ...data, deliver: body.deliver !== false });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/voice-command') {
        const body = await readJson(req).catch(() => ({}));
        const transcript = String(body.transcript || '').trim();
        if (!transcript) {
          sendJson(res, 400, { error: 'Missing transcript.' });
          return;
        }
        const data = await handleTranscript(cfg, transcript, { deliver: body.deliver === true, profile: body.profile || 'spotify' });
        sendJson(res, 200, { transcript, ...data });
        return;
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/spotify/')) {
        const action = url.pathname.split('/').pop();
        const body = await readJson(req).catch(() => ({}));
        let result = null;
        switch (action) {
          case 'play':
            result = await spotifyPlay(cfg, undefined, { skipIfAlreadyPlaying: true });
            break;
          case 'pause':
            result = await spotifyRequest(cfg, 'PUT', '/v1/me/player/pause');
            break;
          case 'next':
            result = await spotifyRequest(cfg, 'POST', '/v1/me/player/next');
            break;
          case 'restart':
            {
              const player = await spotifyRequest(cfg, 'GET', '/v1/me/player').catch(() => null);
              if (player?.is_playing === false) {
                result = await spotifyRequest(cfg, 'PUT', '/v1/me/player/play', { position_ms: 0 });
              } else {
                result = await spotifyRequest(cfg, 'PUT', '/v1/me/player/seek?position_ms=0');
              }
            }
            break;
          case 'previous':
            result = await spotifyRequest(cfg, 'POST', '/v1/me/player/previous');
            break;
          case 'volume': {
            const vol = Math.max(0, Math.min(100, Number(body.volumePercent ?? 50)));
            result = await spotifyRequest(cfg, 'PUT', `/v1/me/player/volume?volume_percent=${encodeURIComponent(vol)}`);
            break;
          }
          case 'transfer': {
            const deviceIds = body.deviceId ? [body.deviceId] : [];
            result = await spotifyRequest(cfg, 'PUT', '/v1/me/player', { device_ids: deviceIds, play: Boolean(body.play) });
            break;
          }
          case 'playlist': {
            const name = body.name || body.playlist || body.alias;
            if (!name) {
              sendJson(res, 400, { error: 'Missing playlist name or alias.' });
              return;
            }
            result = await switchToPlaylist(cfg, name);
            break;
          }
          default:
            sendJson(res, 404, { error: `Unknown Spotify action: ${action}` });
            return;
        }
        sendJson(res, 200, { ok: true, result });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/transcribe') {
        const deliver = url.searchParams.get('deliver') === '1';
        const tempPath = await recordBodyToTempFile(req);
        try {
          const raw = await transcribeAudioFile(cfg, tempPath);
          const transcript = extractTranscript(raw);
          if (!transcript) throw new Error(`No transcript returned. Raw output: ${JSON.stringify(raw)}`);
          let sent = null;
          if (deliver) {
            sent = await sendTranscriptToOpenClaw(cfg, transcript);
          }
          sendJson(res, 200, { transcript, raw, sentToOpenClaw: Boolean(sent), sent });
        } finally {
          await rm(tempPath, { force: true });
        }
        return;
      }
      sendText(res, 404, 'Not found');
    } catch (error) {
      sendJson(res, 500, { error: error?.message || String(error) });
    }
  });

  server.listen(port, '127.0.0.1', async () => {
    console.log(`Spotify + PTT bridge running at http://127.0.0.1:${port}`);
    console.log(`Config: ${CONFIG_PATH}`);
    if (process.argv.includes('--open')) {
      try {
        const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
        await execFileAsync(opener, [`http://127.0.0.1:${port}`], { timeout: 10_000 });
      } catch {}
    }
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
