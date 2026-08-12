"""FibreFlow Remote MCP service — exposes FibreFlow's read-only HTTP API to Claude.

Runs as an OAuth 2.1 authorization server (via FastMCP's ``auth_server_provider``)
bound to 127.0.0.1; the only public path is FibreFlow's edge proxy at
``/api/ff-remote-mcp/*``. A user adds the connector in claude.ai, is sent to
FibreFlow's own consent page, clicks Allow, and FibreFlow calls back here with a
read-only token minted for THAT user. Every tool call then runs as them, with their
permissions, through the same RBAC the app uses.

This service is NOT a privileged actor. It holds a per-user token and the callback
secret, and nothing else — no JWT_SECRET, no database connection, no service
credential. If a tool needs data the user cannot see, the answer is "no".

Layout: config.py (settings + the startup secret guard), oauth.py (the authorization
server, copied from Cortex), catalogue.py (endpoint discovery), tools.py (the read
tool and its path guards), this file (the HTTP surface).
"""

from __future__ import annotations

import hmac
import urllib.error
import urllib.parse
import urllib.request

import anyio.to_thread
from mcp.server.auth.settings import AuthSettings, ClientRegistrationOptions, RevocationOptions
from mcp.server.fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse

from .config import (
    CALLBACK_SECRET,
    FF_APP_BASE,
    LISTEN_HOST,
    LISTEN_PORT,
    REMOTE_PUBLIC_BASE,
    REMOTE_STORE_PATH,
    SCOPE,
    _HTTPS,
)
from .oauth import FibreFlowOAuthProvider

oauth_provider = FibreFlowOAuthProvider(REMOTE_STORE_PATH)


def _create_mcp() -> FastMCP:
    return FastMCP(
        "fibreflow",
        host=LISTEN_HOST,
        port=LISTEN_PORT,
        streamable_http_path="/mcp",
        stateless_http=True,
        auth_server_provider=oauth_provider,
        auth=AuthSettings(
            issuer_url=REMOTE_PUBLIC_BASE,
            service_documentation_url=REMOTE_PUBLIC_BASE + "/help",
            client_registration_options=ClientRegistrationOptions(
                enabled=True,
                client_secret_expiry_seconds=None,
                valid_scopes=[SCOPE],
                default_scopes=[SCOPE],
            ),
            revocation_options=RevocationOptions(enabled=True),
            required_scopes=[SCOPE],
            resource_server_url=REMOTE_PUBLIC_BASE + "/mcp",
        ),
    )


mcp = _create_mcp()


def validate_ff_token(token: str) -> None:
    """Prove the token authenticates against FibreFlow, or raise.

    Calls GET /api/auth/me, NOT /api/health: health is unauthenticated and returns 200
    for any Authorization header (or none), so checking it would accept a garbage token
    and bind it to a live OAuth grant. /api/auth/me sits behind withAuth, which resolves
    the session row and 401s when it is missing, expired, or revoked.
    """
    req = urllib.request.Request(
        FF_APP_BASE + "/api/auth/me",
        headers={"Authorization": "Bearer " + token, "User-Agent": "ff-remote-mcp-oauth/0.1"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status != 200:
                raise ValueError("FibreFlow returned HTTP " + str(resp.status))
    except urllib.error.HTTPError as exc:
        raise ValueError("Token rejected by FibreFlow: HTTP " + str(exc.code)) from exc
    except urllib.error.URLError as exc:
        raise ValueError("FibreFlow unreachable: " + str(exc.reason)) from exc


@mcp.custom_route("/authorize/complete", methods=["POST"])
async def authorize_complete(request: Request):
    """Callback from FibreFlow's /api/mcp/consent, carrying the freshly minted token.

    Localhost-bound and secret-authenticated. Deliberately terse in its responses: a
    caller that fails the secret check learns nothing about whether the state existed.
    """
    # Compare as BYTES: hmac.compare_digest raises TypeError on str inputs containing
    # non-ASCII, which would surface as an uncaught 500 instead of a clean 403 — an
    # attacker-triggerable error path, and a noisier signal than the deliberate silence
    # below.
    supplied = request.headers.get("x-ff-mcp-secret", "").encode("utf-8", "surrogateescape")
    if not hmac.compare_digest(supplied, CALLBACK_SECRET.encode("utf-8")):
        # Logged loudly: on a localhost-only listener this should be unreachable, so a
        # hit here means either a misconfigured secret or something running locally that
        # should not be.
        print("[ff-remote-mcp] REJECTED /authorize/complete: bad or missing secret", flush=True)
        return JSONResponse({"error": "forbidden"}, status_code=403)

    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid JSON body"}, status_code=400)

    state_id = str(body.get("stateId", "")).strip()
    token = str(body.get("token", "")).strip()
    if not state_id or not token:
        return JSONResponse({"error": "stateId and token are required"}, status_code=400)

    if oauth_provider.peek_pending(state_id) is None:
        return JSONResponse({"error": "unknown or expired authorization request"}, status_code=400)

    try:
        # On a worker thread: validate_ff_token does blocking HTTP with a 15s timeout,
        # and this handler runs on the single shared event loop.
        await anyio.to_thread.run_sync(validate_ff_token, token)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)

    try:
        redirect_uri, code, pending_state = oauth_provider.complete_pending(state_id, token)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)

    params = {"code": code}
    if pending_state is not None:
        params["state"] = pending_state
    return JSONResponse({"redirectUrl": redirect_uri + "?" + urllib.parse.urlencode(params)})


def _oauth_metadata() -> dict:
    return {
        "issuer": REMOTE_PUBLIC_BASE,
        "authorization_endpoint": REMOTE_PUBLIC_BASE + "/authorize",
        "token_endpoint": REMOTE_PUBLIC_BASE + "/token",
        "registration_endpoint": REMOTE_PUBLIC_BASE + "/register",
        "scopes_supported": [SCOPE],
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "token_endpoint_auth_methods_supported": [
            "none",
            "client_secret_post",
            "client_secret_basic",
        ],
        "service_documentation": REMOTE_PUBLIC_BASE + "/help",
        "revocation_endpoint": REMOTE_PUBLIC_BASE + "/revoke",
        "revocation_endpoint_auth_methods_supported": [
            "none",
            "client_secret_post",
            "client_secret_basic",
        ],
        "code_challenge_methods_supported": ["S256"],
    }


@mcp.custom_route("/.well-known/openid-configuration", methods=["GET"])
async def openid_configuration(request: Request):
    """Claude's Add-connector flow probes this OIDC alias before dynamic registration."""
    return JSONResponse(_oauth_metadata(), headers={"Cache-Control": "public, max-age=3600"})


@mcp.custom_route(
    "/.well-known/oauth-authorization-server/api/ff-remote-mcp", methods=["GET"]
)
async def oauth_authorization_server_with_path(request: Request):
    """Compatibility alias for clients using RFC 8414 path-based discovery."""
    return JSONResponse(_oauth_metadata(), headers={"Cache-Control": "public, max-age=3600"})


@mcp.custom_route("/help", methods=["GET"])
async def remote_help(request: Request):
    return HTMLResponse(
        "<!doctype html><html><head><meta charset='utf-8'><title>FibreFlow MCP</title></head>"
        "<body style=\"font-family:system-ui,sans-serif;max-width:760px;margin:48px auto;"
        'padding:0 20px;line-height:1.45"><h1>FibreFlow MCP</h1>'
        "<p>Add this URL as a custom connector in Claude: <code>"
        + REMOTE_PUBLIC_BASE
        + "/mcp</code></p><p>Access is read-only and scoped to your own FibreFlow "
        "permissions. Manage or revoke it from <a href=\""
        + FF_APP_BASE
        + '/connections/fibreflow">AI Connections in FibreFlow</a>.</p>'
        "</body></html>"
    )


# Tool registration lives in tools.py; importing it binds the tools to `mcp`.
from . import catalogue as _catalogue  # noqa: E402,F401  (import for side effects)
from . import tools as _tools  # noqa: E402,F401  (import for side effects)
from . import qfield_tools as _qfield_tools  # noqa: E402,F401  (import for side effects)
from . import photo_tools as _photo_tools  # noqa: E402,F401  (import for side effects)
from . import photo_search_tools as _photo_search_tools  # noqa: E402,F401  (side effects)
from . import reporting_tools as _reporting_tools  # noqa: E402,F401  (side effects)
