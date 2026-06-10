"""OS-level probes for active window and idle time.

Windows: pywin32 + psutil.
macOS: subprocess + Quartz (compile-gated, not tested on this machine).
"""
from __future__ import annotations

import sys
from typing import Optional


def get_active_window() -> tuple[Optional[str], Optional[str]]:
    """Return (app_key, app_name) for the foreground window, or (None, None)."""
    if sys.platform == "win32":
        return _win_active_window()
    return None, None


def get_idle_seconds() -> float:
    """Seconds since the last user input event (keyboard or mouse)."""
    if sys.platform == "win32":
        return _win_idle_seconds()
    return 0.0


# ---- Windows ---------------------------------------------------------------

def _win_active_window() -> tuple[Optional[str], Optional[str]]:
    try:
        import win32gui
        import win32process
        import psutil

        hwnd = win32gui.GetForegroundWindow()
        if not hwnd:
            return None, None
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        proc = psutil.Process(pid)
        exe = proc.name().lower()
        title = win32gui.GetWindowText(hwnd) or exe
        return exe, title
    except Exception:
        return None, None


def _win_idle_seconds() -> float:
    try:
        import win32api

        last = win32api.GetLastInputInfo()
        now = win32api.GetTickCount()
        return max(0.0, (now - last) / 1000.0)
    except Exception:
        return 0.0
