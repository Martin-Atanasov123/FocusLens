"""Flask HTTP server — loopback only (127.0.0.1:48732).

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
DASHBOARD_HTML = Path(__file__).parent.parent / "dashboard" / "index.html"


MOBILE_HTML = Path(__file__).parent.parent / "dashboard" / "mobile.html"


def create_app(store, is_paused: threading.Event, port: int = 48732) -> Flask:
    app = Flask(__name__)
    app.config["JSON_SORT_KEYS"] = False

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
        return jsonify(localIp=local_ip, port=port)

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

    @app.route("/api/limits", methods=["GET"])
    def api_limits_get():
        from .timeutil import local_day_bounds
        date_str = today_local()
        start, end = local_day_bounds(date_str)
        limits = store.list_limits()
        result = []
        for lim in limits:
            used = store.usage_total(lim["target_kind"], lim["target_key"], start, end)
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
        # Payload: {source:"android", records:[{kind,key,active_secs,bucket_ts}]}
        # active_secs is a running daily total against a fixed (midnight) bucket,
        # so we REPLACE rather than accumulate to stay idempotent across syncs.
        if payload.get("source") == "android":
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
                store.replace_usage("android", "app", arecords)
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
