#!/usr/bin/env python3
"""
Raw keyboard PTT listener for the local Spotify/OpenClaw bridge.

Watches only Ctrl, Alt, Space, and V events from one keyboard device.
- Ctrl+Alt+Space hold => /api/ptt/start, release => /api/ptt/stop
- Ctrl+Alt+V hold     => /api/ptt/start, release => /api/ptt/stop

This bypasses KDE global shortcuts so press/release is reliable.
"""
from __future__ import annotations

import argparse
import json
import os
import select
import signal
import struct
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / "state"
LOG = STATE / "raw-ptt-listener.log"
DEFAULT_DEVICE = "/dev/input/by-id/usb-Wooting_Wooting_80HE_A02B2436W08T00100S01H02611-if01-event-kbd"
DEFAULT_SERVER = "http://127.0.0.1:8787"

EV_KEY = 0x01
KEY_LEFTCTRL = 29
KEY_RIGHTCTRL = 97
KEY_LEFTALT = 56
KEY_RIGHTALT = 100
KEY_SPACE = 57
KEY_V = 47
WATCHED = {KEY_LEFTCTRL, KEY_RIGHTCTRL, KEY_LEFTALT, KEY_RIGHTALT, KEY_SPACE, KEY_V}
EVENT_STRUCT = struct.Struct("llHHI")

running = True


def log(message: str, **fields) -> None:
    STATE.mkdir(parents=True, exist_ok=True)
    payload = {"at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "message": message, **fields}
    with LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, sort_keys=True) + "\n")


def post(server: str, endpoint: str, *, deliver: bool = True, profile: str = "") -> dict:
    body = json.dumps({"deliver": deliver, "profile": profile}).encode("utf-8")
    req = urllib.request.Request(
        server.rstrip("/") + endpoint,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as res:
            raw = res.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {raw}") from exc


def handle_signal(signum, frame):  # noqa: ARG001
    global running
    running = False


def main() -> int:
    parser = argparse.ArgumentParser(description="Raw Ctrl+Alt PTT listener")
    parser.add_argument("--device", default=os.environ.get("PTT_INPUT_DEVICE", DEFAULT_DEVICE))
    parser.add_argument("--server", default=os.environ.get("PTT_SERVER", DEFAULT_SERVER))
    parser.add_argument("--dry-run", action="store_true", help="Log events but do not call the bridge")
    args = parser.parse_args()

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    pressed: set[int] = set()
    active_profile: str | None = None

    log("starting", device=args.device, server=args.server, dryRun=args.dry_run)
    try:
        fd = os.open(args.device, os.O_RDONLY | os.O_NONBLOCK)
    except PermissionError:
        log("permission-denied", device=args.device)
        print(f"Permission denied reading {args.device}. Run with permission for /dev/input/event*.", file=sys.stderr)
        return 2
    except FileNotFoundError:
        log("device-missing", device=args.device)
        print(f"Input device not found: {args.device}", file=sys.stderr)
        return 2

    def combo_profile() -> str | None:
        ctrl = bool(pressed & {KEY_LEFTCTRL, KEY_RIGHTCTRL})
        alt = bool(pressed & {KEY_LEFTALT, KEY_RIGHTALT})
        if not (ctrl and alt):
            return None
        if KEY_SPACE in pressed:
            return "spotify"
        if KEY_V in pressed:
            return "voice"
        return None

    try:
        while running:
            readable, _, _ = select.select([fd], [], [], 0.5)
            if not readable:
                continue
            try:
                data = os.read(fd, EVENT_STRUCT.size * 64)
            except BlockingIOError:
                continue
            for offset in range(0, len(data) - EVENT_STRUCT.size + 1, EVENT_STRUCT.size):
                _sec, _usec, ev_type, code, value = EVENT_STRUCT.unpack_from(data, offset)
                if ev_type != EV_KEY or code not in WATCHED:
                    continue
                if value in (1, 2):  # key down / repeat
                    pressed.add(code)
                elif value == 0:
                    pressed.discard(code)
                else:
                    continue

                profile = combo_profile()
                if active_profile is None and profile is not None:
                    active_profile = profile
                    log("ptt-start", profile=profile, pressed=sorted(pressed))
                    if not args.dry_run:
                        try:
                            post(args.server, "/api/ptt/start", deliver=(profile == "voice"), profile=profile)
                        except Exception as exc:  # noqa: BLE001
                            log("ptt-start-error", profile=profile, error=str(exc))
                            active_profile = None
                elif active_profile is not None:
                    # Stop when the trigger key is released, or Ctrl/Alt is released.
                    trigger_still_down = (active_profile == "spotify" and KEY_SPACE in pressed) or (active_profile == "voice" and KEY_V in pressed)
                    modifiers_still_down = bool(pressed & {KEY_LEFTCTRL, KEY_RIGHTCTRL}) and bool(pressed & {KEY_LEFTALT, KEY_RIGHTALT})
                    if not trigger_still_down or not modifiers_still_down:
                        profile_to_stop = active_profile
                        active_profile = None
                        log("ptt-stop", profile=profile_to_stop, pressed=sorted(pressed))
                        if not args.dry_run:
                            try:
                                post(args.server, "/api/ptt/stop", deliver=(profile_to_stop == "voice"), profile=profile_to_stop)
                            except Exception as exc:  # noqa: BLE001
                                log("ptt-stop-error", profile=profile_to_stop, error=str(exc))
    finally:
        if active_profile is not None and not args.dry_run:
            try:
                post(args.server, "/api/ptt/stop", deliver=(active_profile == "voice"), profile=active_profile)
            except Exception as exc:  # noqa: BLE001
                log("ptt-final-stop-error", profile=active_profile, error=str(exc))
        os.close(fd)
        log("stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
