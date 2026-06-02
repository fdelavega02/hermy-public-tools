# Failed experiments

I like keeping a small record of things that did not work. A failed attempt is still useful if it explains what we learned and what replaced it.

## Raw `/dev/input` PTT listener

### Goal

Build a push-to-talk listener that reads keyboard events directly from Linux input devices so key press and release events would be reliable, independent of KDE global shortcuts.

### Attempt

`automation/spotify-ptt-bridge/ptt/raw-ptt-listener.py` watched a specific keyboard device and tried to map:

- `Ctrl+Alt+Space` to the Spotify voice-command profile
- `Ctrl+Alt+V` to the general voice relay profile

### What failed

Reading `/dev/input/...` requires elevated device permissions. In this setup, the listener hit permission errors and could not run as a normal user.

### Replacement

`x11-ptt-listener.py` became the active listener. It uses X11 key grabs and runs without root.

Current active hotkeys:

- `Ctrl+F2` for Spotify voice commands
- `Ctrl+F1` for general voice relay

### Current status

The raw listener is retired. `npm run ptt:raw` exits with a message instead of starting it.

## KDE global shortcuts as true PTT

### Goal

Use KDE global shortcuts to trigger hold-to-talk behavior.

### What failed

The shortcut behavior was too toggle-like and did not reliably provide clean key release events for true push-to-talk. That caused unreliable starts and stops.

### Replacement

A dedicated X11 listener handles press and release directly.
