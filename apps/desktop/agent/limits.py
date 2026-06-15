"""Limit threshold math (pure, tested) and notification firing.

Two flavours share the `limits` table:
  • limit (limit_type 'soft'/'hard') — a CEILING on a distracting app/domain;
    warns as you approach it (50/80/100%).
  • goal  (limit_type 'goal')        — a FLOOR on productive time (a category);
    celebrates once when you reach 100%.
"""
from __future__ import annotations

import time

from .timeutil import local_day_bounds, local_week_bounds, today_local

THRESHOLDS = (50, 80, 100)


def thresholds_to_fire(limit_secs: int, used_secs: int, already_fired: list[int]) -> list[int]:
    """Which thresholds are newly crossed. Pure function."""
    if limit_secs <= 0 or used_secs <= 0:
        return []
    return [
        pct for pct in THRESHOLDS
        if used_secs * 100 >= limit_secs * pct and pct not in already_fired
    ]


def _notify(title: str, message: str) -> None:
    try:
        from plyer import notification
        notification.notify(title=title, message=message, app_name="FocusLens", timeout=8)
    except Exception as e:
        print(f"[FocusLens] notification failed: {e}")


def _period_window(period: str, date_str: str) -> tuple[int, int, str]:
    """(start, end, dedup_key) for a goal's period — daily keys on the date,
    weekly keys on the Monday so a reached weekly goal fires only once."""
    if period == "weekly":
        return local_week_bounds(date_str)
    start, end = local_day_bounds(date_str)
    return start, end, date_str


def _check_goal(store, goal, date_str, now) -> None:
    start, end, key = _period_window(goal["period"], date_str)
    used = store.goal_used(goal["target_kind"], goal["target_key"], start, end)
    if goal["limit_secs"] <= 0 or used < goal["limit_secs"]:
        return
    if 100 in store.fired_thresholds(goal["id"], key):
        return
    period_word = "weekly" if goal["period"] == "weekly" else "daily"
    title = f"🎯 {goal['target_key']} goal reached!"
    msg = (
        f"{used // 60} min of productive time — your "
        f"{goal['limit_secs'] // 60} min {period_word} goal is done."
    )
    _notify(title, msg)
    store.log_reminder(goal["id"], key, 100, now)


def _check_limit(store, limit, date_str, now) -> None:
    start, end = local_day_bounds(date_str)
    used = store.usage_total(limit["target_kind"], limit["target_key"], start, end)
    fired = store.fired_thresholds(limit["id"], date_str)
    for pct in thresholds_to_fire(limit["limit_secs"], used, fired):
        used_m = used // 60
        limit_m = limit["limit_secs"] // 60
        if pct >= 100:
            title = f"{limit['target_key']}: daily limit reached"
        else:
            title = f"{limit['target_key']}: {pct}% of daily limit"
        msg = f"{used_m} min used of your {limit_m} min daily limit."
        _notify(title, msg)
        store.log_reminder(limit["id"], date_str, pct, now)


def check_and_fire(store) -> None:  # type: ignore[type-arg]
    """Fire notifications for newly-crossed limit thresholds and reached goals."""
    date_str = today_local()
    now = int(time.time())

    for entry in store.list_limits():
        if not entry["enabled"]:
            continue
        if entry["limit_type"] == "goal":
            _check_goal(store, entry, date_str, now)
        elif entry["period"] == "daily":
            _check_limit(store, entry, date_str, now)
