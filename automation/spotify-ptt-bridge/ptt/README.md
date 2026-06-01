# Push-to-talk and voice relay

This section contains the PTT, voice relay, hotkey, and clip-replay support scripts.

## Files

- `hotkey-toggle.mjs` toggles the PTT endpoint from a CLI or desktop shortcut.
- `x11-ptt-listener.py` provides global hold-to-talk shortcuts on X11 without root.
- `raw-ptt-listener.py` watches a keyboard input device directly for reliable press/release events.
- `clip-replay.sh` controls GPU Screen Recorder replay clips.

## Hotkeys

Current listener behavior:

- `Ctrl+Alt+Space` starts the Spotify voice-command profile.
- `Ctrl+F1` starts the general voice relay profile in the X11 listener.
- The raw input listener also supports the configured keyboard-device combos in its script header.

## Privacy note

The bridge records to a temporary audio file only while PTT is active. The shared server transcribes it, sends the transcript to OpenClaw when configured, then deletes the temp audio file.

## Shared state

Logs and pid files go to `../state/`, not this folder, so runtime files stay in one ignored place.
