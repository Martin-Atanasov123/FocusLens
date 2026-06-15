"""Tests for limit threshold math (pure) and check_and_fire integration."""
import pytest
from unittest.mock import patch, call
from agent.limits import thresholds_to_fire, check_and_fire, THRESHOLDS
from agent.store import Store


class TestThresholdsToFire:
    def test_no_usage_returns_empty(self):
        assert thresholds_to_fire(3600, 0, []) == []

    def test_zero_limit_returns_empty(self):
        assert thresholds_to_fire(0, 1800, []) == []

    def test_under_50_pct(self):
        assert thresholds_to_fire(3600, 1700, []) == []

    def test_exactly_50_pct(self):
        result = thresholds_to_fire(3600, 1800, [])
        assert 50 in result
        assert 80 not in result
        assert 100 not in result

    def test_exactly_80_pct(self):
        result = thresholds_to_fire(3600, 2880, [])
        assert 50 in result
        assert 80 in result
        assert 100 not in result

    def test_exactly_100_pct(self):
        result = thresholds_to_fire(3600, 3600, [])
        assert result == [50, 80, 100]

    def test_over_100_pct(self):
        result = thresholds_to_fire(3600, 7200, [])
        assert result == [50, 80, 100]

    def test_skips_already_fired(self):
        result = thresholds_to_fire(3600, 3600, [50, 80])
        assert result == [100]

    def test_all_fired_returns_empty(self):
        assert thresholds_to_fire(3600, 3600, [50, 80, 100]) == []

    def test_dedup_is_set_based(self):
        result = thresholds_to_fire(3600, 3600, [50, 80, 100, 50])
        assert result == []

    def test_fire_order(self):
        result = thresholds_to_fire(100, 100, [])
        assert result == list(THRESHOLDS)


class TestCheckAndFire:
    def _store_with_limit(self, key="youtube.com", secs=3600, enabled=True):
        store = Store(":memory:")
        store.upsert_limit({
            "target_kind": "domain", "target_key": key,
            "period": "daily", "limit_secs": secs,
            "limit_type": "soft", "enabled": enabled,
        })
        return store

    def test_no_limits_no_notifications(self):
        store = Store(":memory:")
        with patch("agent.limits._notify") as mock_notify:
            check_and_fire(store)
            mock_notify.assert_not_called()

    def test_disabled_limit_no_notification(self):
        store = self._store_with_limit(enabled=False)
        with patch("agent.limits._notify") as mock_notify:
            check_and_fire(store)
            mock_notify.assert_not_called()

    def test_under_threshold_no_notification(self):
        store = self._store_with_limit(secs=3600)
        with patch("agent.limits._notify") as mock_notify:
            check_and_fire(store)
            mock_notify.assert_not_called()

    def test_fires_at_50_pct(self):
        store = self._store_with_limit(secs=3600)
        # Insert 30 minutes of usage today
        from agent.timeutil import today_local, local_day_bounds
        from agent.engine import UsageRecord
        date_str = today_local()
        start, _ = local_day_bounds(date_str)
        records = [UsageRecord(bucket_ts=start, key="youtube.com", label="YouTube",
                               active_secs=1800, idle_secs=0)]
        store.upsert_usage("extension", "domain", records)
        with patch("agent.limits._notify") as mock_notify:
            check_and_fire(store)
            assert mock_notify.call_count == 1
            title, _ = mock_notify.call_args[0]
            assert "50%" in title or "youtube.com" in title

    def test_does_not_double_fire(self):
        store = self._store_with_limit(secs=3600)
        from agent.timeutil import today_local, local_day_bounds
        from agent.engine import UsageRecord
        import time
        date_str = today_local()
        start, _ = local_day_bounds(date_str)
        records = [UsageRecord(bucket_ts=start, key="youtube.com", label="YouTube",
                               active_secs=1800, idle_secs=0)]
        store.upsert_usage("extension", "domain", records)
        with patch("agent.limits._notify") as mock_notify:
            check_and_fire(store)
            assert mock_notify.call_count == 1
            check_and_fire(store)  # second call — already fired
            assert mock_notify.call_count == 1  # no new calls

    def test_fires_100_pct_message(self):
        store = self._store_with_limit(secs=3600)
        from agent.timeutil import today_local, local_day_bounds
        from agent.engine import UsageRecord
        date_str = today_local()
        start, _ = local_day_bounds(date_str)
        records = [UsageRecord(bucket_ts=start, key="youtube.com", label="YouTube",
                               active_secs=3600, idle_secs=0)]
        store.upsert_usage("extension", "domain", records)
        with patch("agent.limits._notify") as mock_notify:
            check_and_fire(store)
            assert mock_notify.call_count == 3  # 50, 80, 100
            titles = [c[0][0] for c in mock_notify.call_args_list]
            assert any("limit reached" in t for t in titles)


class TestGoals:
    """Goals are productive-time floors: celebrate once on reach, never warn."""

    def _store_with_goal(self, secs=3600, period="daily", enabled=True):
        store = Store(":memory:")
        store.upsert_limit({
            "target_kind": "category", "target_key": "Productive",
            "period": period, "limit_secs": secs,
            "limit_type": "goal", "enabled": enabled,
        })
        return store

    def _add_productive(self, store, secs, bucket_ts):
        from agent.engine import UsageRecord
        store.upsert_usage("desktop", "app", [
            UsageRecord(bucket_ts=bucket_ts, key="Code.exe",
                        label="Visual Studio Code", active_secs=secs, idle_secs=0)
        ])

    def test_goal_not_reached_no_notification(self):
        store = self._store_with_goal(secs=3600)
        from agent.timeutil import today_local, local_day_bounds
        start, _ = local_day_bounds(today_local())
        self._add_productive(store, 1800, start)  # only 30 of 60 min
        with patch("agent.limits._notify") as m:
            check_and_fire(store)
            m.assert_not_called()

    def test_daily_goal_reached_fires_once(self):
        store = self._store_with_goal(secs=3600)
        from agent.timeutil import today_local, local_day_bounds
        start, _ = local_day_bounds(today_local())
        self._add_productive(store, 3600, start)
        with patch("agent.limits._notify") as m:
            check_and_fire(store)
            assert m.call_count == 1
            title, _msg = m.call_args[0]
            assert "goal reached" in title.lower()
            check_and_fire(store)               # already celebrated
            assert m.call_count == 1            # no double-fire

    def test_weekly_goal_uses_week_window(self):
        store = self._store_with_goal(secs=7200, period="weekly")
        from agent.timeutil import today_local, local_week_bounds
        wk_start, _, _ = local_week_bounds(today_local())
        self._add_productive(store, 7200, wk_start)  # 2h earlier this week
        with patch("agent.limits._notify") as m:
            check_and_fire(store)
            assert m.call_count == 1
            assert "weekly" in m.call_args[0][1].lower()

    def test_disabled_goal_no_notification(self):
        store = self._store_with_goal(enabled=False)
        from agent.timeutil import today_local, local_day_bounds
        start, _ = local_day_bounds(today_local())
        self._add_productive(store, 7200, start)
        with patch("agent.limits._notify") as m:
            check_and_fire(store)
            m.assert_not_called()
