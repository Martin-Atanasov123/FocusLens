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


def local_week_bounds(date_str: str) -> tuple[int, int, str]:
    """[start, end) unix-second bounds for the ISO week (Mon–Sun) containing
    date_str, plus that Monday's date string (used as the per-week dedup key)."""
    d = date.fromisoformat(date_str)
    monday = d - timedelta(days=d.weekday())
    start = _midnight_ts(monday)
    end = _midnight_ts(monday + timedelta(days=7))
    return start, end, monday.isoformat()


def _midnight_ts(d: date) -> int:
    dt = datetime(d.year, d.month, d.day, tzinfo=None)
    # mktime treats naive datetime as local time
    return int(time.mktime(dt.timetuple()))
