"""Categorization, productivity score, and trends."""
import pytest

from agent.engine import UsageRecord
from agent.store import Store

T0 = (1_700_000_000 // 60) * 60  # minute-aligned


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "t.db")


def rec(ts, key, secs, label=None):
    return UsageRecord(bucket_ts=ts, key=key, label=label or key, active_secs=secs, idle_secs=0)


# ---- classification ---------------------------------------------------------

def test_default_rules_seeded(store):
    cats = {c["name"] for c in store.list_categories()}
    assert cats == {"Productive", "Neutral", "Distracting"}
    assert len(store.list_rules()) > 10


def test_classify_app_and_domain(store):
    classify = store._rules_matcher()
    assert classify("app", "Code.exe", "Visual Studio Code")[0] == "Productive"
    assert classify("domain", "youtube.com", None)[0] == "Distracting"
    assert classify("app", "unknown.exe", "Mystery App")[0] == "Neutral"


def test_longest_pattern_wins(store):
    store.add_rule("Distracting", "google.com", "domain")
    store.add_rule("Productive", "docs.google.com", "domain")
    classify = store._rules_matcher()
    assert classify("domain", "docs.google.com", None)[0] == "Productive"
    assert classify("domain", "mail.google.com", None)[0] == "Distracting"


def test_rule_kind_scoping(store):
    # an 'app' rule must not match domains
    classify = store._rules_matcher()
    assert classify("domain", "code.org", None)[0] == "Neutral"


def test_add_rule_unknown_category_raises(store):
    with pytest.raises(ValueError):
        store.add_rule("Nope", "x", "any")


def test_delete_rule(store):
    rid = store.add_rule("Distracting", "example.com", "domain")
    store.delete_rule(rid)
    assert all(r["id"] != rid for r in store.list_rules())


# ---- score ------------------------------------------------------------------

def test_score_formula():
    assert Store._score(3600, 0, 0) == 100
    assert Store._score(0, 0, 3600) == 0
    assert Store._score(0, 3600, 0) == 50
    assert Store._score(1800, 0, 1800) == 50
    assert Store._score(0, 0, 0) is None


def test_day_summary_includes_score(store):
    from agent.timeutil import today_local, local_day_bounds
    day = today_local()
    start, _ = local_day_bounds(day)
    store.upsert_usage("desktop", "app", [
        rec(start, "Code.exe", 60, "Visual Studio Code"),
        rec(start + 60, "steam.exe", 60, "Steam"),
    ])
    s = store.day_summary(day)
    assert s["productivityScore"] == 50
    assert s["categorySecs"]["Productive"] == 60
    assert s["categorySecs"]["Distracting"] == 60
    cats = {a["key"]: a["category"] for a in s["apps"]}
    assert cats == {"Code.exe": "Productive", "steam.exe": "Distracting"}


# ---- trends -----------------------------------------------------------------

def test_daily_totals_shape_and_padding(store):
    from agent.timeutil import today_local, local_day_bounds
    day = today_local()
    start, _ = local_day_bounds(day)
    store.upsert_usage("desktop", "app", [rec(start, "Code.exe", 120, "VS Code")])

    daily = store.daily_totals(14, day)
    assert len(daily) == 14            # padded with empty days
    assert daily[-1]["date"] == day    # newest last
    assert daily[-1]["activeSecs"] == 120
    assert daily[-1]["productiveSecs"] == 120
    assert daily[0]["activeSecs"] == 0
    assert daily[0]["score"] is None


def test_week_movers(store):
    from datetime import date, timedelta
    from agent.timeutil import local_day_bounds
    today = date.today().isoformat()
    this_start, _ = local_day_bounds(today)
    prev_day = (date.today() - timedelta(days=8)).isoformat()
    prev_start, _ = local_day_bounds(prev_day)

    # 20 min this week vs 5 min last week → +15 min mover
    store.upsert_usage("desktop", "app", [rec(this_start, "Code.exe", 1200, "VS Code")])
    store.upsert_usage("desktop", "app", [rec(prev_start, "Code.exe", 300, "VS Code")])

    movers = store.app_week_movers(today)
    assert movers and movers[0]["key"] == "Code.exe"
    assert movers[0]["deltaSecs"] == 900


def test_movers_ignore_noise(store):
    from agent.timeutil import today_local, local_day_bounds
    day = today_local()
    start, _ = local_day_bounds(day)
    store.upsert_usage("desktop", "app", [rec(start, "tiny.exe", 60)])  # 1 min total
    assert store.app_week_movers(day) == []
