# Spotify + PTT bridge

Local bridge with two clearly separated parts:

- `spotify/` documents Spotify Web API setup and playback control
- `ptt/` contains push-to-talk, voice relay, hotkey, and clip-replay scripts

The shared `server.mjs` stays at the project root because it connects both sides through one local web/API server.

## Layout

```text
spotify-ptt-bridge/
├── server.mjs              # shared local API/web server
├── config.example.json     # safe starter config
├── config.json             # local private config, ignored by git
├── spotify/                # Spotify setup/docs
├── ptt/                    # PTT, voice relay, hotkeys, clip replay
└── state/                  # tokens, pid files, logs, ignored by git
```

## Setup

1. Create a Spotify app in the Spotify Developer Dashboard.
2. Add this redirect URI:
   - `http://127.0.0.1:8787/callback`
3. Copy the example config:

```bash
cd automation/spotify-ptt-bridge
cp config.example.json config.json
```

4. Put your Spotify `clientId` into `config.json`.
5. If needed, adjust the OpenClaw session id and reply settings in `config.json`.

## Run

### Foreground

```bash
npm start
```

Then open the local bridge in your browser, click **Connect Spotify**, approve the app, and come back.

### Background

A user service is available:

```bash
systemctl --user start spotify-ptt-bridge.service
systemctl --user stop spotify-ptt-bridge.service
systemctl --user status spotify-ptt-bridge.service
```

It is enabled to start on login.

## OBS reaction text

If `output.reactionFile` is set in `config.json`, Hermy-TV replies from the `Ctrl+F3` voice lane are also written to that file so OBS can show the same text that gets spoken locally.

## Quick commands

```bash
npm run check          # syntax-check server.mjs
npm run ptt:toggle     # toggle PTT from CLI
npm run ptt:x11        # start X11 global hotkey listener
npm run ptt:raw        # retired failed /dev/input attempt; exits without running
./ptt/clip-replay.sh save   # save the active GPU Screen Recorder replay buffer
```

## Playlist voice commands

After reconnecting Spotify with playlist-read scopes, you can say things like:

- "switch to chill playlist"
- "play my gym playlist"
- "put on focus"

Playlist aliases can be added under `spotify.playlists` in `config.json`. Playlist switching also turns shuffle on automatically before playback starts.

## Notes

- Spotify play/resume tries the current active device first, then transfers to an available Spotify device if Spotify reports no active device.
- Mic audio is only kept in a temporary file long enough to transcribe, then deleted.
- Clip replay saves use the currently running GPU Screen Recorder replay session and read the app's config dynamically, so clips match the desktop app settings instead of launching a second recorder with stale defaults.
- The shared server keeps Spotify and PTT connected, but the docs and support scripts are separated so GitHub is easier to read.
