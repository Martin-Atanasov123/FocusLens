"""1 Hz sampling thread: probe → engine → store → limit checks."""
from __future__ import annotations

import time
import threading
from typing import Callable

from .engine import Engine, Sample
from .probe import get_active_window, get_idle_seconds

RETENTION_SWEEP_EVERY = 3600  # seconds


class Sampler:
    def __init__(
        self,
        store,
        is_paused: threading.Event,
        on_flush: Callable,
        idle_threshold_secs: float = 60.0,
    ) -> None:
        self._store = store
        self._is_paused = is_paused
        self._on_flush = on_flush
        self._engine = Engine(idle_threshold_secs)
        self._ticks = 0

    def run(self) -> None:
        while True:
            time.sleep(1)
            self._ticks += 1
            now = int(time.time())

            if self._is_paused.is_set():
                sample = Sample(ts=now, app_key=None, app_name=None, idle_secs=0)
            else:
                app_key, app_name = get_active_window()
                idle_secs = get_idle_seconds()
                sample = Sample(ts=now, app_key=app_key, app_name=app_name, idle_secs=idle_secs)

            flushed = self._engine.on_sample(sample)
            if flushed:
                self._on_flush(flushed)

            if self._ticks % RETENTION_SWEEP_EVERY == 0:
                removed = self._store.apply_retention(now)
                if removed:
                    print(f"[FocusLens] retention sweep removed {removed} rows")
