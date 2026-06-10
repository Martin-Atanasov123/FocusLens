"""Limit threshold math (pure, tested) and notification firing."""
from __future__ import annotations

import time

from .timeutil import local_day_bounds, today_local

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


def check_and_fire(store) -> None:  # type: ignore[type-arg]
    """Evaluate all enabled daily limits and fire notifications for new threshold crossings."""
    date_str = today_local()
    start, end = local_day_bounds(date_str)
    now = int(time.time())

    for limit in store.list_limits():
        if not limit["enabled"] or limit["period"] != "daily":
            continue
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
