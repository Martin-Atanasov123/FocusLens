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
        flask_app.run(host="127.0.0.1", port=PORT, debug=False, use_reloader=False)

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
            print("[FocusLens] remote access disabled")
        else:
            try:
                url = tunnel.start()
                print(f"[FocusLens] remote access enabled — {url}")
            except Exception as e:
                print(f"[FocusLens] could not enable remote access: {e}")

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

    tray.run()


if __name__ == "__main__":
    main()
