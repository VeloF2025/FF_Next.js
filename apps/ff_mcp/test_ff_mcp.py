"""Tests for the FibreFlow Remote MCP service.

Run with:  FF_MCP_CALLBACK_SECRET=test-secret python3 -m pytest apps/ff_mcp/ -q

Covers the security-relevant behaviour: the callback secret check, single-use
authorization state, the path/denylist guards, response truncation, and the rate limit.
The OAuth provider's code/token exchange is exercised end to end through the provider
API rather than mocked, so a change that breaks the grant flow fails here.
"""

from __future__ import annotations

import json
import os
import urllib.error
from pathlib import Path

import pytest

os.environ.setdefault("FF_MCP_CALLBACK_SECRET", "test-secret")


@pytest.fixture()
def svc(tmp_path, monkeypatch):
    """Import the service against a scratch store, isolated per test.

    config is evicted along with the rest: it reads the environment at import time, so
    leaving it cached would silently ignore the env this fixture just set.
    """
    monkeypatch.setenv("FF_MCP_CALLBACK_SECRET", "test-secret")
    monkeypatch.setenv("FF_REMOTE_MCP_STORE", str(tmp_path / "oauth.json"))
    monkeypatch.setenv("FF_APP_BASE", "https://dev.fibreflow.app")
    import importlib
    import sys

    for name in ("ff_mcp.server", "ff_mcp.tools", "ff_mcp.oauth", "ff_mcp.config"):
        sys.modules.pop(name, None)

    server = importlib.import_module("ff_mcp.server")
    tools = importlib.import_module("ff_mcp.tools")
    return server, tools


# --------------------------------------------------------------------------- startup


def _import_fresh():
    """Import the service from scratch, so its module-level startup guard runs.

    ff_mcp.config MUST be evicted too — that is where the guard lives. Evicting only
    server/tools made these tests order-dependent: run after any test that had already
    imported config successfully, the import hit the cache, nothing executed, and the
    test passed while asserting nothing.
    """
    import importlib
    import sys

    for name in ("ff_mcp.server", "ff_mcp.tools", "ff_mcp.oauth", "ff_mcp.config"):
        sys.modules.pop(name, None)
    return importlib.import_module("ff_mcp.server")


def test_refuses_to_start_without_a_secret(tmp_path, monkeypatch):
    monkeypatch.delenv("FF_MCP_CALLBACK_SECRET", raising=False)
    monkeypatch.setenv("FF_REMOTE_MCP_STORE", str(tmp_path / "oauth.json"))
    with pytest.raises(RuntimeError, match="FF_MCP_CALLBACK_SECRET"):
        _import_fresh()


def test_refuses_to_start_on_a_whitespace_secret(tmp_path, monkeypatch):
    monkeypatch.setenv("FF_MCP_CALLBACK_SECRET", "   ")
    monkeypatch.setenv("FF_REMOTE_MCP_STORE", str(tmp_path / "oauth.json"))
    with pytest.raises(RuntimeError, match="FF_MCP_CALLBACK_SECRET"):
        _import_fresh()


def test_default_urls_are_https(svc):
    server, _ = svc
    assert server._HTTPS == "https://"
    metadata = server._oauth_metadata()
    assert metadata["issuer"].startswith("https://")
    assert metadata["registration_endpoint"].endswith("/register")
    assert set(metadata["grant_types_supported"]) == {"authorization_code", "refresh_token"}
    assert metadata["scopes_supported"] == ["fibreflow.read"]


# ------------------------------------------------------------------- consent redirect


@pytest.mark.asyncio
async def test_authorize_redirects_to_the_fibreflow_consent_page(svc):
    server, _ = svc
    from mcp.server.auth.provider import AuthorizationParams
    from mcp.shared.auth import OAuthClientInformationFull
    from pydantic import AnyUrl

    client = OAuthClientInformationFull(
        client_id="c1", client_secret="s", redirect_uris=[AnyUrl("https://claude.ai/cb")]
    )
    params = AuthorizationParams(
        state="st",
        scopes=["fibreflow.read"],
        code_challenge="chal",
        redirect_uri=AnyUrl("https://claude.ai/cb"),
        redirect_uri_provided_explicitly=True,
    )
    url = await server.oauth_provider.authorize(client, params)

    # Must land on the app host (where the session cookie lives), not the proxy path.
    assert url.startswith("https://dev.fibreflow.app/mcp/authorize?state_id=")
    state_id = url.split("state_id=")[1]
    assert server.oauth_provider.peek_pending(state_id) is not None


# ------------------------------------------------------------------------- token check


def test_validate_token_uses_an_authenticated_endpoint_not_health(svc, monkeypatch):
    """/api/health is unauthenticated and 200s for anything — validating there would
    bind a garbage token to a live grant."""
    server, _ = svc
    seen = {}

    class FakeResp:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(req, timeout=0):
        seen["url"] = req.full_url
        seen["auth"] = req.headers.get("Authorization")
        return FakeResp()

    monkeypatch.setattr(server.urllib.request, "urlopen", fake_urlopen)
    server.validate_ff_token("tok123")

    assert seen["url"] == "https://dev.fibreflow.app/api/auth/me"
    assert "/api/health" not in seen["url"]
    assert seen["auth"] == "Bearer tok123"


def test_validate_token_raises_on_401(svc, monkeypatch):
    server, _ = svc

    def fake_urlopen(req, timeout=0):
        raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {}, None)

    monkeypatch.setattr(server.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(ValueError, match="401"):
        server.validate_ff_token("bad")


# ----------------------------------------------------------------------- the callback


class FakeRequest:
    def __init__(self, headers: dict, body: dict | None):
        self.headers = headers
        self._body = body

    async def json(self):
        if self._body is None:
            raise ValueError("no body")
        return self._body


async def _pending_state(server):
    from mcp.server.auth.provider import AuthorizationParams
    from mcp.shared.auth import OAuthClientInformationFull
    from pydantic import AnyUrl

    client = OAuthClientInformationFull(
        client_id="c1", client_secret="s", redirect_uris=[AnyUrl("https://claude.ai/cb")]
    )
    params = AuthorizationParams(
        state="st",
        scopes=["fibreflow.read"],
        code_challenge="chal",
        redirect_uri=AnyUrl("https://claude.ai/cb"),
        redirect_uri_provided_explicitly=True,
    )
    url = await server.oauth_provider.authorize(client, params)
    return url.split("state_id=")[1]


@pytest.mark.asyncio
async def test_callback_rejects_a_wrong_secret(svc):
    server, _ = svc
    state_id = await _pending_state(server)
    resp = await server.authorize_complete(
        FakeRequest({"x-ff-mcp-secret": "wrong"}, {"stateId": state_id, "token": "t"})
    )
    assert resp.status_code == 403
    # The state must survive a failed callback — it was never authorized.
    assert server.oauth_provider.peek_pending(state_id) is not None


@pytest.mark.asyncio
async def test_callback_rejects_a_missing_secret(svc):
    server, _ = svc
    state_id = await _pending_state(server)
    resp = await server.authorize_complete(FakeRequest({}, {"stateId": state_id, "token": "t"}))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_callback_rejects_an_unknown_state(svc, monkeypatch):
    server, _ = svc
    monkeypatch.setattr(server, "validate_ff_token", lambda t: None)
    resp = await server.authorize_complete(
        FakeRequest({"x-ff-mcp-secret": "test-secret"}, {"stateId": "nope", "token": "t"})
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_callback_rejects_a_token_fibreflow_refuses(svc, monkeypatch):
    server, _ = svc
    state_id = await _pending_state(server)

    def reject(_token):
        raise ValueError("Token rejected by FibreFlow: HTTP 401")

    monkeypatch.setattr(server, "validate_ff_token", reject)
    resp = await server.authorize_complete(
        FakeRequest({"x-ff-mcp-secret": "test-secret"}, {"stateId": state_id, "token": "bad"})
    )
    assert resp.status_code == 400
    # Not consumed: a rejected token must leave the request retryable, not burn it.
    assert server.oauth_provider.peek_pending(state_id) is not None


@pytest.mark.asyncio
async def test_callback_succeeds_once_and_the_state_is_single_use(svc, monkeypatch):
    server, _ = svc
    monkeypatch.setattr(server, "validate_ff_token", lambda t: None)
    state_id = await _pending_state(server)

    first = await server.authorize_complete(
        FakeRequest({"x-ff-mcp-secret": "test-secret"}, {"stateId": state_id, "token": "good"})
    )
    assert first.status_code == 200
    payload = json.loads(first.body)
    assert payload["redirectUrl"].startswith("https://claude.ai/cb?code=")
    assert "state=st" in payload["redirectUrl"]

    # Replay of the same state_id must fail — otherwise a leaked callback body mints twice.
    replay = await server.authorize_complete(
        FakeRequest({"x-ff-mcp-secret": "test-secret"}, {"stateId": state_id, "token": "good"})
    )
    assert replay.status_code == 400


@pytest.mark.asyncio
async def test_granted_code_exchanges_for_a_token_carrying_the_ff_credential(svc, monkeypatch):
    """The whole point of the flow: the minted FibreFlow token must survive into the
    access token the connector then presents."""
    server, _ = svc
    monkeypatch.setattr(server, "validate_ff_token", lambda t: None)
    from mcp.shared.auth import OAuthClientInformationFull
    from pydantic import AnyUrl

    state_id = await _pending_state(server)
    resp = await server.authorize_complete(
        FakeRequest({"x-ff-mcp-secret": "test-secret"}, {"stateId": state_id, "token": "ff-tok"})
    )
    code = json.loads(resp.body)["redirectUrl"].split("code=")[1].split("&")[0]

    client = OAuthClientInformationFull(
        client_id="c1", client_secret="s", redirect_uris=[AnyUrl("https://claude.ai/cb")]
    )
    auth_code = await server.oauth_provider.load_authorization_code(client, code)
    assert auth_code is not None and auth_code.ff_token == "ff-tok"

    token = await server.oauth_provider.exchange_authorization_code(client, auth_code)
    access = await server.oauth_provider.load_access_token(token.access_token)
    assert access is not None and access.ff_token == "ff-tok"

    # And the code is burned.
    assert await server.oauth_provider.load_authorization_code(client, code) is None


# ----------------------------------------------------------------------------- tools


def test_list_endpoints_caps_rows_and_reports_the_true_total(svc):
    _, tools = svc
    out = json.loads(tools.list_endpoints())
    assert out["shown"] <= tools.MAX_ROWS
    assert out["matched"] >= out["shown"]
    if out["matched"] > tools.MAX_ROWS:
        assert out["truncated"] is True
        assert str(out["matched"]) in out["note"]


def test_list_endpoints_filters_by_group(svc):
    _, tools = svc
    out = json.loads(tools.list_endpoints(group="projects"))
    assert out["matched"] > 0
    assert all(r["group"] == "projects" for r in out["routes"])


def test_list_endpoints_says_so_when_nothing_matches(svc):
    _, tools = svc
    out = json.loads(tools.list_endpoints(filter="zzzz-no-such-endpoint"))
    assert out["matched"] == 0
    assert "note" in out


def test_catalogue_contains_no_denied_group(svc):
    _, tools = svc
    for route in tools._load_routes():
        assert tools._denied_group(route["group"]) is None, route["path"]


def test_describe_endpoint_extracts_path_params(svc):
    _, tools = svc
    target = next(
        r["path"] for r in tools._load_routes() if ":" in r["path"]
    )
    out = json.loads(tools.describe_endpoint(target))
    assert out["path"] == target
    assert out["pathParams"]


def test_describe_endpoint_reports_an_unknown_path(svc):
    _, tools = svc
    out = json.loads(tools.describe_endpoint("/api/does-not-exist"))
    assert "error" in out


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

    out = json.loads(tools.fibreflow_get(bad))
    assert expected in out["error"], out
    assert called["n"] == 0


@pytest.mark.parametrize(
    "denied",
    ["/api/accounting/ledger", "/api/staff/list", "/api/staff-documents/1", "/api/my/payslips"],
)
def test_fibreflow_get_refuses_denied_groups_with_a_stop_signal(svc, denied):
    _, tools = svc
    out = json.loads(tools.fibreflow_get(denied))
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
    body = tools.fibreflow_get("/api/projects", "limit=5")

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
    out = json.loads(tools.fibreflow_get("/api/projects"))

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
    out = json.loads(tools.fibreflow_get("/api/projects"))

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
        assert "Rate limit" not in tools.fibreflow_get("/api/projects")

    over = json.loads(tools.fibreflow_get("/api/projects"))
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
        tools.fibreflow_get("/api/projects")
    assert "Rate limit" in json.loads(tools.fibreflow_get("/api/projects"))["error"]

    # A second user's connection must be unaffected.
    monkeypatch.setattr(tools, "_access_token", lambda: "bbbbbbbbbbbbbbbbbbbb")
    assert "Rate limit" not in tools.fibreflow_get("/api/projects")


def test_fibreflow_get_without_a_credential_explains_how_to_reconnect(svc, monkeypatch):
    _, tools = svc
    tools._call_times.clear()
    monkeypatch.setattr(tools, "get_access_token", lambda: None)
    out = json.loads(tools.fibreflow_get("/api/projects"))
    assert "Reconnect" in out["error"]


def test_catalogue_ships_with_the_package(svc):
    _, tools = svc
    assert Path(tools.CATALOGUE_PATH).exists()
    assert len(tools._load_routes()) > 100
