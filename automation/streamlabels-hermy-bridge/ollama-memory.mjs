import { existsSync, mkdirSync } from 'node:fs';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MEMORY = {
  enabled: true,
  dir: './memory/ollama-tv',
  longTermFile: 'MEMORY.md',
  dailyDir: 'daily',
  recentResponsesFile: 'recent-responses.json',
  maxLongTermChars: 6000,
  maxRecentChars: 6000,
  maxEntryChars: 2000,
  maxRecentResponses: 20,
};

function normalizeMemoryConfig(memoryCfg = {}) {
  return { ...DEFAULT_MEMORY, ...(memoryCfg ?? {}) };
}

function resolveLocal(root, p) {
  if (!p) return p;
  return path.isAbsolute(p) ? p : path.join(root, p);
}

function isoDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function clip(value, maxChars) {
  const text = String(value ?? '').trim();
  if (!maxChars || text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 20).trim()}\n...[truncated]`;
}

function memoryPaths(memoryCfg, root) {
  const cfg = normalizeMemoryConfig(memoryCfg);
  const dir = resolveLocal(root, cfg.dir);
  return {
    cfg,
    dir,
    longTerm: path.join(dir, cfg.longTermFile),
    recentResponses: path.join(dir, cfg.recentResponsesFile),
    dailyDir: path.join(dir, cfg.dailyDir),
    today: path.join(dir, cfg.dailyDir, `${isoDate(0)}.md`),
    yesterday: path.join(dir, cfg.dailyDir, `${isoDate(-1)}.md`),
  };
}

async function ensureMemoryFiles(memoryCfg, root) {
  const paths = memoryPaths(memoryCfg, root);
  mkdirSync(paths.dir, { recursive: true });
  mkdirSync(paths.dailyDir, { recursive: true });

  if (!existsSync(paths.longTerm)) {
    await writeFile(paths.longTerm, [
      '# Hermy-TV Memory',
      '',
      'Curated durable notes for the local Ollama Hermy-TV personality.',
      'Daily raw logs live under `daily/`.',
      '',
      '## Standing Notes',
      '',
    ].join('\n'));
  }

  return paths;
}

async function readMaybe(filePath) {
  return (await readFile(filePath, 'utf8').catch(() => '')).trim();
}

export async function readSharedMemory(memoryCfg, root) {
  const cfg = normalizeMemoryConfig(memoryCfg);
  if (!cfg.enabled) return '';

  const paths = await ensureMemoryFiles(cfg, root);
  const longTerm = clip(await readMaybe(paths.longTerm), Number(cfg.maxLongTermChars));
  const today = clip(await readMaybe(paths.today), Number(cfg.maxRecentChars));
  const yesterday = clip(await readMaybe(paths.yesterday), Math.floor(Number(cfg.maxRecentChars) / 2));

  return [
    'Hermy-TV shared memory:',
    longTerm ? `\nLong-term memory:\n${longTerm}` : '',
    yesterday ? `\nYesterday's raw notes:\n${yesterday}` : '',
    today ? `\nToday's raw notes:\n${today}` : '',
    '',
    'Use this as context. Do not quote private file paths or memory internals back to chat unless explicitly asked about setup.',
  ].filter(Boolean).join('\n');
}

export function memoryBlock(memoryText) {
  return memoryText ? `\n${memoryText}` : '';
}

function shouldPromoteToLongTerm(text) {
  return /\b(remember|do not forget|don't forget|from now on|you should know|keep in mind)\b/i.test(text);
}

export async function appendSharedMemory(memoryCfg, root, entry) {
  const cfg = normalizeMemoryConfig(memoryCfg);
  if (!cfg.enabled) return;

  const paths = await ensureMemoryFiles(cfg, root);
  const timestamp = new Date().toISOString();
  const source = String(entry.source ?? 'unknown');
  const user = clip(entry.user ?? '', Number(cfg.maxEntryChars));
  const assistant = clip(entry.assistant ?? '', Number(cfg.maxEntryChars));

  const dailyEntry = [
    `## ${timestamp} - ${source}`,
    user ? `User/Event: ${user}` : '',
    assistant ? `Hermy-TV: ${assistant}` : '',
    '',
  ].filter(Boolean).join('\n');

  await appendFile(paths.today, `${dailyEntry}\n`);

  if (user && shouldPromoteToLongTerm(user)) {
    await appendFile(paths.longTerm, `- ${timestamp}: ${user}\n`);
  }
}

export async function readRecentResponses(memoryCfg, root) {
  const cfg = normalizeMemoryConfig(memoryCfg);
  if (!cfg.enabled) return [];
  const paths = await ensureMemoryFiles(cfg, root);
  try {
    const parsed = JSON.parse(await readFile(paths.recentResponses, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string' && item.trim()) : [];
  } catch {
    return [];
  }
}

export async function appendRecentResponse(memoryCfg, root, response) {
  const cfg = normalizeMemoryConfig(memoryCfg);
  if (!cfg.enabled) return;
  const paths = await ensureMemoryFiles(cfg, root);
  const text = String(response ?? '').trim();
  if (!text) return;

  const recent = await readRecentResponses(cfg, root);
  const normalized = normalizeResponse(text);
  const withoutDuplicate = recent.filter(item => normalizeResponse(item) !== normalized);
  withoutDuplicate.push(text);
  const max = Number(cfg.maxRecentResponses) || DEFAULT_MEMORY.maxRecentResponses;
  await writeFile(paths.recentResponses, `${JSON.stringify(withoutDuplicate.slice(-max), null, 2)}\n`);
}

export function looksRepeatedResponse(response, recentResponses) {
  const normalized = normalizeResponse(response);
  if (!normalized) return false;
  return recentResponses.some(previous => {
    const prior = normalizeResponse(previous);
    if (!prior) return false;
    if (prior === normalized) return true;
    return jaccardWords(prior, normalized) >= 0.82;
  });
}

export function buildAntiRepeatInstruction(recentResponses) {
  const recent = recentResponses.slice(-8).map(item => `- ${item}`).join('\n');
  return recent ? `\nRecent Hermy-TV responses to avoid repeating verbatim:\n${recent}\nSay something different while keeping the same personality.` : '';
}

function normalizeResponse(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/["'`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaccardWords(a, b) {
  const left = new Set(a.split(' ').filter(Boolean));
  const right = new Set(b.split(' ').filter(Boolean));
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const word of left) {
    if (right.has(word)) intersection += 1;
  }
  return intersection / new Set([...left, ...right]).size;
}
