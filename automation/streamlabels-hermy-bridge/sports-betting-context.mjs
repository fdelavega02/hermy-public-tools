import process from 'node:process';

const DEFAULTS = {
  enabled: false,
  apiKeyEnv: 'THE_ODDS_API_KEY',
  endpointBase: 'https://api.the-odds-api.com/v4',
  regions: ['us'],
  markets: ['h2h', 'spreads', 'totals'],
  oddsFormat: 'american',
  timeoutSeconds: 8,
  maxEventsPerSport: 24,
  maxBooksPerMarket: 4,
  sports: [
    'americanfootball_nfl',
    'basketball_nba',
    'baseball_mlb',
    'icehockey_nhl',
    'soccer_usa_mls',
    'soccer_epl',
    'soccer_uefa_champs_league',
  ],
};

const BETTING_RE = /\b(?:bet|betting|wager|gambl|odds|sportsbook|bookie|moneyline|spread|point\s+spread|over\/under|over\s+under|total|parlay|draftkings|fanduel|polymarket|smart\s+money|line)\b/i;
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'be', 'bet', 'betting', 'do', 'for', 'from', 'game', 'gamble',
  'has', 'have', 'hermy', 'i', 'in', 'is', 'line', 'money', 'my', 'of', 'on', 'or', 'play',
  'playing', 'please', 'rn', 'should', 'smart', 'the', 'them', 'to', 'tomorrow', 'tonight',
  'vs', 'what', 'who', 'win', 'with',
]);

export function normalizeSportsBettingConfig(raw = {}) {
  return {
    ...DEFAULTS,
    ...raw,
    regions: normalizeList(raw.regions, DEFAULTS.regions),
    markets: normalizeList(raw.markets, DEFAULTS.markets),
    sports: normalizeList(raw.sports, DEFAULTS.sports),
  };
}

export function isSportsBettingQuery(text) {
  return BETTING_RE.test(String(text ?? ''));
}

export async function buildSportsBettingContext(rawCfg, text) {
  const cfg = normalizeSportsBettingConfig(rawCfg);
  const query = String(text ?? '').trim();
  if (!cfg.enabled || !isSportsBettingQuery(query)) return '';

  const apiKey = process.env[cfg.apiKeyEnv || DEFAULTS.apiKeyEnv];
  if (!apiKey) {
    return [
      'Live betting context:',
      `- Odds lookup is configured but ${cfg.apiKeyEnv || DEFAULTS.apiKeyEnv} is not set.`,
      '- Do not invent odds, head-to-head records, injuries, or a confident pick.',
    ].join('\n');
  }

  const lookup = await lookupOdds(cfg, apiKey, query).catch(err => ({
    error: publicError(err),
  }));

  if (lookup.error) {
    return [
      'Live betting context:',
      `- Odds lookup failed: ${lookup.error}.`,
      '- Do not invent odds, head-to-head records, injuries, or a confident pick.',
    ].join('\n');
  }

  if (!lookup.event) {
    return [
      'Live betting context:',
      '- No matching live/upcoming event was found in the configured sports.',
      '- Do not invent odds, head-to-head records, injuries, or a confident pick.',
    ].join('\n');
  }

  return formatOddsContext(cfg, lookup);
}

async function lookupOdds(cfg, apiKey, query) {
  const queryTokens = tokenize(query);
  let best = null;

  for (const sport of cfg.sports) {
    const events = await fetchSportOdds(cfg, apiKey, sport);
    for (const event of events) {
      const score = scoreEventMatch(event, queryTokens);
      if (score <= 0) continue;
      const candidate = { sport, event, score };
      if (!best || candidate.score > best.score) best = candidate;
    }
  }

  if (!best) return { event: null };
  return {
    checkedAt: new Date().toISOString(),
    sport: best.sport,
    event: best.event,
  };
}

async function fetchSportOdds(cfg, apiKey, sport) {
  const url = new URL(`${String(cfg.endpointBase).replace(/\/$/, '')}/sports/${encodeURIComponent(sport)}/odds`);
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('regions', cfg.regions.join(','));
  url.searchParams.set('markets', cfg.markets.join(','));
  url.searchParams.set('oddsFormat', cfg.oddsFormat || DEFAULTS.oddsFormat);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(cfg.timeoutSeconds || DEFAULTS.timeoutSeconds) * 1000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(`odds API returned HTTP ${response.status}`);
    const body = await response.json();
    return Array.isArray(body) ? body.slice(0, Number(cfg.maxEventsPerSport) || DEFAULTS.maxEventsPerSport) : [];
  } finally {
    clearTimeout(timeout);
  }
}

function formatOddsContext(cfg, { checkedAt, sport, event }) {
  const books = Array.isArray(event.bookmakers) ? event.bookmakers : [];
  const markets = collectMarkets(books);
  const lines = [
    'Live betting context:',
    `- Checked at: ${checkedAt}`,
    `- Sport key: ${sport}`,
    `- Event: ${event.away_team} at ${event.home_team}`,
    event.commence_time ? `- Start time: ${event.commence_time}` : '',
    formatMarket(cfg, 'moneyline', markets.h2h),
    formatMarket(cfg, 'spread', markets.spreads),
    formatMarket(cfg, 'total', markets.totals),
    '- Head-to-head history is not connected yet; do not invent previous results.',
  ].filter(Boolean);
  return lines.join('\n');
}

function collectMarkets(books) {
  const result = { h2h: [], spreads: [], totals: [] };
  for (const book of books) {
    const bookTitle = book.title || book.key || 'book';
    for (const market of Array.isArray(book.markets) ? book.markets : []) {
      if (!result[market.key]) continue;
      result[market.key].push({
        book: bookTitle,
        outcomes: Array.isArray(market.outcomes) ? market.outcomes : [],
      });
    }
  }
  return result;
}

function formatMarket(cfg, label, entries = []) {
  const usable = entries
    .filter(entry => entry.outcomes.length)
    .slice(0, Number(cfg.maxBooksPerMarket) || DEFAULTS.maxBooksPerMarket)
    .map(entry => `${entry.book}: ${entry.outcomes.map(formatOutcome).join(', ')}`);
  if (!usable.length) return '';
  return `- ${label}: ${usable.join(' | ')}`;
}

function formatOutcome(outcome) {
  const name = outcome.name ?? 'unknown';
  const price = outcome.price == null ? '' : ` ${outcome.price}`;
  const point = outcome.point == null ? '' : ` (${outcome.point})`;
  return `${name}${point}${price}`.trim();
}

function scoreEventMatch(event, queryTokens) {
  if (!queryTokens.length) return 0;
  const home = new Set(tokenize(event.home_team));
  const away = new Set(tokenize(event.away_team));
  const teams = new Set([...home, ...away]);
  let score = 0;
  for (const token of queryTokens) {
    if (teams.has(token)) score += token.length >= 4 ? 2 : 1;
  }
  const homeHit = queryTokens.some(token => home.has(token));
  const awayHit = queryTokens.some(token => away.has(token));
  if (homeHit && awayHit) score += 5;
  return score >= 2 ? score : 0;
}

function tokenize(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

function normalizeList(value, fallback) {
  if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(item => item.trim()).filter(Boolean);
  return fallback;
}

function publicError(err) {
  if (err?.name === 'AbortError') return 'request timed out';
  const message = String(err?.message || err || 'unknown error');
  return message.replace(/[A-Za-z0-9_-]{20,}/g, '[redacted]').slice(0, 120);
}
