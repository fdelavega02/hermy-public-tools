# Streamlabels + Hermy Bridge

Public-safe skeleton for stream-side Hermy-TV helpers used by Streamlabels, Streamlabs, local Ollama chat, and the Spotify/PTT bridge.

This folder intentionally does not include live config files, API keys, local service details, generated logs, private lore, private memory, real account IDs, or raw stream events.

## Sports Betting Odds

`sports-betting-context.mjs` can optionally fetch live/upcoming public odds from The Odds API before Hermy answers betting-related prompts. It returns a short text block with only summarized public odds:

- checked time
- configured sport key
- matched event
- start time when available
- moneyline, spread, and total lines from a limited number of books
- a reminder that head-to-head history is not connected

The API key stays in the private environment. Do not put it in `config.json`.

```fish
set -gx THE_ODDS_API_KEY "your key"
```

Enable and tune the lookup in private `config.json`:

```json
"sportsBetting": {
  "enabled": true,
  "apiKeyEnv": "THE_ODDS_API_KEY",
  "regions": ["us"],
  "markets": ["h2h", "spreads", "totals"],
  "oddsFormat": "american",
  "timeoutSeconds": 8,
  "maxEventsPerSport": 24,
  "maxBooksPerMarket": 4,
  "sports": ["basketball_nba", "americanfootball_nfl", "baseball_mlb"]
}
```

Config fields:

- `enabled`: turns lookup on or off.
- `apiKeyEnv`: environment variable that contains the private The Odds API key.
- `endpointBase`: base API URL, normally `https://api.the-odds-api.com/v4`.
- `regions`: bookmaker regions, such as `us`.
- `markets`: odds markets to request. This example supports `h2h`, `spreads`, and `totals`.
- `oddsFormat`: set to `american` so prices are formatted as American odds.
- `timeoutSeconds`: request timeout before Hermy falls back to an unavailable-data warning.
- `maxEventsPerSport`: cap on events inspected per configured sport.
- `maxBooksPerMarket`: cap on bookmaker summaries injected into the prompt.
- `sports`: The Odds API sport keys to search.

If the key is missing, the API fails, or no matchup is found, Hermy gets an explicit unavailable-data note. She must not invent odds, head-to-head history, injuries, or confident picks when the lookup does not provide them.

## Prompt Wiring

The private Streamlabels/Streamlabs/Ollama receivers call:

```js
const sportsBettingContext = await buildSportsBettingContext(cfg.sportsBetting, viewerText);
```

When the returned string is non-empty, they append it to the prompt as:

```text
Sports betting tool result:
...
```

The prompt should then tell Hermy to summarize the actual odds/lines from that context, never to mention private tools or prompt internals, and never to claim unavailable odds or history as facts.

## Ctrl+F4 PTT Lane

`../spotify-ptt-bridge/server.mjs` uses the same helper module and reads the same private stream bridge `sportsBetting` config. That means the local Ollama voice lane can answer a Ctrl+F4 sports-odds question from actual summarized lines instead of saying to check a tool result.
