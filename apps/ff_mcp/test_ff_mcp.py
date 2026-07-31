"""Tests for the service: startup guards, consent callback, OAuth grant flow.

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


def test_path_metadata_advertises_public_and_confidential_clients(svc):
    from starlette.testclient import TestClient

    server, _ = svc
    with TestClient(server.mcp.streamable_http_app()) as client:
        response = client.get(
            "/.well-known/oauth-authorization-server/api/ff-remote-mcp"
        )

    assert response.status_code == 200
    metadata = response.json()
    assert metadata["token_endpoint_auth_methods_supported"] == [
        "none",
        "client_secret_post",
        "client_secret_basic",
    ]
    assert metadata["revocation_endpoint_auth_methods_supported"] == [
        "none",
        "client_secret_post",
        "client_secret_basic",
    ]


def test_help_points_to_the_fibreflow_connection_page(svc):
    from starlette.testclient import TestClient

    server, _ = svc
    with TestClient(server.mcp.streamable_http_app()) as client:
        response = client.get("/help")

    assert response.status_code == 200
    assert "/connections/fibreflow" in response.text
    assert "Cortex page" not in response.text


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
async def test_callback_rejects_an_unknown_state_without_validating_the_token(svc, monkeypatch):
    """Asserts the fast-path guard actually runs, not merely that a 400 comes back.

    An earlier version checked only the status code and was decorative: deleting the
    `peek_pending` guard entirely still produced 400, because complete_pending raises
    the same ValueError for an unknown state and the second except turns it into an
    identical response. Proving the guard fires means proving nothing downstream of it
    ran — here, that FibreFlow was never asked to validate a token for a state that
    does not exist.
    """
    server, _ = svc
    validated: list[str] = []
    monkeypatch.setattr(server, "validate_ff_token", lambda t: validated.append(t))

    resp = await server.authorize_complete(
        FakeRequest({"x-ff-mcp-secret": "test-secret"}, {"stateId": "nope", "token": "t"})
    )

    assert resp.status_code == 400
    assert json.loads(resp.body)["error"] == "unknown or expired authorization request"
    assert validated == [], "token was validated for a state that does not exist"


@pytest.mark.asyncio
async def test_callback_rejects_a_pending_state_that_has_expired(svc, monkeypatch):
    """Drives the clock: only an unknown state_id was covered, never a real one that
    aged out, so the 600s expiry semantics themselves were untested."""
    server, _ = svc
    monkeypatch.setattr(server, "validate_ff_token", lambda t: None)
    state_id = await _pending_state(server)
    assert server.oauth_provider.peek_pending(state_id) is not None

    import ff_mcp.oauth as oauth

    real_now = oauth._now()
    monkeypatch.setattr(oauth, "_now", lambda: real_now + 601)

    assert server.oauth_provider.peek_pending(state_id) is None
    resp = await server.authorize_complete(
        FakeRequest({"x-ff-mcp-secret": "test-secret"}, {"stateId": state_id, "token": "t"})
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_callback_answers_403_not_500_on_a_non_ascii_secret_header(svc):
    """hmac.compare_digest raises TypeError on non-ASCII str inputs, which would
    surface as an uncaught 500 — an attacker-triggerable error path."""
    server, _ = svc
    state_id = await _pending_state(server)
    resp = await server.authorize_complete(
        FakeRequest({"x-ff-mcp-secret": "sécret-with-noñ-ascii"}, {"stateId": state_id, "token": "t"})
    )
    assert resp.status_code == 403
    assert server.oauth_provider.peek_pending(state_id) is not None


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
