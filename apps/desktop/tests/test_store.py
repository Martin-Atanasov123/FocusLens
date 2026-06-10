"""Tests for the SQLite Store."""
import time
import pytest
from agent.store import Store
from agent.engine import UsageRecord

T0 = (1_700_000_000 // 60) * 60  # minute-aligned unix timestamp

TODAY = "2023-11-14"  # matches T0 in UTC+2; we use fixed start/end to avoid tz issues


def make_record(bucket_ts, key="chrome.exe", label="Chrome", active=30, idle=0):
    return UsageRecord(bucket_ts=bucket_ts, key=key, label=label, active_secs=active, idle_secs=idle)


@pytest.fixture
def store():
    return Store(":memory:")


class TestSettings:
    def test_pairing_token_created_on_init(self, store):
        token = store.get_setting("pairing_token")
        assert token is not None and len(token) > 10

    def test_set_and_get_setting(self, store):
        store.set_setting("foo", "bar")
        assert store.get_setting("foo") == "bar"

    def test_overwrite_setting(self, store):
        store.set_setting("foo", "bar")
        store.set_setting("foo", "baz")
        assert store.get_setting("foo") == "baz"

    def test_missing_setting_returns_none(self, store):
        assert store.get_setting("nonexistent") is None

    def test_retention_days_default(self, store):
        assert store.retention_days() == 90

    def test_idle_threshold_default(self, store):
        assert store.idle_threshold_secs() == 60.0


class TestUpsertUsage:
    def test_insert_and_accumulate(self, store):
        r = make_record(T0, active=20)
        store.upsert_usage("desktop", "app", [r])
        store.upsert_usage("desktop", "app", [make_record(T0, active=15)])
        total = store.usage_total("app", "chrome.exe", T0, T0 + 86400)
        assert total == 35

    def test_different_sources_separate(self, store):
        store.upsert_usage("desktop", "app", [make_record(T0, active=10)])
        store.upsert_usage("extension", "app", [make_record(T0, active=20)])
        # usage_total sums across sources for same kind+key
        total = store.usage_total("app", "chrome.exe", T0, T0 + 86400)
        assert total == 30

    def test_different_minute_buckets(self, store):
        store.upsert_usage("desktop", "app", [make_record(T0, active=10)])
        store.upsert_usage("desktop", "app", [make_record(T0 + 60, active=20)])
        total = store.usage_total("app", "chrome.exe", T0, T0 + 86400)
        assert total == 30

    def test_usage_total_respects_range(self, store):
        store.upsert_usage("desktop", "app", [make_record(T0, active=10)])
        store.upsert_usage("desktop", "app", [make_record(T0 + 7200, active=20)])
        # only count first bucket
        total = store.usage_total("app", "chrome.exe", T0, T0 + 3600)
        assert total == 10

    def test_empty_records_noop(self, store):
        store.upsert_usage("desktop", "app", [])  # should not raise

    def test_label_coalesced(self, store):
        store.upsert_usage("desktop", "app", [make_record(T0, label="Chrome")])
        store.upsert_usage("desktop", "app", [make_record(T0, label=None)])
        # label should remain "Chrome" (COALESCE keeps non-null)


class TestLimits:
    def _add_limit(self, store, key="youtube.com", secs=3600):
        return store.upsert_limit({
            "target_kind": "domain", "target_key": key,
            "period": "daily", "limit_secs": secs,
            "limit_type": "soft", "enabled": True,
        })

    def test_add_and_list(self, store):
        self._add_limit(store)
        limits = store.list_limits()
        assert len(limits) == 1
        assert limits[0]["target_key"] == "youtube.com"

    def test_upsert_is_idempotent(self, store):
        self._add_limit(store)
        self._add_limit(store)
        assert len(store.list_limits()) == 1

    def test_upsert_updates_secs(self, store):
        lid = self._add_limit(store, secs=3600)
        self._add_limit(store, secs=1800)
        limits = store.list_limits()
        assert limits[0]["limit_secs"] == 1800

    def test_delete_limit(self, store):
        lid = self._add_limit(store)
        store.delete_limit(lid)
        assert store.list_limits() == []

    def test_multiple_keys(self, store):
        self._add_limit(store, key="youtube.com")
        self._add_limit(store, key="twitter.com")
        assert len(store.list_limits()) == 2


class TestReminderLog:
    def test_no_fired_thresholds_initially(self, store):
        assert store.fired_thresholds(999, "2023-11-14") == []

    def test_log_and_retrieve(self, store):
        lid = store.upsert_limit({
            "target_kind": "domain", "target_key": "yt.com",
            "period": "daily", "limit_secs": 3600,
            "limit_type": "soft", "enabled": True,
        })
        store.log_reminder(lid, "2023-11-14", 50, int(time.time()))
        store.log_reminder(lid, "2023-11-14", 80, int(time.time()))
        fired = store.fired_thresholds(lid, "2023-11-14")
        assert sorted(fired) == [50, 80]

    def test_different_dates_separate(self, store):
        lid = store.upsert_limit({
            "target_kind": "domain", "target_key": "yt.com",
            "period": "daily", "limit_secs": 3600,
            "limit_type": "soft", "enabled": True,
        })
        now = int(time.time())
        store.log_reminder(lid, "2023-11-14", 50, now)
        store.log_reminder(lid, "2023-11-15", 80, now)
        assert store.fired_thresholds(lid, "2023-11-14") == [50]
        assert store.fired_thresholds(lid, "2023-11-15") == [80]


class TestRetention:
    def test_old_rows_removed(self, store):
        old_ts = T0 - 100 * 86400  # 100 days ago
        store.upsert_usage("desktop", "app", [make_record(old_ts, active=10)])
        removed = store.apply_retention(T0)
        assert removed >= 1

    def test_recent_rows_kept(self, store):
        store.upsert_usage("desktop", "app", [make_record(T0 - 3600, active=10)])
        removed = store.apply_retention(T0)
        assert removed == 0
