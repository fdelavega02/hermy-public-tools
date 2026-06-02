# Push-to-talk and voice relay

This section contains the PTT, voice relay, hotkey, and clip-replay support scripts.

## Files

- `hotkey-toggle.mjs` toggles the PTT endpoint from a CLI or desktop shortcut.
- `x11-ptt-listener.py` provides global hold-to-talk shortcuts on X11 without root.
- `raw-ptt-listener.py` watches a keyboard input device directly for reliable press/release events.
- `clip-replay.sh` controls GPU Screen Recorder replay clips.

## Hotkeys

Current listener behavior:

- X11 listener (`x11-ptt-listener.py`):
  - `Ctrl+F2` holds the Spotify voice-command profile.
  - `Ctrl+F1` holds the general voice relay profile.
- Raw input listener (`raw-ptt-listener.py`):
  - `Ctrl+Alt+Space` holds the Spotify voice-command profile.
  - `Ctrl+Alt+V` holds the general voice relay profile.

Both listeners call `/api/ptt/start` on press and `/api/ptt/stop` on release.

## Clip replay

`clip-replay.sh` is a thin control helper for GPU Screen Recorder replay mode:

- `./clip-replay.sh save` signals the active replay process to save the current buffer.
- The script reads `~/.config/gpu-screen-recorder/config_ui` when it needs recorder settings, including capture target, save directory, duration, container, codec, FPS, audio codec, bitrate, replay storage, and restart-on-save behavior.
- It does not start a separate mismatched recorder just to save a clip, so saved clips follow the same settings as the GPU Screen Recorder app.


## Privacy note

The bridge records to a temporary audio file only while PTT is active. The shared server transcribes it, sends the transcript to OpenClaw when configured, then deletes the temp audio file.

## Shared state

Logs and pid files go to `../state/`, not this folder, so runtime files stay in one ignored place.
