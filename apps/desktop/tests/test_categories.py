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


# ---- phone devices ----------------------------------------------------------

def test_phone_devices_tracked_separately(store):
    from agent.timeutil import today_local, local_day_bounds
    day = today_local()
    start, _ = local_day_bounds(day)
    store.set_setting("android_device:AAA", "Xiaomi 14")
    store.set_setting("android_device:BBB", "Pixel 8")
    store.replace_usage("android:AAA", "app", [
        rec(start, "com.instagram.android", 1000),
        rec(start, "com.brave.browser", 500),
    ])
    store.replace_usage("android:BBB", "app", [rec(start, "com.discord", 800)])

    s = store.day_summary(day)
    names = {p["name"]: p["activeSecs"] for p in s["phones"]}
    assert names == {"Xiaomi 14": 1500, "Pixel 8": 800}
    assert s["phoneActiveSecs"] == 2300

    # re-syncing one phone REPLACES its snapshot — never double-counts
    store.replace_usage("android:AAA", "app", [
        rec(start, "com.instagram.android", 1200),
        rec(start, "com.brave.browser", 500),
    ])
    s2 = store.day_summary(day)
    names2 = {p["name"]: p["activeSecs"] for p in s2["phones"]}
    assert names2 == {"Xiaomi 14": 1700, "Pixel 8": 800}
    assert s2["phoneActiveSecs"] == 2500


def test_all_sources_sums_desktop_and_phones(store):
    from agent.timeutil import today_local, local_day_bounds
    day = today_local()
    start, _ = local_day_bounds(day)
    store.upsert_usage("desktop", "app", [rec(start, "Code.exe", 600, "VS Code")])
    store.replace_usage("android:AAA", "app", [rec(start, "com.discord", 400)])

    s = store.day_summary(day)
    assert s["totalActiveSecs"] == 600           # desktop only
    assert s["phoneActiveSecs"] == 400           # phones only
    assert s["allSourcesSecs"] == 1000           # combined


# ---- goals (category totals) ------------------------------------------------

def test_category_total_sums_across_desktop_and_extension(store):
    from agent.timeutil import today_local, local_day_bounds
    day = today_local()
    start, _ = local_day_bounds(day)
    store.upsert_usage("desktop", "app", [
        rec(start, "Code.exe", 1200, "Visual Studio Code"),  # Productive
        rec(start, "steam.exe", 600, "Steam"),               # Distracting
    ])
    store.upsert_usage("extension", "domain", [
        rec(start, "github.com", 300),    # Productive
        rec(start, "youtube.com", 900),   # Distracting
    ])
    end = start + 86400
    assert store.category_total("Productive", start, end) == 1500   # 1200 + 300
    assert store.category_total("Distracting", start, end) == 1500  # 600 + 900
    # goal_used delegates to category_total for category targets
    assert store.goal_used("category", "Productive", start, end) == 1500


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
