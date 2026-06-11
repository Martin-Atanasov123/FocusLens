# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for FocusLens Windows .exe
# Build: pyinstaller focuslens.spec --noconfirm

from pathlib import Path
import sys

block_cipher = None

ROOT = Path(SPECPATH)
DASHBOARD = ROOT / "dashboard"

# Bundle cloudflared (for "Remote access (anywhere)") if it sits next to the
# spec. Drop cloudflared.exe in apps/desktop/ before building to include it.
_cf = ROOT / "cloudflared.exe"
_binaries = [(str(_cf), ".")] if _cf.exists() else []

a = Analysis(
    ["run.py"],
    pathex=[str(ROOT)],
    binaries=_binaries,
    datas=[
        (str(DASHBOARD / "index.html"),  "dashboard"),
        (str(DASHBOARD / "mobile.html"), "dashboard"),
        (str(DASHBOARD / "manifest.json"), "dashboard"),
    ],
    hiddenimports=[
        "pystray._win32",
        "win32gui",
        "win32process",
        "win32con",
        "win32api",
        "psutil",
        "flask",
        "flask.json.provider",
        "jinja2",
        "werkzeug",
        "sqlite3",
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "numpy", "PIL.ImageTk"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="FocusLens",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,          # no console window — runs silently in tray
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,              # replace with "focuslens.ico" once you have one
)
