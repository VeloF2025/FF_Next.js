"""Tests for the three MCP tools (discovery, describe, read).

Split from test_ff_mcp.py to stay inside the project's 300-line file limit. The `svc`
fixture lives in conftest.py.

Run with:  FF_MCP_CALLBACK_SECRET=test-secret python3 -m pytest apps/ff_mcp/ -q
"""

from __future__ import annotations

import json
import time
import urllib.error
from pathlib import Path

import pytest


@pytest.mark.parametrize(
    ("bad", "expected"),
    [
        ("https://evil.example/api/projects", "beginning with /api/"),
        ("http://127.0.0.1:7416/api/projects", "beginning with /api/"),
        ("/dashboard", "beginning with /api/"),
        ("api/projects", "beginning with /api/"),
        ("//evil.example/api", "beginning with /api/"),
        ("/api/../../etc/passwd", "'..'"),
        ("/api//evil.example/x", "'..'"),
    ],
)
def test_fibreflow_get_rejects_paths_that_are_not_plain_api_paths(svc, monkeypatch, bad, expected):
    """Asserts the SPECIFIC rejection and that no request is made.

    Checking only for `"error" in out` would pass even with the guard deleted — an
    unauthenticated call errors on the missing credential instead, so the test would
    be measuring the wrong thing.
    """
    _, tools = svc
    _with_token(tools, monkeypatch)
    called = {"n": 0}

    def fake_urlopen(req, timeout=0):
        called["n"] += 1
        raise AssertionError(f"guard did not stop the request: {req.full_url}")

    monkeypatch.setattr(tools.urllib.request, "urlopen", fake_urlopen)

    out = json.loads(tools._fibreflow_get_sync(bad))
    assert expected in out["error"], out
    assert called["n"] == 0


@pytest.mark.parametrize(
    "denied",
    ["/api/accounting/ledger", "/api/staff/list", "/api/staff-documents/1", "/api/my/payslips"],
)
def test_fibreflow_get_refuses_denied_groups_with_a_stop_signal(svc, denied):
    _, tools = svc
    out = json.loads(tools._fibreflow_get_sync(denied))
    assert "error" in out
    # Must tell the model to stop, or it will probe sibling paths.
    assert "do not try other paths" in out["error"]


def _with_token(tools, monkeypatch, token="tok"):
    monkeypatch.setattr(tools, "_access_token", lambda: token)
    tools._call_times.clear()


def test_fibreflow_get_sends_the_bearer_token_to_the_right_url(svc, monkeypatch):
    server, tools = svc
    _with_token(tools, monkeypatch)
    seen = {}

    class FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b'{"ok":true}'

    def fake_urlopen(req, timeout=0):
        seen["url"] = req.full_url
        seen["auth"] = req.headers.get("Authorization")
        return FakeResp()

    monkeypatch.setattr(tools.urllib.request, "urlopen", fake_urlopen)
    body = tools._fibreflow_get_sync("/api/projects", "limit=5")

    assert seen["url"] == "https://dev.fibreflow.app/api/projects?limit=5"
    assert seen["auth"] == "Bearer tok"
    assert body == '{"ok":true}'


def test_fibreflow_get_marks_a_truncated_response_explicitly(svc, monkeypatch):
    _, tools = svc
    _with_token(tools, monkeypatch)
    huge = b'"' + b"x" * (tools.MAX_RESPONSE_CHARS + 500) + b'"'

    class FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return huge

    monkeypatch.setattr(tools.urllib.request, "urlopen", lambda req, timeout=0: FakeResp())
    out = json.loads(tools._fibreflow_get_sync("/api/projects"))

    assert out["truncated"] is True
    assert out["totalChars"] > out["shownChars"]
    assert "NOT seeing the full result" in out["note"]
    assert "limit" in out["note"]


def test_fibreflow_get_passes_a_403_through_verbatim(svc, monkeypatch):
    _, tools = svc
    _with_token(tools, monkeypatch)

    def fake_urlopen(req, timeout=0):
        raise urllib.error.HTTPError(
            req.full_url, 403, "Forbidden", {}, __import__("io").BytesIO(b'{"code":"MCP_READ_ONLY"}')
        )

    monkeypatch.setattr(tools.urllib.request, "urlopen", fake_urlopen)
    out = json.loads(tools._fibreflow_get_sync("/api/projects"))

    assert "403" in out["error"]
    # The model must see FibreFlow's own message, not a laundered one.
    assert "MCP_READ_ONLY" in out["response"]


def test_fibreflow_get_enforces_the_hourly_budget(svc, monkeypatch):
    _, tools = svc
    _with_token(tools, monkeypatch)

    class FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b"{}"

    calls = {"n": 0}

    def fake_urlopen(req, timeout=0):
        calls["n"] += 1
        return FakeResp()

    monkeypatch.setattr(tools.urllib.request, "urlopen", fake_urlopen)

    for _ in range(tools.RATE_LIMIT_PER_HOUR):
        assert "Rate limit" not in tools._fibreflow_get_sync("/api/projects")

    over = json.loads(tools._fibreflow_get_sync("/api/projects"))
    assert "Rate limit" in over["error"]
    # The budget must actually stop the upstream call, not just annotate it.
    assert calls["n"] == tools.RATE_LIMIT_PER_HOUR


def test_rate_limit_is_per_token(svc, monkeypatch):
    _, tools = svc
    _with_token(tools, monkeypatch)

    class FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b"{}"

    monkeypatch.setattr(tools.urllib.request, "urlopen", lambda req, timeout=0: FakeResp())

    monkeypatch.setattr(tools, "_access_token", lambda: "aaaaaaaaaaaaaaaaaaaa")
    for _ in range(tools.RATE_LIMIT_PER_HOUR):
        tools._fibreflow_get_sync("/api/projects")
    assert "Rate limit" in json.loads(tools._fibreflow_get_sync("/api/projects"))["error"]

    # A second user's connection must be unaffected.
    monkeypatch.setattr(tools, "_access_token", lambda: "bbbbbbbbbbbbbbbbbbbb")
    assert "Rate limit" not in tools._fibreflow_get_sync("/api/projects")


def test_fibreflow_get_without_a_credential_explains_how_to_reconnect(svc, monkeypatch):
    _, tools = svc
    tools._call_times.clear()
    monkeypatch.setattr(tools, "get_access_token", lambda: None)
    out = json.loads(tools._fibreflow_get_sync("/api/projects"))
    assert "Reconnect" in out["error"]


def test_rate_limit_is_safe_under_real_concurrency(svc):
    """fibreflow_get runs on a worker-thread pool, so _rate_limit genuinely executes
    concurrently. Unlocked, the sweep iterates _call_times while another thread inserts
    into it -> "dictionary changed size during iteration", which the caller swallows and
    reports to Claude as a nonsense tool error instead of data.

    The parameters matter. A handful of threads doing a few calls each will NOT
    reproduce this: CPython only switches threads every 5ms by default, and a short
    comprehension usually finishes inside one slice. Reproducing it needs a switch
    interval small enough to preempt mid-comprehension AND a dict large enough that the
    comprehension spans a switch. Verified against the unlocked implementation: these
    values fail it 7/7 times across repeated runs.
    """
    import sys
    import threading

    _, tools = svc
    tools._call_times.clear()

    old_interval = sys.getswitchinterval()
    sys.setswitchinterval(1e-6)
    try:
        stale_ts = time.time() - tools._RATE_WINDOW_SECONDS - 10
        for i in range(4000):
            tools._call_times[f"stale-{i:016d}"] = [stale_ts]

        errors: list[str] = []
        start = threading.Barrier(8)

        def hammer(i: int) -> None:
            try:
                start.wait(timeout=10)
                for j in range(60):
                    tools._rate_limit(f"tok-{i}-{j}".ljust(20, "x"))
            except BaseException as exc:  # noqa: BLE001 - the point is to catch anything
                errors.append(repr(exc))

        threads = [threading.Thread(target=hammer, args=(i,)) for i in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=60)

        assert not errors, f"concurrent _rate_limit raised: {errors[:3]}"
    finally:
        sys.setswitchinterval(old_interval)
        tools._call_times.clear()


def test_rate_limit_does_not_lose_increments_under_contention(svc, monkeypatch):
    """Two threads sharing one token must not both read the same list, both append, and
    lose one — that would make the budget quietly more permissive than it claims.

    The budget is lifted for the duration: with the real ceiling the list stops growing
    at RATE_LIMIT_PER_HOUR by design, which would mask a lost update rather than expose
    it. What is under test is the read-modify-write, not the ceiling.
    """
    import threading

    _, tools = svc
    tools._call_times.clear()
    token = "shared-token-value"
    key = token[-16:]
    monkeypatch.setattr(tools, "RATE_LIMIT_PER_HOUR", 10_000)

    import sys

    per_thread = 200
    start = threading.Barrier(4)
    old_interval = sys.getswitchinterval()
    sys.setswitchinterval(1e-6)

    def hammer() -> None:
        start.wait(timeout=10)
        for _ in range(per_thread):
            try:
                tools._rate_limit(token)
            except RuntimeError:
                pass  # over budget is expected; we are counting recorded calls

    threads = [threading.Thread(target=hammer) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)

    sys.setswitchinterval(old_interval)
    # Every call must be recorded exactly once. Unlocked, two threads read the same
    # list, both append, and one increment is lost — a budget quietly more permissive
    # than it advertises.
    assert len(tools._call_times[key]) == per_thread * 4
