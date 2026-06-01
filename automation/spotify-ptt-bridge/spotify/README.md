# Spotify control

This section covers the Spotify side of the bridge.

## What it does

- Uses Spotify OAuth with PKCE, so no client secret is stored.
- Stores Spotify tokens under `../state/`, which is ignored by git.
- Controls playback through the Spotify Web API.
- Supports play, pause, next, previous, volume, mute, restart song, and device checks through the shared local server.

## Important files

- `../server.mjs` handles OAuth, playback API calls, and the local web UI.
- `../config.json` stores the local Spotify client id and redirect URI.
- `../state/spotify-token.json` stores local OAuth tokens and is ignored by git.

## Device note

Spotify commands need an active or available Spotify device. If `/devices` is empty, open Spotify on the phone or desktop first, then retry the command.
