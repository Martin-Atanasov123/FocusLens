"""Optional remote access via an embedded Cloudflare Tunnel.

When enabled, launches a bundled (or PATH) `cloudflared` quick tunnel pointed
at the local agent, giving the phone a public HTTPS URL that works from any
network — no extra app on the phone. Disabled by default; the dashboard API is
token-guarded for any request that arrives through the tunnel (see server.py).

cloudflared is NOT bundled by pip; it's a single static binary. If missing,
start() raises FileNotFoundError with a download hint.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
import threading
from pathlib import Path

_URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")


def _find_cloudflared() -> str | None:
    # 1) next to the (frozen) executable / project root
    candidates = []
    if getattr(sys, "frozen", False):
        candidates.append(Path(sys.executable).parent / "cloudflared.exe")
    here = Path(__file__).parent.parent
    candidates += [
        here / "cloudflared.exe",
        here / "cloudflared",
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    # 2) on PATH
    return shutil.which("cloudflared")


class Tunnel:
    """Manages the cloudflared subprocess and exposes its public URL."""

    def __init__(self, port: int = 48732):
        self.port = port
        self.url: str | None = None
        self._proc: subprocess.Popen | None = None
        self._ready = threading.Event()

    @property
    def running(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def start(self, timeout: float = 25.0) -> str:
        """Start the tunnel and block until the public URL is known."""
        if self.running and self.url:
            return self.url

        exe = _find_cloudflared()
        if not exe:
            raise FileNotFoundError(
                "cloudflared not found. Download the single binary from "
                "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ "
                "and place it next to FocusLens (or on PATH)."
            )

        # quick tunnel — no account, no config, ephemeral URL
        flags = 0
        if sys.platform == "win32":
            flags = subprocess.CREATE_NO_WINDOW  # type: ignore[attr-defined]

        self._proc = subprocess.Popen(
            [exe, "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{self.port}"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            creationflags=flags,
        )

        threading.Thread(target=self._read_output, daemon=True, name="cf-tunnel").start()
        if not self._ready.wait(timeout):
            self.stop()
            raise TimeoutError("cloudflared did not report a public URL in time")
        return self.url  # type: ignore[return-value]

    def _read_output(self) -> None:
        assert self._proc and self._proc.stdout
        for line in self._proc.stdout:
            if self.url is None:
                m = _URL_RE.search(line)
                if m:
                    self.url = m.group(0)
                    self._ready.set()

    def stop(self) -> None:
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._proc.kill()
        self._proc = None
        self.url = None
        self._ready.clear()
