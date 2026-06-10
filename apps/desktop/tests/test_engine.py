"""Tests for the pure Engine state machine."""
import math
import pytest
from agent.engine import Engine, Sample, UsageRecord

T0 = (1_700_000_000 // 60) * 60  # minute-aligned unix timestamp


def make_sample(ts, app="chrome.exe", name="Chrome", idle=0.0):
    return Sample(ts=ts, app_key=app, app_name=name, idle_secs=idle)


class TestBucketOf:
    def test_aligned(self):
        assert Engine.bucket_of(T0) == T0

    def test_mid_minute(self):
        assert Engine.bucket_of(T0 + 37) == T0

    def test_just_before_next(self):
        assert Engine.bucket_of(T0 + 59) == T0

    def test_next_minute(self):
        assert Engine.bucket_of(T0 + 60) == T0 + 60


class TestBasicAccumulation:
    def test_no_flush_within_same_minute(self):
        eng = Engine()
        for i in range(30):
            flushed = eng.on_sample(make_sample(T0 + i))
            assert flushed == []

    def test_flush_on_minute_rollover(self):
        eng = Engine()
        for i in range(60):
            eng.on_sample(make_sample(T0 + i))
        flushed = eng.on_sample(make_sample(T0 + 60))
        assert len(flushed) == 1
        r = flushed[0]
        assert r.bucket_ts == T0
        assert r.key == "chrome.exe"
        assert r.active_secs == 60

    def test_active_secs_count(self):
        eng = Engine()
        for i in range(45):
            eng.on_sample(make_sample(T0 + i))
        flushed = eng.on_sample(make_sample(T0 + 60))
        assert flushed[0].active_secs == 45

    def test_idle_secs_count(self):
        eng = Engine(idle_threshold_secs=30.0)
        for i in range(20):
            eng.on_sample(make_sample(T0 + i, idle=0))   # active
        for i in range(20, 40):
            eng.on_sample(make_sample(T0 + i, idle=35))  # idle
        flushed = eng.on_sample(make_sample(T0 + 60))
        assert flushed[0].active_secs == 20
        assert flushed[0].idle_secs == 20


class TestAppSwitch:
    def test_two_apps_same_minute(self):
        eng = Engine()
        for i in range(30):
            eng.on_sample(make_sample(T0 + i, app="chrome.exe", name="Chrome"))
        for i in range(30, 60):
            eng.on_sample(make_sample(T0 + i, app="code.exe", name="VS Code"))
        flushed = eng.on_sample(make_sample(T0 + 60))
        assert len(flushed) == 2
        by_key = {r.key: r for r in flushed}
        assert by_key["chrome.exe"].active_secs == 30
        assert by_key["code.exe"].active_secs == 30

    def test_label_preserved(self):
        eng = Engine()
        eng.on_sample(make_sample(T0, app="chrome.exe", name="Google Chrome"))
        flushed = eng.on_sample(make_sample(T0 + 60))
        assert flushed[0].label == "Google Chrome"


class TestNullApp:
    def test_no_foreground_window_ignored(self):
        eng = Engine()
        for i in range(60):
            eng.on_sample(Sample(ts=T0 + i, app_key=None, app_name=None, idle_secs=0))
        flushed = eng.on_sample(make_sample(T0 + 60))
        assert flushed == []


class TestFlushAll:
    def test_flush_all_returns_pending(self):
        eng = Engine()
        for i in range(10):
            eng.on_sample(make_sample(T0 + i))
        records = eng.flush_all()
        assert len(records) == 1
        assert records[0].active_secs == 10

    def test_pending_empty_after_flush_all(self):
        eng = Engine()
        for i in range(10):
            eng.on_sample(make_sample(T0 + i))
        eng.flush_all()
        assert eng._pending == {}

    def test_flush_all_empty_engine(self):
        eng = Engine()
        assert eng.flush_all() == []


class TestMultipleMinutes:
    def test_three_consecutive_minutes(self):
        eng = Engine()
        results = []
        for minute in range(3):
            for tick in range(60):
                flushed = eng.on_sample(make_sample(T0 + minute * 60 + tick))
                results.extend(flushed)
        # trigger flush of 3rd minute
        results.extend(eng.on_sample(make_sample(T0 + 180)))
        assert len(results) == 3
        buckets = sorted(r.bucket_ts for r in results)
        assert buckets == [T0, T0 + 60, T0 + 120]
