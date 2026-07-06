#!/usr/bin/env python
"""
Stop hook: runs once when Claude Code finishes a turn.
Looks at what actually changed (tracked diff + untracked new files) since the
last commit, and only runs checks relevant to what was touched:
  - secret-pattern scan on every changed file
  - `npx tsc --noEmit` in apps/mobile if any mobile .ts/.tsx changed
  - `pytest` in apps/desktop if any desktop .py changed

Exits 2 (blocks the turn from ending, Claude must fix and retry) on failure.
Exits 0 silently on no changes, or on any unexpected internal error (fail-open
so a bug in this script never bricks normal usage).
"""
import json
import os
import re
import subprocess
import sys

SECRET_PATTERNS = [
    r"AKIA[0-9A-Z]{16}",
    r"sk-[a-zA-Z0-9]{20,}",
    r"-----BEGIN (RSA|EC|OPENSSH|DSA) PRIVATE KEY-----",
    r"(?i)(api|secret|access)[_-]?(key|token)[\"'\s:=]+[\"'][a-zA-Z0-9_\-]{16,}[\"']",
]


def sh(cmd, cwd):
    return subprocess.run(
        cmd, cwd=cwd, capture_output=True, text=True, shell=(os.name == "nt")
    )


def main():
    # Consume stdin (hook payload) without depending on its shape.
    try:
        json.load(sys.stdin)
    except Exception:
        pass

    repo_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )

    diff = sh(["git", "diff", "--name-only", "HEAD"], repo_root)
    diff_cached = sh(["git", "diff", "--name-only", "--cached"], repo_root)
    untracked = sh(["git", "ls-files", "--others", "--exclude-standard"], repo_root)

    changed = set()
    for r in (diff, diff_cached, untracked):
        if r.returncode == 0:
            changed |= set(line.strip() for line in r.stdout.splitlines() if line.strip())

    if not changed:
        sys.exit(0)

    problems = []

    for rel in changed:
        abs_path = os.path.join(repo_root, rel)
        if not os.path.isfile(abs_path):
            continue
        try:
            with open(abs_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except Exception:
            continue
        for pat in SECRET_PATTERNS:
            if re.search(pat, content):
                problems.append(f"possible hardcoded secret in {rel} (pattern: {pat})")
                break

    norm = [c.replace("\\", "/") for c in changed]
    mobile_ts_touched = any(
        c.startswith("apps/mobile/") and c.endswith((".ts", ".tsx")) for c in norm
    )
    desktop_py_touched = any(
        c.startswith("apps/desktop/") and c.endswith(".py") for c in norm
    )

    if mobile_ts_touched:
        r = sh(["npx", "tsc", "--noEmit"], os.path.join(repo_root, "apps", "mobile"))
        if r.returncode != 0:
            problems.append(
                "apps/mobile typecheck failed:\n" + (r.stdout[-1500:] + r.stderr[-1500:])
            )

    if desktop_py_touched:
        r = sh(
            ["python", "-m", "pytest", "tests/", "-q"],
            os.path.join(repo_root, "apps", "desktop"),
        )
        if r.returncode != 0:
            problems.append(
                "apps/desktop pytest failed:\n" + (r.stdout[-1500:] + r.stderr[-1500:])
            )

    if problems:
        print(
            "STOP BLOCKED — fix before ending the turn:\n\n" + "\n\n".join(problems),
            file=sys.stderr,
        )
        sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        # Fail-open: never let a bug in the hook itself block the session.
        sys.exit(0)
