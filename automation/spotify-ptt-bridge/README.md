# Spotify + push-to-talk bridge

Local bridge for two things:

- Spotify Web API control on your Premium account
- a general voice relay that records when you toggle it, transcribes, deletes the audio, and hands the transcript back to OpenClaw, which can reply through Discord

## What this does

- Spotify OAuth uses PKCE, so no client secret is stored
- Playback control goes through the Spotify Web API, not mouse clicks
- Mic audio is only kept in a temporary file long enough to transcribe
- The temp audio file is deleted right after transcription
- The transcript can be sent into your OpenClaw Discord session, so I can answer back there

## Setup

1. Create a Spotify app in the Spotify Developer Dashboard.
2. Add this redirect URI:
   - `http://127.0.0.1:8787/callback`
3. Copy the example config:

```bash
cd /home/fdelavega02/.openclaw/workspace-twin/automation/spotify-ptt-bridge
cp config.example.json config.json
```

4. Put your Spotify `clientId` into `config.json`.
5. If needed, adjust the OpenClaw session id and reply settings in `config.json`.

## Run

### Foreground

```bash
npm start
```

Then open the local bridge in your browser.

Click **Connect Spotify**, approve the app, and come back.

### Background

A user service is available:

```bash
systemctl --user start spotify-ptt-bridge.service
systemctl --user stop spotify-ptt-bridge.service
systemctl --user status spotify-ptt-bridge.service
```

It is enabled to start on login.

## Mic bridge

- On the web page: hold **Hold to talk** or hold Space while the page is focused
- Speak
- Release to stop and send

Voice commands currently include play, pause, next, previous, mute, volume, and restart song.

The KDE global hotkey is still toggle-based because Plasma shortcuts fire an activation event, not a reliable key-release event. Press it once to start and once again to stop.

The bridge records to a temporary file only while you are talking. It does not keep an archive.

## Notes

- Spotify control only works while a device is active or selected.
- If transcription fails, OpenClaw’s audio transcription provider/config likely needs setup.
- KDE Plasma hotkeys: `Ctrl+Alt+Space` for Spotify, `Ctrl+Alt+V` for voice relay.
