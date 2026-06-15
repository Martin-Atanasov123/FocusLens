"""FocusLens entry point.

Usage:
    python run.py
"""
from __future__ import annotations

import sys
import threading
import webbrowser
from pathlib import Path

# Locate the app data directory.
if sys.platform == "win32":
    import os
    DATA_DIR = Path(os.getenv("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "FocusLens"
else:
    DATA_DIR = Path.home() / ".local" / "share" / "FocusLens"

PORT = 48732

# ---- Windows autostart (Run key) -------------------------------------------
_RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
_RUN_NAME = "FocusLens"


def _autostart_target() -> str | None:
    """Command to launch on login. Only meaningful for the packaged .exe;
    autostart from a source checkout is skipped (fragile cwd/imports)."""
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}"'
    return None


def is_autostart_enabled() -> bool:
    if sys.platform != "win32":
        return False
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY) as k:
            winreg.QueryValueEx(k, _RUN_NAME)
        return True
    except OSError:
        return False


def set_autostart(enable: bool) -> None:
    if sys.platform != "win32":
        return
    target = _autostart_target()
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
            if enable and target:
                winreg.SetValueEx(k, _RUN_NAME, 0, winreg.REG_SZ, target)
            else:
                try:
                    winreg.DeleteValue(k, _RUN_NAME)
                except FileNotFoundError:
                    pass
    except OSError as e:
        print(f"[FocusLens] autostart change failed: {e}")


# ---- Windows firewall (let the phone reach the agent over the LAN) ----------
_FW_RULE = "FocusLens"
# Scoped to the local subnet so only devices on your own Wi-Fi/LAN can connect.
_FW_ARGS = (
    f'advfirewall firewall add rule name="{_FW_RULE}" dir=in action=allow '
    f"protocol=TCP localport={PORT} profile=private remoteip=localsubnet"
)


def firewall_rule_exists() -> bool:
    if sys.platform != "win32":
        return True
    import subprocess
    try:
        out = subprocess.run(
            ["netsh", "advfirewall", "firewall", "show", "rule", f"name={_FW_RULE}"],
            capture_output=True, text=True, timeout=5,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return _FW_RULE in out.stdout
    except Exception:
        return False


def ensure_firewall_rule() -> None:
    """Add the inbound LAN rule via a single elevated netsh call (one UAC
    prompt). No-op if the rule already exists or we're not on Windows."""
    if sys.platform != "win32" or firewall_rule_exists():
        return
    try:
        import ctypes
        # "runas" shows the UAC consent dialog; netsh then adds the rule.
        ctypes.windll.shell32.ShellExecuteW(None, "runas", "netsh", _FW_ARGS, None, 0)
    except Exception as e:
        print(f"[FocusLens] firewall auto-add failed: {e}")


def _build_icon():
    """Create a simple indigo disc + ring icon with Pillow."""
    from PIL import Image, ImageDraw
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    c = size // 2
    draw.ellipse([2, 2, size - 2, size - 2], fill=(49, 46, 129, 255))
    draw.ellipse([14, 14, size - 14, size - 14], outline=(165, 180, 252, 255), width=5)
    draw.ellipse([c - 6, c - 6, c + 6, c + 6], fill=(224, 231, 255, 255))
    return img


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    from agent.store import Store
    from agent.server import create_app
    from agent.sampler import Sampler
    from agent.limits import check_and_fire
    from agent.tunnel import Tunnel

    store = Store(DATA_DIR / "focuslens.db")
    is_paused = threading.Event()
    tunnel = Tunnel(port=PORT)

    # ---- Flask thread -------------------------------------------------------
    flask_app = create_app(store, is_paused, port=PORT, tunnel=tunnel)

    def run_flask():
        import logging
        log = logging.getLogger("werkzeug")
        log.setLevel(logging.ERROR)
        flask_app.run(host="0.0.0.0", port=PORT, debug=False, use_reloader=False)

    flask_thread = threading.Thread(target=run_flask, daemon=True, name="focuslens-server")
    flask_thread.start()

    # ---- Sampler thread -----------------------------------------------------
    def on_flush(records):
        store.upsert_usage("desktop", "app", records)
        check_and_fire(store)

    sampler = Sampler(
        store=store,
        is_paused=is_paused,
        on_flush=on_flush,
        idle_threshold_secs=store.idle_threshold_secs(),
    )
    sampler_thread = threading.Thread(target=sampler.run, daemon=True, name="focuslens-sampler")
    sampler_thread.start()

    # ---- Tray (main thread) -------------------------------------------------
    import pystray

    icon_image = _build_icon()

    def open_dashboard(icon, item):
        webbrowser.open(f"http://127.0.0.1:{PORT}/")

    def toggle_pause(icon, item):
        if is_paused.is_set():
            is_paused.clear()
        else:
            is_paused.set()

    def toggle_remote(icon, item):
        if tunnel.running:
            tunnel.stop()
            store.set_setting("remote_enabled", "0")
            print("[FocusLens] remote access disabled")
        else:
            store.set_setting("remote_enabled", "1")
            try:
                url = tunnel.start()
                print(f"[FocusLens] remote access enabled — {url}")
            except Exception as e:
                print(f"[FocusLens] could not enable remote access: {e}")

    def toggle_autostart(icon, item):
        set_autostart(not is_autostart_enabled())

    def allow_phone(icon, item):
        ensure_firewall_rule()

    def quit_app(icon, item):
        tunnel.stop()
        icon.stop()
        sys.exit(0)

    menu = pystray.Menu(
        pystray.MenuItem("Open Dashboard", open_dashboard, default=True),
        pystray.MenuItem(
            "Pause Tracking",
            toggle_pause,
            checked=lambda item: is_paused.is_set(),
        ),
        pystray.MenuItem(
            "Remote access (anywhere)",
            toggle_remote,
            checked=lambda item: tunnel.running,
        ),
        pystray.MenuItem(
            "Start with Windows",
            toggle_autostart,
            checked=lambda item: is_autostart_enabled(),
        ),
        pystray.MenuItem("Allow phone on network…", allow_phone),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Quit FocusLens", quit_app),
    )

    tray = pystray.Icon("FocusLens", icon_image, "FocusLens", menu)
    print(f"[FocusLens] running — dashboard at http://127.0.0.1:{PORT}/")

    # First run: open the dashboard so a double-clicked .exe shows something
    # immediately instead of silently sitting in the tray.
    if store.get_setting("first_run_done") is None:
        store.set_setting("first_run_done", "1")
        threading.Timer(1.2, lambda: webbrowser.open(f"http://127.0.0.1:{PORT}/")).start()

    # Register the packaged exe to start with Windows so tracking is always on.
    # Tracked separately from first_run so existing installs get it once too;
    # the user can still turn it off via the "Start with Windows" tray toggle.
    if getattr(sys, "frozen", False) and store.get_setting("autostart_init") is None:
        store.set_setting("autostart_init", "1")
        set_autostart(True)

    # Open the LAN firewall once (single UAC prompt) so the phone companion can
    # reach the agent without the user running allow-phone-access.bat by hand.
    # Retryable any time from the tray ("Allow phone on network…").
    if getattr(sys, "frozen", False) and store.get_setting("firewall_init") is None:
        store.set_setting("firewall_init", "1")
        ensure_firewall_rule()

    # Remote access defaults on (opt-out via the tray). Start the tunnel in the
    # background — the cloudflared handshake can take ~20s and must not block the
    # tray. The phone re-reads the (ephemeral) tunnel URL from /api/network-info
    # while on the LAN, so a changing trycloudflare address self-heals.
    if store.get_setting("remote_init") is None:
        store.set_setting("remote_init", "1")
        store.set_setting("remote_enabled", "1")

    def _auto_start_tunnel():
        try:
            url = tunnel.start()
            print(f"[FocusLens] remote access enabled — {url}")
        except Exception as e:
            print(f"[FocusLens] could not enable remote access: {e}")

    if store.get_setting("remote_enabled") == "1":
        threading.Thread(target=_auto_start_tunnel, daemon=True,
                         name="focuslens-tunnel-auto").start()

    tray.run()


if __name__ == "__main__":
    main()
