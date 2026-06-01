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

## Playlist switching

You can switch playlists by voice or API once Spotify has playlist-read access. Example voice commands:

- "switch to chill playlist"
- "play my gym playlist"
- "put on focus"

The bridge first checks aliases in `../config.json` under `spotify.playlists`, then searches your Spotify library playlists by name. Playlist switching turns shuffle on automatically before playback starts. Example aliases:

```json
"spotify": {
  "playlists": {
    "chill": "spotify:playlist:YOUR_PLAYLIST_ID",
    "gym": { "uri": "spotify:playlist:YOUR_PLAYLIST_ID", "name": "Gym" }
  }
}
```

If you added playlist-read scopes after already connecting Spotify, open `http://127.0.0.1:8787/auth/spotify` and approve Spotify again.
