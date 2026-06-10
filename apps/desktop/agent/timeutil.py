"""Local-time day boundary helpers."""
from __future__ import annotations

import time
from datetime import date, datetime, timedelta, timezone


def today_local() -> str:
    """Today's local date as YYYY-MM-DD."""
    return date.today().isoformat()


def local_day_bounds(date_str: str) -> tuple[int, int]:
    """
    [start, end) unix-second bounds for a local calendar date (YYYY-MM-DD).
    Raises ValueError on bad input.
    """
    d = date.fromisoformat(date_str)
    start = _midnight_ts(d)
    end = _midnight_ts(d + timedelta(days=1))
    return start, end


def _midnight_ts(d: date) -> int:
    dt = datetime(d.year, d.month, d.day, tzinfo=None)
    # mktime treats naive datetime as local time
    return int(time.mktime(dt.timetuple()))
