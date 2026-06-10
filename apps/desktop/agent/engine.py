"""Pure tracking state machine — no OS or DB access, fully unit-testable."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

BUCKET_SECS = 60


@dataclass
class Sample:
    ts: int  # unix epoch seconds
    app_key: Optional[str]  # e.g. "chrome.exe"; None when no foreground window
    app_name: Optional[str]  # human-readable, e.g. "Google Chrome"
    idle_secs: float  # seconds since last user input


@dataclass
class UsageRecord:
    bucket_ts: int
    key: str
    label: str
    active_secs: int
    idle_secs: int


class Engine:
    """
    Accumulates 1-second samples into 1-minute per-app buckets and emits
    completed buckets when a new minute arrives.
    """

    def __init__(self, idle_threshold_secs: float = 60.0) -> None:
        self.idle_threshold = idle_threshold_secs
        # key: (bucket_ts, app_key) → {"label": str, "active": int, "idle": int}
        self._pending: dict[tuple[int, str], dict] = {}

    @staticmethod
    def bucket_of(ts: int | float) -> int:
        return int(ts // BUCKET_SECS) * BUCKET_SECS

    def on_sample(self, sample: Sample) -> list[UsageRecord]:
        """Feed one sample. Returns any fully-completed minute buckets."""
        bucket = self.bucket_of(sample.ts)
        flushed = self._flush_before(bucket)

        if sample.app_key:
            key = (bucket, sample.app_key)
            acc = self._pending.setdefault(
                key,
                {"label": sample.app_name or sample.app_key, "active": 0, "idle": 0},
            )
            if not acc["label"]:
                acc["label"] = sample.app_name or sample.app_key
            if sample.idle_secs >= self.idle_threshold:
                acc["idle"] += 1
            else:
                acc["active"] += 1

        return flushed

    def _flush_before(self, cutoff: int | float) -> list[UsageRecord]:
        keys = sorted(k for k in self._pending if k[0] < cutoff)
        records = []
        for k in keys:
            acc = self._pending.pop(k)
            records.append(
                UsageRecord(
                    bucket_ts=k[0],
                    key=k[1],
                    label=acc["label"],
                    active_secs=acc["active"],
                    idle_secs=acc["idle"],
                )
            )
        return records

    def flush_all(self) -> list[UsageRecord]:
        """Emit everything still pending (shutdown / pause)."""
        return self._flush_before(math.inf)
