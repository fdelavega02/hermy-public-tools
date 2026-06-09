#!/usr/bin/env python3
"""X11 global hold-to-talk listener for Spotify/OpenClaw PTT.

No root required. Grabs only:
- Ctrl+F2        => spotify profile
- Ctrl+F1        => voice profile
- Ctrl+F3        => hermy-tv profile

Uses XGrabKey directly instead of KDE global shortcuts so KeyPress/KeyRelease are
handled by this process.
"""
from __future__ import annotations

import argparse
import ctypes
import ctypes.util
import json
import os
import signal
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / "state"
LOG = STATE / "x11-ptt-listener.log"
DEFAULT_SERVER = "http://127.0.0.1:8787"

KeyPress = 2
KeyRelease = 3
ControlMask = 1 << 2
Mod1Mask = 1 << 3  # Alt on normal X11 layouts
LockMask = 1 << 1
Mod2Mask = 1 << 4  # NumLock on many layouts
GrabModeAsync = 1
CurrentTime = 0
True_ = 1
False_ = 0
XK_F1 = 0xFFBE
XK_F2 = 0xFFBF
XK_F3 = 0xFFC0

running = True
active_profile: str | None = None


class XKeyEvent(ctypes.Structure):
    _fields_ = [
        ("type", ctypes.c_int),
        ("serial", ctypes.c_ulong),
        ("send_event", ctypes.c_int),
        ("display", ctypes.c_void_p),
        ("window", ctypes.c_ulong),
        ("root", ctypes.c_ulong),
        ("subwindow", ctypes.c_ulong),
        ("time", ctypes.c_ulong),
        ("x", ctypes.c_int),
        ("y", ctypes.c_int),
        ("x_root", ctypes.c_int),
        ("y_root", ctypes.c_int),
        ("state", ctypes.c_uint),
        ("keycode", ctypes.c_uint),
        ("same_screen", ctypes.c_int),
    ]


class XEvent(ctypes.Union):
    _fields_ = [("type", ctypes.c_int), ("xkey", XKeyEvent), ("pad", ctypes.c_long * 24)]


XErrorHandler = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)


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
        with urllib.request.urlopen(req, timeout=60) as res:
            raw = res.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {raw}") from exc


def post_background(server: str, endpoint: str, *, deliver: bool = True, profile: str = "") -> None:
    def worker() -> None:
        try:
            post(server, endpoint, deliver=deliver, profile=profile)
            log("ptt-request-ok", endpoint=endpoint, profile=profile)
        except Exception as exc:  # noqa: BLE001
            log("ptt-request-error", endpoint=endpoint, profile=profile, error=str(exc))

    threading.Thread(target=worker, daemon=True).start()


def handle_signal(signum, frame):  # noqa: ARG001
    global running
    log("signal", signum=signum)
    running = False


def main() -> int:
    global active_profile
    parser = argparse.ArgumentParser(description="X11 Ctrl+Alt hold-to-talk listener")
    parser.add_argument("--server", default=os.environ.get("PTT_SERVER", DEFAULT_SERVER))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    libname = ctypes.util.find_library("X11")
    if not libname:
        print("libX11 not found", file=sys.stderr)
        return 2
    x11 = ctypes.CDLL(libname)
    x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
    x11.XDefaultRootWindow.restype = ctypes.c_ulong
    x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    x11.XKeysymToKeycode.restype = ctypes.c_uint
    x11.XGrabKey.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_uint, ctypes.c_ulong, ctypes.c_int, ctypes.c_int, ctypes.c_int]
    x11.XUngrabKey.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_uint, ctypes.c_ulong]
    x11.XFlush.argtypes = [ctypes.c_void_p]
    x11.XSetErrorHandler.argtypes = [XErrorHandler]
    x11.XSetErrorHandler.restype = XErrorHandler
    x11.XNextEvent.argtypes = [ctypes.c_void_p, ctypes.POINTER(XEvent)]
    x11.XQueryKeymap.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
    x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
    try:
        x11.XkbSetDetectableAutoRepeat.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ctypes.c_int)]
        x11.XkbSetDetectableAutoRepeat.restype = ctypes.c_int
    except AttributeError:
        pass

    display = x11.XOpenDisplay(None)
    if not display:
        log("display-open-failed", display=os.environ.get("DISPLAY"), xauthority=os.environ.get("XAUTHORITY"))
        print("Could not open X display. Check DISPLAY/XAUTHORITY.", file=sys.stderr)
        return 2

    root = x11.XDefaultRootWindow(display)
    f1_keycode = int(x11.XKeysymToKeycode(display, XK_F1))
    f2_keycode = int(x11.XKeysymToKeycode(display, XK_F2))
    f3_keycode = int(x11.XKeysymToKeycode(display, XK_F3))
    keycodes = {
        f2_keycode: "spotify",
        f1_keycode: "voice",
        f3_keycode: "hermy-tv",
    }
    profile_mods = {
        "spotify": ControlMask,
        "voice": ControlMask,
        "hermy-tv": ControlMask,
    }
    lock_variants = [0, LockMask, Mod2Mask, LockMask | Mod2Mask]

    @XErrorHandler
    def error_handler(_display, _error):  # noqa: ANN001
        return 0

    x11.XSetErrorHandler(error_handler)

    detectable_supported = ctypes.c_int(0)
    if hasattr(x11, "XkbSetDetectableAutoRepeat"):
        try:
            x11.XkbSetDetectableAutoRepeat(display, True_, ctypes.byref(detectable_supported))
            log("detectable-autorepeat", supported=bool(detectable_supported.value))
        except Exception as exc:  # noqa: BLE001
            log("detectable-autorepeat-error", error=str(exc))

    for keycode, profile in keycodes.items():
        base_mods = profile_mods[profile]
        for extra in lock_variants:
            x11.XGrabKey(display, keycode, base_mods | extra, root, True_, GrabModeAsync, GrabModeAsync)
    x11.XFlush(display)
    log("started", server=args.server, dryRun=args.dry_run, keycodes=keycodes)

    def key_is_down(keycode: int) -> bool:
        keys = ctypes.create_string_buffer(32)
        x11.XQueryKeymap(display, keys)
        byte = keys.raw[keycode // 8]
        return bool(byte & (1 << (keycode % 8)))

    try:
        while running:
            event = XEvent()
            x11.XNextEvent(display, ctypes.byref(event))
            if event.type not in (KeyPress, KeyRelease):
                continue
            keycode = int(event.xkey.keycode)
            profile = keycodes.get(keycode)
            if not profile:
                continue
            if event.type == KeyPress and active_profile is None:
                active_profile = profile
                chord = {
                    "voice": "ctrl+f1",
                    "spotify": "ctrl+f2",
                    "hermy-tv": "ctrl+f3",
                }.get(profile, profile)
                log("ptt-start", profile=profile, keycode=keycode, state=int(event.xkey.state), chord=chord)
                if not args.dry_run:
                    try:
                        post(args.server, "/api/ptt/start", deliver=(profile != "spotify"), profile=profile)
                        log("ptt-request-ok", endpoint="/api/ptt/start", profile=profile)
                    except Exception as exc:  # noqa: BLE001
                        log("ptt-request-error", endpoint="/api/ptt/start", profile=profile, error=str(exc))
                        active_profile = None
            elif event.type == KeyRelease and active_profile == profile:
                # X11 key repeat can emit fake release/press pairs while the key is still held.
                # If the trigger key is physically still down, ignore this release so PTT does
                # not chop one spoken command into many tiny clips.
                time.sleep(0.03)
                if key_is_down(keycode):
                    log("ptt-release-ignored-autorepeat", profile=profile, keycode=keycode, state=int(event.xkey.state))
                    continue
                active_profile = None
                log("ptt-stop", profile=profile, keycode=keycode, state=int(event.xkey.state))
                if not args.dry_run:
                    post_background(args.server, "/api/ptt/stop", deliver=(profile != "spotify"), profile=profile)
    except BaseException as exc:  # noqa: BLE001
        log("fatal", error=repr(exc))
        raise
    finally:
        if active_profile is not None and not args.dry_run:
            post_background(args.server, "/api/ptt/stop", deliver=(active_profile != "spotify"), profile=active_profile)
        for keycode, profile in keycodes.items():
            base_mods = profile_mods[profile]
            for extra in lock_variants:
                x11.XUngrabKey(display, keycode, base_mods | extra, root)
        x11.XFlush(display)
        x11.XCloseDisplay(display)
        log("stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
