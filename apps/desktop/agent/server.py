"""Flask HTTP server (bound to 0.0.0.0:48732 so LAN devices like the phone
companion can reach it). Loopback requests are trusted; remote/tunnelled
requests are gated by _guard_remote and must carry the pairing token.

Routes:
  GET  /ping            — health check (no token)
  GET  /                — dashboard HTML (no token)
  GET  /api/summary     — day summary
  GET  /api/limits      — limits + today's usage
  POST /api/limits      — upsert limit
  DELETE /api/limits/<id>
  GET  /api/settings    — pairing token + tracking status
  POST /api/settings    — update settings
  POST /events          — extension minute-bucket events (token required)
"""
from __future__ import annotations

import threading
import time
from pathlib import Path

from flask import Flask, jsonify, request, send_file

from .limits import check_and_fire
from .timeutil import today_local

TOKEN_HEADER = "x-focuslens-token"
DASHBOARD_DIR = Path(__file__).parent.parent / "dashboard"
DASHBOARD_HTML = DASHBOARD_DIR / "index.html"
MOBILE_HTML = DASHBOARD_DIR / "mobile.html"
MANIFEST_JSON = DASHBOARD_DIR / "manifest.json"

# Paths reachable without a token even over the tunnel (HTML shells + health).
# They carry no private data; the JS they load must supply the token for API calls.
_PUBLIC_PATHS = {"/ping", "/", "/mobile", "/manifest.json"}


def create_app(store, is_paused: threading.Event, port: int = 48732, tunnel=None) -> Flask:
    app = Flask(__name__)
    app.config["JSON_SORT_KEYS"] = False

    def _is_remote() -> bool:
        # cloudflared injects forwarding headers; local loopback requests do not.
        return bool(
            request.headers.get("cf-connecting-ip")
            or request.headers.get("x-forwarded-for")
        )

    def _supplied_token() -> str | None:
        return request.headers.get(TOKEN_HEADER) or request.args.get("token")

    @app.before_request
    def _guard_remote():
        # Local requests keep loopback trust. Remote (tunnelled) requests must
        # carry the pairing token on every non-public path.
        if request.method == "OPTIONS" or not _is_remote():
            return None
        if request.path in _PUBLIC_PATHS:
            return None
        expected = store.get_setting("pairing_token")
        if not (expected and _supplied_token() == expected):
            return jsonify(error="token required for remote access"), 401
        return None

    def _cors(response):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Headers"] = f"content-type, {TOKEN_HEADER}"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
        return response

    app.after_request(_cors)

    @app.route("/", methods=["OPTIONS"])
    @app.route("/<path:_>", methods=["OPTIONS"])
    def options_handler(**_):
        return "", 204

    # ---- public routes (no token) ------------------------------------------

    @app.route("/ping")
    def ping():
        return jsonify(ok=True)

    @app.route("/")
    def dashboard():
        return send_file(DASHBOARD_HTML)

    @app.route("/mobile")
    def mobile():
        return send_file(MOBILE_HTML)

    @app.route("/manifest.json")
    def manifest():
        return send_file(MANIFEST_JSON)

    @app.route("/api/network-info")
    def api_network_info():
        import socket
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()
        except Exception:
            local_ip = "127.0.0.1"
        tunnel_url = tunnel.url if (tunnel and tunnel.running) else None
        return jsonify(localIp=local_ip, port=port, tunnelUrl=tunnel_url)

    # ---- token guard -------------------------------------------------------

    def _check_token() -> bool:
        expected = store.get_setting("pairing_token")
        return request.headers.get(TOKEN_HEADER) == expected

    # ---- API routes (token required for extension; open for dashboard) -----
    # Dashboard is served from the same origin (localhost), so we rely on the
    # loopback bind for security instead of token-checking the dashboard API.

    @app.route("/api/summary")
    def api_summary():
        date_str = request.args.get("date", today_local())
        try:
            return jsonify(store.day_summary(date_str))
        except ValueError as e:
            return jsonify(error=str(e)), 400

    @app.route("/api/trends")
    def api_trends():
        days = min(max(int(request.args.get("days", 14)), 7), 90)
        end_date = request.args.get("date", today_local())
        try:
            daily = store.daily_totals(days, end_date)
        except ValueError as e:
            return jsonify(error=str(e)), 400

        this_week = sum(d["activeSecs"] for d in daily[-7:])
        last_week = sum(d["activeSecs"] for d in daily[-14:-7]) if len(daily) >= 14 else 0
        delta_pct = (
            round(100 * (this_week - last_week) / last_week) if last_week > 0 else None
        )
        return jsonify(
            days=daily,
            thisWeekSecs=this_week,
            lastWeekSecs=last_week,
            deltaPct=delta_pct,
            movers=store.app_week_movers(end_date),
        )

    @app.route("/api/categories", methods=["GET"])
    def api_categories_get():
        return jsonify(categories=store.list_categories(), rules=store.list_rules())

    @app.route("/api/categories/rules", methods=["POST"])
    def api_rules_post():
        data = request.get_json(silent=True) or {}
        pattern = (data.get("pattern") or "").strip()
        category = (data.get("category") or "").strip()
        kind = data.get("target_kind", "any")
        if not pattern or len(pattern) > 253:
            return jsonify(error="pattern is required"), 400
        if kind not in ("app", "domain", "any"):
            return jsonify(error="target_kind must be app, domain or any"), 400
        try:
            rid = store.add_rule(category, pattern, kind)
        except ValueError as e:
            return jsonify(error=str(e)), 400
        return jsonify(id=rid), 201

    @app.route("/api/categories/rules/<int:rid>", methods=["DELETE"])
    def api_rules_delete(rid: int):
        store.delete_rule(rid)
        return "", 204

    @app.route("/api/limits", methods=["GET"])
    def api_limits_get():
        from .timeutil import local_day_bounds, local_week_bounds
        date_str = today_local()
        day_start, day_end = local_day_bounds(date_str)
        result = []
        for lim in store.list_limits():
            if lim["limit_type"] == "goal":
                if lim["period"] == "weekly":
                    s, e, _ = local_week_bounds(date_str)
                else:
                    s, e = day_start, day_end
                used = store.goal_used(lim["target_kind"], lim["target_key"], s, e)
            else:
                used = store.usage_total(
                    lim["target_kind"], lim["target_key"], day_start, day_end
                )
            result.append({**lim, "usedSecsToday": used, "enabled": bool(lim["enabled"])})
        return jsonify(result)

    @app.route("/api/limits", methods=["POST"])
    def api_limits_post():
        data = request.get_json(silent=True) or {}
        if not data.get("target_key", "").strip():
            return jsonify(error="target_key is required"), 400
        if not isinstance(data.get("limit_secs"), int) or data["limit_secs"] <= 0:
            return jsonify(error="limit_secs must be a positive integer"), 400
        lid = store.upsert_limit(data)
        return jsonify(id=lid), 201

    @app.route("/api/limits/<int:lid>", methods=["DELETE"])
    def api_limits_delete(lid: int):
        store.delete_limit(lid)
        return "", 204

    @app.route("/api/settings", methods=["GET"])
    def api_settings_get():
        return jsonify(
            pairingToken=store.get_setting("pairing_token"),
            paused=is_paused.is_set(),
            retentionDays=store.retention_days(),
            idleThresholdSecs=store.idle_threshold_secs(),
        )

    @app.route("/api/settings", methods=["POST"])
    def api_settings_post():
        data = request.get_json(silent=True) or {}
        if "paused" in data:
            if data["paused"]:
                is_paused.set()
            else:
                is_paused.clear()
        if "retentionDays" in data:
            store.set_setting("retention_days", str(int(data["retentionDays"])))
        if "idleThresholdSecs" in data:
            store.set_setting("idle_threshold_secs", str(float(data["idleThresholdSecs"])))
        return jsonify(ok=True)

    # ---- extension endpoint (token required) --------------------------------

    @app.route("/events", methods=["POST"])
    def extension_events():
        if not _check_token():
            return jsonify(error="invalid or missing pairing token"), 401
        if is_paused.is_set():
            return jsonify(accepted=0)

        payload = request.get_json(silent=True) or {}
        from .engine import UsageRecord

        # ---- Android companion: snapshot of today's per-app totals ----------
        # Payload: {source:"android", deviceId, deviceName,
        #           records:[{kind,key,active_secs,bucket_ts}]}
        # active_secs is a running daily total against a fixed (midnight) bucket,
        # so we REPLACE rather than accumulate to stay idempotent across syncs.
        # Each phone gets its own source ("android:<deviceId>") so two devices
        # are tracked separately instead of clobbering/merging each other.
        if payload.get("source") == "android":
            device_id = (payload.get("deviceId") or "").strip()[:64]
            device_name = (payload.get("deviceName") or "").strip()[:64]
            android_source = f"android:{device_id}" if device_id else "android"
            if device_id and device_name:
                store.set_setting(f"android_device:{device_id}", device_name)
            arecords = []
            for ev in payload.get("records", []):
                key = (ev.get("key") or "").strip()
                active = ev.get("active_secs", 0)
                bucket_ts = ev.get("bucket_ts", 0)
                if (
                    key
                    and len(key) <= 253
                    and isinstance(active, int)
                    and 0 < active <= 86_400
                    and bucket_ts > 0
                    and bucket_ts % 60 == 0
                ):
                    arecords.append(
                        UsageRecord(
                            bucket_ts=bucket_ts,
                            key=key,
                            label=key,
                            active_secs=active,
                            idle_secs=0,
                        )
                    )
            if arecords:
                store.replace_usage(android_source, "app", arecords)
                check_and_fire(store)
            return jsonify(accepted=len(arecords))

        # ---- Browser extension: per-minute domain events -------------------
        events = payload.get("events", [])
        records = []
        for ev in events:
            domain = (ev.get("domain") or "").strip()
            active = ev.get("activeSecs", 0)
            bucket_ts = ev.get("bucketTs", 0)
            if (
                domain
                and len(domain) <= 253
                and 1 <= active <= 60
                and bucket_ts > 0
                and bucket_ts % 60 == 0
            ):
                records.append(
                    UsageRecord(
                        bucket_ts=bucket_ts,
                        key=domain,
                        label=domain,
                        active_secs=active,
                        idle_secs=0,
                    )
                )

        if records:
            store.upsert_usage("extension", "domain", records)
            check_and_fire(store)

        return jsonify(accepted=len(records))

    # ---- summary for extension popup (token required) ----------------------

    @app.route("/summary/today")
    def ext_summary_today():
        if not _check_token():
            return jsonify(error="invalid or missing pairing token"), 401
        return jsonify(store.day_summary(today_local()))

    return app
