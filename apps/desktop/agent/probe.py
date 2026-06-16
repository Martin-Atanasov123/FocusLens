"""OS-level probes for active window and idle time.

Windows: pywin32 + psutil, with WMI fallback for admin/elevated processes
(same 3-tier strategy as ActivityWatch aw-watcher-window/lib.py).
macOS: subprocess + Quartz (compile-gated, not tested on this machine).
"""
from __future__ import annotations

import os
import sys
from typing import Optional

# WMI is initialized once (expensive COM setup) so repeated queries are fast.
_wmi_conn = None
_wmi_tried = False


def _get_wmi():
    global _wmi_conn, _wmi_tried
    if _wmi_tried:
        return _wmi_conn
    _wmi_tried = True
    try:
        import wmi
        _wmi_conn = wmi.WMI()
    except Exception:
        _wmi_conn = None
    return _wmi_conn


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

        hwnd = win32gui.GetForegroundWindow()
        if not hwnd:
            # No foreground window: UAC prompt, lock screen, secure desktop.
            return None, None

        title = win32gui.GetWindowText(hwnd) or None
        _, pid = win32process.GetWindowThreadProcessId(hwnd)

        # Tier 1: psutil — fast, works for the vast majority of user processes.
        try:
            import psutil
            exe = psutil.Process(pid).name().lower()
            return exe, title or exe
        except Exception:
            pass

        # Tier 2: GetModuleFileNameEx — sometimes succeeds for processes that
        # block psutil (e.g. partially elevated processes).
        try:
            import win32api
            h = win32api.OpenProcess(0x0410, False, pid)  # QUERY_INFORMATION | VM_READ
            try:
                path = win32process.GetModuleFileNameEx(h, 0)
                exe = os.path.basename(path).lower()
                return exe, title or exe
            finally:
                win32api.CloseHandle(h)
        except Exception:
            pass

        # Tier 3: WMI — handles fully-elevated admin processes (games with
        # anti-cheat, antivirus, some system tools). Queries are ~10 ms each
        # because _wmi_conn is reused across calls.
        try:
            c = _get_wmi()
            if c is not None:
                for p in c.query(
                    "SELECT Name FROM Win32_Process WHERE ProcessId = %d" % pid
                ):
                    exe = p.Name.lower()
                    return exe, title or exe
        except Exception:
            pass

        # All tiers failed (e.g. process died between hwnd lookup and query,
        # or this is a kernel-only window). Skip the sample.
        return None, None

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
