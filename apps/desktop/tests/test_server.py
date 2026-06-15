"""Server tests — focus on the remote (tunnel) token guard.

Local loopback requests keep open access; any request arriving with a
forwarding header (i.e. through cloudflared) must carry the pairing token on
non-public paths, so exposing the agent publicly never leaks data or the token.
"""
import threading

import pytest

from agent.server import create_app
from agent.store import Store

TOKEN = "SECRET123"
REMOTE = {"x-forwarded-for": "1.2.3.4"}


@pytest.fixture
def client(tmp_path):
    store = Store(tmp_path / "t.db")
    store.set_setting("pairing_token", TOKEN)
    app = create_app(store, threading.Event(), port=48732, tunnel=None)
    return app.test_client()


def test_local_request_needs_no_token(client):
    assert client.get("/api/summary").status_code == 200


def test_remote_without_token_is_blocked(client):
    assert client.get("/api/summary", headers=REMOTE).status_code == 401


def test_remote_settings_never_leaks_token(client):
    # /api/settings returns the pairing token — must be guarded remotely.
    assert client.get("/api/settings", headers=REMOTE).status_code == 401


def test_remote_with_query_token_ok(client):
    r = client.get("/api/summary?token=" + TOKEN, headers=REMOTE)
    assert r.status_code == 200


def test_remote_with_header_token_ok(client):
    h = {**REMOTE, "x-focuslens-token": TOKEN}
    assert client.get("/api/summary", headers=h).status_code == 200


def test_remote_with_wrong_token_is_blocked(client):
    assert client.get("/api/summary?token=WRONG", headers=REMOTE).status_code == 401


def test_remote_html_shell_is_public(client):
    # HTML shells carry no data; they must load so their JS can supply the token.
    assert client.get("/mobile", headers=REMOTE).status_code == 200
    assert client.get("/", headers=REMOTE).status_code == 200


def test_network_info_reports_no_tunnel_when_inactive(client):
    data = client.get("/api/network-info").get_json()
    assert data["tunnelUrl"] is None


def test_android_payload_namespaces_per_device(tmp_path):
    """Two phones POSTing the same app must not merge — each device id gets its
    own source ("android:<id>") and its name is remembered."""
    from agent.timeutil import today_local, local_day_bounds
    store = Store(tmp_path / "t.db")
    store.set_setting("pairing_token", TOKEN)
    client = create_app(store, threading.Event(), port=48732, tunnel=None).test_client()
    day = today_local()
    start, _ = local_day_bounds(day)

    def sync(device_id, name, secs):
        return client.post(
            "/events",
            json={
                "source": "android",
                "deviceId": device_id,
                "deviceName": name,
                "records": [
                    {"kind": "app", "key": "com.discord", "active_secs": secs, "bucket_ts": start}
                ],
            },
            headers={"x-focuslens-token": TOKEN},
        )

    assert sync("AAA", "Xiaomi 14", 600).status_code == 200
    assert sync("BBB", "Pixel 8", 400).status_code == 200

    s = store.day_summary(day)
    names = {p["name"]: p["activeSecs"] for p in s["phones"]}
    assert names == {"Xiaomi 14": 600, "Pixel 8": 400}
    assert s["phoneActiveSecs"] == 1000
    assert store.get_setting("android_device:AAA") == "Xiaomi 14"
