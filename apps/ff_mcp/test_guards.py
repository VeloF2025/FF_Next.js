"""Tests for the path guards: canonicalisation, traversal, and the denylist.

These are the checks the module documents as its blast-radius guard, so they get their
own file. The `svc` fixture lives in conftest.py.
"""

from __future__ import annotations

import json

import pytest

from .test_tools import _with_token


@pytest.mark.parametrize(
    "bad",
    [
        # Case: Next.js route dirs are lower-case, so FibreFlow routes these to the
        # denied handlers even though an exact-match denylist would wave them through.
        "/api/Accounting/ledger",
        "/api/ACCOUNTING/ledger",
        "/api/Staff/list",
        "/api/STAFF/list",
        "/api/Staff-Documents/1",
        "/api/My/payslips",
        # Percent-encoding: the server decodes before routing.
        "/api/%61ccounting/ledger",
        "/api/%73taff/list",
    ],
)
def test_denylist_is_not_bypassable_by_case_or_encoding(svc, monkeypatch, bad):
    _, tools = svc
    _with_token(tools, monkeypatch)
    called = {"n": 0}

    def fake_urlopen(req, timeout=0):
        called["n"] += 1
        raise AssertionError(f"denylist bypassed: {req.full_url}")

    monkeypatch.setattr(tools.urllib.request, "urlopen", fake_urlopen)
    out = json.loads(tools._fibreflow_get_sync(bad))

    assert "not available through this connector" in out["error"], out
    assert called["n"] == 0


@pytest.mark.parametrize(
    "bad",
    ["/api/%2e%2e/etc/passwd", "/api/%2E%2E/x", "/api/%252e%252e/x", "/api/a/%2f%2fevil/x"],
)
def test_traversal_guard_sees_through_percent_encoding(svc, monkeypatch, bad):
    _, tools = svc
    _with_token(tools, monkeypatch)
    called = {"n": 0}

    def fake_urlopen(req, timeout=0):
        called["n"] += 1
        raise AssertionError(f"traversal guard bypassed: {req.full_url}")

    monkeypatch.setattr(tools.urllib.request, "urlopen", fake_urlopen)
    out = json.loads(tools._fibreflow_get_sync(bad))

    assert "error" in out, out
    assert called["n"] == 0


def test_canonicalisation_survives_double_encoding(svc):
    _, tools = svc
    assert tools._canonical("/api/%252e%252e/x") == "/api/../x"
    assert tools._canonical("/api/Accounting/L") == "/api/accounting/l"


# ------------------------------------------------------- the tool must not block the loop


@pytest.mark.asyncio
async def test_fibreflow_get_runs_its_blocking_io_off_the_event_loop(svc, monkeypatch):
    """FastMCP calls a SYNC tool inline on the event loop, so a slow FibreFlow response
    would stall every other user. The tool must be async and offload."""
    import inspect

    _, tools = svc
    assert inspect.iscoroutinefunction(tools.fibreflow_get)

    _with_token(tools, monkeypatch)
    import threading

    caller = {}

    class FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            caller["thread"] = threading.current_thread().name
            return b'{"ok":true}'

    monkeypatch.setattr(tools.urllib.request, "urlopen", lambda req, timeout=0: FakeResp())
    main_thread = threading.current_thread().name
    body = await tools.fibreflow_get("/api/projects")

    assert body == '{"ok":true}'
    assert caller["thread"] != main_thread, "blocking read ran on the event loop thread"


# ------------------------------------------------------------- rate-limiter bookkeeping


def test_rate_limit_keys_are_swept_once_they_age_out(svc, monkeypatch):
    """Drives a fake clock rather than hoping — the sweep is time-based, so a test that
    only makes 25 quick calls proves nothing (all 25 keys are legitimately live)."""
    _, tools = svc
    tools._call_times.clear()

    class FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b"{}"

    monkeypatch.setattr(tools.urllib.request, "urlopen", lambda req, timeout=0: FakeResp())

    now = [1_000_000.0]
    monkeypatch.setattr(tools.time, "time", lambda: now[0])

    for i in range(25):
        monkeypatch.setattr(tools, "_access_token", lambda i=i: f"token-number-{i:016d}")
        tools._fibreflow_get_sync("/api/projects")
    assert len(tools._call_times) == 25  # all live, correctly retained

    # Move past the window and make one call from a new connection.
    now[0] += tools._RATE_WINDOW_SECONDS + 1
    monkeypatch.setattr(tools, "_access_token", lambda: "a-brand-new-token-value")
    tools._fibreflow_get_sync("/api/projects")

    # The 25 abandoned connections must be gone, not retained for the process lifetime.
    assert len(tools._call_times) == 1, f"{len(tools._call_times)} keys retained"


@pytest.mark.parametrize(
    "group", ["Accounting", "ACCOUNTING", "Staff", "Staff-Documents", "MY", "my"]
)
def test_denied_group_is_case_insensitive_on_its_own(svc, group):
    """The predicate is the guard, so it must not rely on every caller having
    canonicalised first. Tested directly because the only current caller already
    lower-cases, which would leave this branch unexercised."""
    _, tools = svc
    assert tools._denied_group(group) is not None


# ---------------------------------------------------------------------------
# Path-level denial.
#
# `field` cannot go in DENIED_GROUPS: the hyphenated-sibling rule would match
# `field-stock` and take out the whole warehouse module. So /api/field/attendance —
# same permission key as the supervisor-scoped report, no scope applied — is denied by
# path instead. These pin that it is actually refused, that it does not take the
# warehouse with it, and that the refusal happens at the shared guard rather than in
# one tool.
# ---------------------------------------------------------------------------


def test_field_attendance_is_refused_by_path(svc):
    _, tools = svc
    refusal = tools._guard_path("/api/field/attendance")
    assert refusal is not None
    assert "/api/field/attendance" in refusal["message"]


def test_field_attendance_refusal_survives_a_query_string_and_encoding(svc):
    """The guard runs on the canonical form, so neither trick reaches the route."""
    _, tools = svc
    assert tools._guard_path("/api/field/attendance?from=2026-01-01") is not None
    assert tools._guard_path("/api/field/%61ttendance") is not None


def test_field_attendance_denies_its_subpaths(svc):
    _, tools = svc
    assert tools._guard_path("/api/field/attendance/2026-08") is not None


def test_field_stock_is_STILL_REACHABLE(svc):
    """The mirror, and the reason this is a path deny rather than a group deny.

    Without this, moving `field` into DENIED_GROUPS would satisfy every assertion
    above while silently removing the entire warehouse module from the connector.
    """
    _, tools = svc
    assert tools._guard_path("/api/field-stock/reports/daily-reconciliation") is None
    assert tools._guard_path("/api/field/workers") is None


def test_denied_path_matches_on_a_segment_boundary(svc):
    """A prefix match must not swallow a differently-named neighbouring route."""
    _, tools = svc
    assert tools._denied_path("/api/field/attendance-policy") is None
    assert tools._denied_path("/api/field/attendance") == "/api/field/attendance"


def test_meetings_and_procurement_are_denied_as_groups(svc):
    """These two do not over-match, so the coarser group denial is correct for them."""
    _, tools = svc
    assert tools._guard_path("/api/meetings") is not None
    assert tools._guard_path("/api/procurement/purchase-orders") is not None
    # …and the sanctioned reporting equivalents still work.
    assert tools._guard_path("/api/reporting/meetings") is None
    assert tools._guard_path("/api/reporting/project-section") is None


# ---------------------------------------------------------------------------
# Dot segments.
#
# Next.js resolves "." before routing, so /api/field/./attendance reaches the same
# handler as /api/field/attendance. The guards ran on the raw canonical string, so ONE
# character defeated every deny here: _group_of("/api/./meetings") returned "." rather
# than "meetings", and the literal path match missed too.
#
# Measured: FibreFlow's router does NOT resolve dot segments (curl --path-as-is returns
# 404, same as an unknown route), so this was not a live hole HERE. It is collapsed
# anyway because the guard must not read a different string than whatever routes the
# request — any proxy or client that normalises per RFC 3986 would make it one.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "/api/field/./attendance",
        "/api/./field/attendance",
        "/api/field/./././attendance",
        "/api/%2e/field/attendance",
        "/api/%252e/field/attendance",
    ],
)
def test_dot_segments_do_not_bypass_the_path_deny(svc, path):
    _, tools = svc
    assert tools._guard_path(path) is not None, path


@pytest.mark.parametrize(
    "path",
    ["/api/./meetings", "/api/./procurement/purchase-orders", "/api/meetings/./123"],
)
def test_dot_segments_do_not_bypass_the_group_deny(svc, path):
    _, tools = svc
    assert tools._guard_path(path) is not None, path


def test_dot_segments_do_not_break_a_LEGITIMATE_path(svc):
    """The mirror. Collapsing "." must not turn an allowed path into a refusal, or the
    fix above would be indistinguishable from denying everything."""
    _, tools = svc
    assert tools._guard_path("/api/reporting/./meetings") is None
    assert tools._guard_path("/api/field-stock/./reports/daily-reconciliation") is None


def test_double_dot_is_still_REFUSED_not_resolved(svc):
    """`..` must stay a refusal rather than being collapsed away: resolving it would
    silently accept /api/staff/../field/x, which reads as a denied path."""
    _, tools = svc
    assert tools._guard_path("/api/staff/../field/workers") is not None
    assert tools._guard_path("/api/field/attendance/../attendance") is not None


def test_canonical_keeps_a_dotted_filename_intact(svc):
    """Only whole "." SEGMENTS are dropped — a dot inside a segment is data."""
    _, tools = svc
    assert tools._canonical("/api/photos/a.b.jpg") == "/api/photos/a.b.jpg"


# ---------------------------------------------------------------------------
# Path SHAPE.
#
# The denylists match a canonical path against a literal, so any trailing byte that is
# not "/" slipped past both of them: _group_of("/api/meetings\x00") is "meetings\x00",
# which != "meetings", and "/api/field/attendance." is neither equal to the denied path
# nor prefixed by it. FibreFlow's stack happens to 400/404 those today, so nothing was
# reachable — but that is upstream leniency this module does not control.
#
# Enumerating bad bytes is a losing game, so _malformed states what a path may contain
# and refuses the rest.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "/api/field/attendance\x00",
        "/api/field/attendance.",
        "/api/field/attendance ",
        "/api/field/attendance\t",
        "/api/field/attendance\n",
        "/api/meetings\x00",
        "/api/meetings.",
        "/api/meetings\x7f",
    ],
)
def test_a_trailing_byte_cannot_walk_around_a_deny(svc, path):
    _, tools = svc
    assert tools._guard_path(path) is not None, path


def test_a_fragment_is_refused_rather_than_letting_the_checks_disagree(svc):
    """_denied_path stripped "#" and _group_of did not, so the two disagreed about where
    the path ended. A fragment never reaches the wire anyway — urllib drops it — so it is
    only ever a way to make the guards read different strings."""
    _, tools = svc
    assert tools._guard_path("/api/other#/api/field/attendance") is not None


@pytest.mark.parametrize(
    "path",
    ["/api/field\\attendance", "/api/fiel／attendance", "/api/meetings;x=1", "/api/meetings%00"],
)
def test_odd_separators_and_params_are_refused(svc, path):
    _, tools = svc
    assert tools._guard_path(path) is not None, path


@pytest.mark.parametrize(
    "path",
    [
        "/api/reporting/meetings",
        "/api/reporting/attendance?since=2026-01-01&person=ab",
        "/api/field-stock/reports/daily-reconciliation",
        "/api/field/workers",
        "/api/photos/a.b.jpg",
        "/api/qfield/project-stats",
        "/api/sow/drops/search",
        "/api/reporting/project-section/",
    ],
)
def test_LEGITIMATE_paths_still_pass_the_shape_check(svc, path):
    """The mirror, and the one that matters most.

    A shape guard that refused everything would satisfy every assertion above. These are
    real paths the sanctioned tools call, including a query string, a hyphenated group, a
    dotted filename and a trailing slash.
    """
    _, tools = svc
    assert tools._guard_path(path) is None, path
