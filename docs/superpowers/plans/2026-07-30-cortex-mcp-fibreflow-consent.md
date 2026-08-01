# Cortex MCP FibreFlow Consent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Claude authorize the read-only Cortex remote MCP connector through a verified FibreFlow login and consent screen, while preserving FibreFlow MCP RBAC, marked-compatible Cortex OAuth grants, ordinary-user ACL narrowing, and an unlinked manual rollback route. Unsafe unmarked grants fail closed and require re-consent.

**Architecture:** Cortex remains its own OAuth authorization server and records a ten-minute pending request, but redirects the browser to FibreFlow for authentication and consent. FibreFlow mints a 90-day Cortex bearer for the verified session email and hands it to Cortex over loopback with a connector-specific shared secret; Cortex validates the bearer against Bridge before atomically converting the pending request into an OAuth code. The outer Cortex OAuth refresh grant expires after 30 days, so the user must complete browser reauthorization then even though that underlying bearer has a 90-day claim. FibreFlow connector setup moves to `/connections/*`, while `/cortex` remains the knowledge search/review surface.

**Tech Stack:** Next.js 14 Pages Router, React 18, TypeScript, FibreFlow PostgreSQL RBAC middleware, Vitest/Testing Library, Playwright, Python 3.11+, FastMCP OAuth provider APIs, Starlette, Pytest, systemd user services.

## Global Constraints

- The approved design at `docs/superpowers/specs/2026-07-30-cortex-mcp-fibreflow-consent-design.md` is the source of truth; do not reopen the architecture or UI split during implementation.
- Preserve the existing FibreFlow MCP authorization route, endpoint catalogue, session storage, OAuth/RBAC behavior, and server-enforced read-only policy.
- Cortex must use FibreFlow login and consent in the normal remote workflow; the browser sends only `{ stateId }` and never supplies an email, role, token, callback URL, or redirect URL.
- Identity comes only from the verified FibreFlow session: `req.user.email`.
- Preserve every existing `CORTEX_SUPER_ADMIN_EMAILS` entry. The exact
  `lew@velocityfibre.co.za` address and every configured entry must receive
  tenant-bound full Cortex reads, including meeting detail and minutes packs. This
  is a distinct read capability: do not add Lew to `CORTEX_MEETING_ADMIN_EMAILS`,
  and do not enable classify, legal-hold, process, intake, action, delivery, or any
  other write.
- Cortex MCP remains read-only; its exact existing tool set must not gain write, approve, ingest, administration, or mutation tools.
- Use `CORTEX_MCP_CALLBACK_SECRET`; do not reuse `FF_MCP_CALLBACK_SECRET`, and never put either secret in tracked files, URLs, browser responses, logs, commits, or PR text.
- Keep Cortex `/authorize/approve` temporarily as an unlinked operator rollback path; normal `authorize()` must never return that route.
- Preserve Cortex OAuth store keys, serialized model fields, and `ctxc_`/`ctxa_`/`ctxr_` token prefixes. Existing authorization codes, access tokens, and refresh tokens remain valid only when the embedded Cortex bearer has exact `token_use="mcp"`. Unsafe unmarked credentials fail closed, are narrowly invalidated or consumed when presented, and require re-consent; do not grandfather them.
- Use the existing horizontal `ModuleNav` for `/connections/fibreflow` and `/connections/cortex`; do not add a sidebar subtree.
- Remove connector panels from `/cortex`, retain hero/search/review, and add a permission-gated link to `/connections/cortex`.
- Use TDD: observe the relevant test fail before adding each implementation, then rerun it green.
- Tests exercise real production components, handlers, middleware and provider
  behavior. Do not mock application components or assert on mock/spies/source
  text. Use a narrow in-memory adapter or loopback test server only where an
  external boundary such as HTTP, browser navigation, time, or a process cannot
  be made real; assert observable output and captured wire behavior.
- FibreFlow verification includes focused Vitest, existing MCP consent/proxy suites, `npm run ci:quick`, `npm run build`, desktop/mobile Playwright, and a real dev connector flow.
- Cortex verification includes focused Pytest, the exact read-only tool test, Ruff, ty, package import checks, and the repository CI script.
- Real dev OAuth uses an isolated Agent Executor on `17406`, an isolated Bridge on `17403` with `EXECUTOR_URL=http://127.0.0.1:17406`, Remote MCP on `17414`, a unique non-production OAuth store, and `https://dev.fibreflow.app/api/cortex-remote-mcp` as its public base. The isolated Bridge must never call the production executor on `7406`; never repoint production port `7414`, its OAuth store, or its public authorization flow.
- Do not modify live environment files, restart services, deploy production, or change Lew's live access until both PRs are reviewed and Hein explicitly approves that rollout gate.
- FibreFlow production deployment is after hours only and always uses `bash scripts/deploy-local.sh production`; Cortex production deployment uses its supported `scripts/deploy_bridge.sh` path.
- All source changes go through the coordinated FibreFlow and Cortex PRs.

---

## Cross-repository interface

The two PRs must agree on this exact internal callback contract:

```http
POST http://127.0.0.1:7414/authorize/complete
Content-Type: application/json
X-Cortex-MCP-Secret: <server-only callback secret>

{"stateId":"<16-128 base64url chars>","token":"<90-day Cortex JWT>"}
```

Success:

```json
{
  "redirectUrl": "https://claude.ai/api/mcp/auth_callback?code=ctxc_generated&state=client-state"
}
```

The FibreFlow browser response remains:

```json
{
  "success": true,
  "data": {
    "redirectUrl": "https://claude.ai/api/mcp/auth_callback?code=ctxc_generated&state=client-state"
  },
  "meta": {
    "timestamp": "generated by apiResponse"
  }
}
```

Neither response contains the Cortex bearer or callback secret. Cortex validates the callback secret, pending state, redirect scheme, and bearer before consuming the pending state.

## File map

### Cortex PR

| Action | File | Responsibility |
|---|---|---|
| Create | `apps/cortex_mcp/cortex_mcp_oauth.py` | Existing OAuth models/provider plus pending-state peek and FibreFlow redirect |
| Create | `apps/cortex_mcp/cortex_mcp_callback.py` | Callback authentication, Bridge bearer validation and safe redirect construction |
| Create | `tests/test_cortex_mcp_oauth.py` | Provider/store compatibility and FibreFlow redirect tests |
| Create | `tests/test_cortex_mcp_callback.py` | Callback, replay, startup, loopback Bridge and token-redaction tests |
| Modify | `apps/cortex_mcp/server.py` | Wire the extracted provider, register `/authorize/complete`, retain unlinked `/authorize/approve`, and enforce remote-only configuration |
| Modify | `apps/cortex_mcp/pyproject.toml` | Package the focused OAuth/callback modules beside `server` |
| Modify | `tests/test_superadmin_bypass.py` | Prove Lew and an existing configured admin are full-scope while an ordinary user remains ACL-scoped |
| Modify | `.env.example` | Document remote MCP bases/store and the blank dedicated callback secret |
| Modify | `docs/cortex-mcp-connect.md` | Make the browser connector the normal workflow and retain local token configuration as an operator/stdio path |

### FibreFlow PR

| Action | File | Responsibility |
|---|---|---|
| Create | `pages/api/cortex/mcp-consent.ts` | Authenticated/permissioned Cortex mint and loopback callback |
| Create | `pages/api/cortex/__tests__/mcpConsent.testHarness.ts` | Real loopback callback/handler harness and deterministic external-boundary adapters |
| Create | `pages/api/cortex/__tests__/mcpConsent.handler.test.ts` | Identity, successful callback, wire contract and redaction tests |
| Create | `pages/api/cortex/__tests__/mcpConsent.errors.test.ts` | Method, validation, timeout, upstream and redirect failure tests |
| Create | `pages/cortex/mcp/authorize.tsx` | Standalone login-preserving Cortex consent controller |
| Create | `src/components/cortex/CortexMcpConsentCard.tsx` | Cortex-specific read-only consent presentation |
| Create | `tests/pages/cortex-mcp-authorize.test.tsx` | Hydration, login round-trip, duplicate-submit, cancel, and redirect tests |
| Create | `src/components/connections/ConnectionsNav.tsx` | Horizontal FibreFlow/Cortex `ModuleNav` |
| Create | `src/components/connections/ConnectorSetupCard.tsx` | Remote endpoint and Claude setup steps without credential material |
| Create | `src/components/connections/CortexConnectionPanel.tsx` | Cortex-specific sources, access explanation, and setup card |
| Move | `src/components/cortex/FibreFlowConnectPanel.tsx` → `src/components/connections/FibreFlowConnectionPanel.tsx` | FibreFlow setup, active sessions, revoke controls, collapsed manual mint |
| Move | `src/components/cortex/FibreFlowTokenList.tsx` → `src/components/connections/FibreFlowTokenList.tsx` | Active session table |
| Move | `src/components/cortex/FibreFlowTokenReveal.tsx` → `src/components/connections/FibreFlowTokenReveal.tsx` | One-time manual bearer reveal inside Advanced |
| Create | `src/components/connections/__tests__/ConnectionPanels.test.tsx` | Primary-flow copy, no-token assertions, sessions, revoke, and Advanced behavior |
| Create | `src/components/connections/__tests__/ConnectionsNav.test.tsx` | Tab labels, hrefs, and active route |
| Create | `pages/connections/fibreflow.tsx` | FibreFlow Operations page |
| Create | `pages/connections/cortex.tsx` | `cortex.review:view`-gated Cortex Knowledge page |
| Create | `pages/connections/index.tsx` | Server-side redirect to `/connections/fibreflow` |
| Create | `tests/pages/connections.test.tsx` | Page headings, permission gate, and redirect contract |
| Create | `tests/pages/cortex-page.test.tsx` | Hero/search/review retained; panels absent; connection link gated |
| Create | `tests/e2e/ai-connections.spec.ts` | Authenticated desktop/mobile route, content, responsive, and screenshot proof |
| Modify | `pages/cortex.tsx` | Remove panels/feature props and add the connection-page link |
| Modify | `src/components/layout/sidebar/config/cortexSection.ts` | Retain Cortex and add one AI Connections entry |
| Modify | `.env.example` | Document the blank dedicated secret and Cortex Remote MCP loopback URL |
| Delete | `src/components/cortex/CortexConnectPanel.tsx` | Remove the token-paste/local-runtime UI from the normal surface |
| Delete | `src/components/cortex/McpTokenReveal.tsx` | Remove its now-unreachable token/config renderer |
| Delete | `src/components/cortex/__tests__/CortexConnectPanel.test.tsx` | Remove tests for the retired primary UI; API rollback tests remain |

## Task 1: Establish the clean Cortex branch and extract the compatible OAuth provider

**Files:**
- Create: `/home/hein/Workspace/Cortex-cortex-mcp-ff-consent`
- Create: `apps/cortex_mcp/cortex_mcp_oauth.py`
- Create: `tests/test_cortex_mcp_oauth.py`
- Modify: `apps/cortex_mcp/server.py:15-155`
- Modify: `apps/cortex_mcp/pyproject.toml:10-12`

**Interfaces:**
- Consumes: FastMCP `OAuthAuthorizationServerProvider`, the existing JSON store at `CORTEX_REMOTE_MCP_STORE`, and the existing serialized `CortexAuthorizationCode`, `CortexAccessToken`, and `CortexRefreshToken` fields.
- Produces: `CortexOAuthProvider(store_path: Path, fibreflow_app_base: str)`, `peek_pending(pending_id: str) -> dict[str, object]`, and unchanged OAuth load/exchange/revoke behavior for `server.py`.

- [ ] **Step 1: Verify the source repositories and create the isolated Cortex worktree**

Run:

```bash
git -C /home/hein/Workspace/FF_Next.js-cortex-mcp-ff-consent status --short --branch
git -C /home/hein/Workspace/FF_Next.js-cortex-mcp-ff-consent fetch origin
git -C /home/hein/Workspace/Cortex status --short --branch
git -C /home/hein/Workspace/Cortex fetch origin
git -C /home/hein/Workspace/Cortex worktree add \
  /home/hein/Workspace/Cortex-cortex-mcp-ff-consent \
  -b feat/cortex-mcp-ff-consent origin/main
git -C /home/hein/Workspace/Cortex-cortex-mcp-ff-consent status --short --branch
```

Expected:

- FibreFlow reports only the already-committed spec/plan history.
- The primary Cortex checkout may remain dirty and ahead; do not modify or clean it.
- The new Cortex worktree reports branch `feat/cortex-mcp-ff-consent`, upstream `origin/main`, and no changed files.
- Before FibreFlow implementation starts, rebase its unpushed feature branch onto the freshly fetched `origin/master` from its clean worktree; stop and ask before rewriting it if the branch has been published.

- [ ] **Step 2: Write failing provider compatibility and redirect tests**

Create `tests/test_cortex_mcp_oauth.py` with a real temporary JSON store and these concrete assertions:

```python
from __future__ import annotations

import json
from pathlib import Path

import pytest
from mcp.server.auth.provider import AuthorizationParams
from mcp.shared.auth import OAuthClientInformationFull
from pydantic import AnyUrl

from apps.cortex_mcp.cortex_mcp_oauth import CortexOAuthProvider


def client() -> OAuthClientInformationFull:
    return OAuthClientInformationFull(
        client_id="claude-client",
        client_secret="client-secret",
        redirect_uris=[AnyUrl("https://claude.ai/api/mcp/auth_callback")],
        grant_types=["authorization_code", "refresh_token"],
        response_types=["code"],
        scope="cortex.read",
    )


def params() -> AuthorizationParams:
    return AuthorizationParams(
        state="claude-state",
        scopes=["cortex.read"],
        code_challenge="challenge",
        redirect_uri=AnyUrl("https://claude.ai/api/mcp/auth_callback"),
        redirect_uri_provided_explicitly=True,
        resource=None,
    )


@pytest.mark.asyncio
async def test_authorize_persists_pending_and_redirects_to_fibreflow(tmp_path: Path):
    provider = CortexOAuthProvider(
        tmp_path / "oauth.json",
        fibreflow_app_base="https://dev.fibreflow.app/",
    )

    redirect = await provider.authorize(client(), params())

    assert redirect.startswith(
        "https://dev.fibreflow.app/cortex/mcp/authorize?state_id="
    )
    assert "/authorize/approve" not in redirect
    pending_id = redirect.rsplit("=", 1)[1]
    pending = provider.peek_pending(pending_id)
    assert pending["client_id"] == "claude-client"
    assert pending["state"] == "claude-state"
    assert pending["scopes"] == ["cortex.read"]
    assert pending["expires_at"] > 0


def test_peek_pending_does_not_consume_retryable_state(tmp_path: Path):
    provider = CortexOAuthProvider(
        tmp_path / "oauth.json",
        fibreflow_app_base="https://app.fibreflow.app",
    )
    provider.data["pending"]["state_abcdefghijklmnop"] = {
        "client_id": "claude-client",
        "scopes": ["cortex.read"],
        "code_challenge": "challenge",
        "redirect_uri": "https://claude.ai/api/mcp/auth_callback",
        "redirect_uri_provided_explicitly": True,
        "resource": None,
        "state": "claude-state",
        "expires_at": 4_102_444_800,
    }

    first = provider.peek_pending("state_abcdefghijklmnop")
    second = provider.peek_pending("state_abcdefghijklmnop")

    assert first == second
    assert "state_abcdefghijklmnop" in provider.data["pending"]


def test_existing_store_shape_loads_without_migration(tmp_path: Path):
    store = tmp_path / "oauth.json"
    original = {
        "clients": {},
        "pending": {},
        "codes": {},
        "access": {},
        "refresh": {},
    }
    store.write_text(json.dumps(original))

    provider = CortexOAuthProvider(
        store,
        fibreflow_app_base="https://app.fibreflow.app",
    )

    assert provider.data == original
```

Add one non-empty compatibility case that writes the current serialized shapes
for `ctxa_existing` and `ctxr_existing` with a real signed test bearer carrying
exact `token_use="mcp"`, reloads the provider, and asserts that
`load_access_token()`/`load_refresh_token()` preserve `client_id`, `scopes`,
`expires_at`, `resource`, and `cortex_token`. Add the complementary unmarked case:
it must fail closed, remove only the affected grant rows, and require re-consent.
The tests retain current token prefixes and field names without treating unsafe
legacy authority as compatible.

- [ ] **Step 3: Run the provider tests and observe the expected import failure**

Run:

```bash
cd /home/hein/Workspace/Cortex-cortex-mcp-ff-consent
uv run pytest tests/test_cortex_mcp_oauth.py -q
```

Expected: FAIL because `apps/cortex_mcp/cortex_mcp_oauth.py` does not exist.

- [ ] **Step 4: Extract the OAuth models/provider without changing persisted fields**

Create `apps/cortex_mcp/cortex_mcp_oauth.py`. Move the existing model classes and
provider methods from `server.py` into it without renaming serialized keys or token
prefixes. Preserve the existing protocol behavior except where the final Task 16B
security contract supersedes the historical bodies:

- `exchange_authorization_code()` must call the shared
  `has_unverified_mcp_token_marker()` precondition before minting. An unsafe code is
  persistently consumed and returns generic `invalid_grant` without issuing access or
  refresh tokens.
- `load_access_token()` and `load_refresh_token()` must reject an unsafe embedded
  bearer and atomically invalidate only the affected grant siblings. Modern rows use
  their shared `grant_id`; grant-less legacy rows match only the same unsafe embedded
  bearer.
- `exchange_refresh_token()` must repeat the marker precondition so a stale in-memory
  object cannot mint a new access token after deployment.
- Failed store saves restore the in-memory rows and fail closed. Errors and logs must
  never contain the embedded bearer.

Keep `get_client`, `register_client`, safe marked code/access/refresh behavior,
revocation, and `complete_pending` compatible with the preserved fields and prefixes.

Use these exact changed interfaces:

```python
STATE_ID_SHAPE = re.compile(r"^[A-Za-z0-9_-]{16,128}$")


class CortexOAuthProvider(
    OAuthAuthorizationServerProvider[
        CortexAuthorizationCode,
        CortexRefreshToken,
        CortexAccessToken,
    ]
):
    def __init__(self, store_path: Path, fibreflow_app_base: str):
        self.store_path = store_path
        self.fibreflow_app_base = fibreflow_app_base.rstrip("/")
        self.store_path.parent.mkdir(parents=True, exist_ok=True)
        self.data = self._load()

    async def authorize(
        self,
        client: OAuthClientInformationFull,
        params: AuthorizationParams,
    ) -> str:
        pending_id = secrets.token_urlsafe(24)
        self.data["pending"][pending_id] = {
            "client_id": client.client_id,
            "scopes": params.scopes or ["cortex.read"],
            "code_challenge": params.code_challenge,
            "redirect_uri": str(params.redirect_uri),
            "redirect_uri_provided_explicitly": (
                params.redirect_uri_provided_explicitly
            ),
            "resource": params.resource,
            "state": params.state,
            "expires_at": _now() + 600,
        }
        self._save()
        query = urllib.parse.urlencode({"state_id": pending_id})
        return f"{self.fibreflow_app_base}/cortex/mcp/authorize?{query}"

    def peek_pending(self, pending_id: str) -> dict[str, object]:
        if not STATE_ID_SHAPE.fullmatch(pending_id):
            raise ValueError("Authorization request is invalid.")
        pending = self.data["pending"].get(pending_id)
        if not isinstance(pending, dict) or pending.get("expires_at", 0) < _now():
            raise ValueError(
                "Authorization request expired. Return to Claude and click Connect again."
            )
        return pending
```

Update `apps/cortex_mcp/pyproject.toml` so installation includes both top-level modules:

```toml
[tool.setuptools]
py-modules = ["server", "cortex_mcp_oauth"]
```

Update `server.py` to import the extracted symbols from `cortex_mcp_oauth` and construct the provider with:

```python
CORTEX_FF_APP_BASE = os.environ.get(
    "CORTEX_FF_APP_BASE",
    _HTTPS + "app.fibreflow.app",
).rstrip("/")

_oauth_provider = (
    CortexOAuthProvider(REMOTE_STORE_PATH, CORTEX_FF_APP_BASE)
    if REMOTE_TRANSPORT
    else None
)
```

- [ ] **Step 5: Run compatibility tests**

Run:

```bash
uv run pytest tests/test_cortex_mcp_oauth.py tests/test_cortex_mcp.py -q
uv run python -c "import server; import cortex_mcp_oauth; print(server.mcp.name)"
```

Expected: both test files PASS and the package import prints `cortex`.

- [ ] **Step 6: Commit the provider extraction**

Run:

```bash
git add apps/cortex_mcp/cortex_mcp_oauth.py apps/cortex_mcp/server.py \
  apps/cortex_mcp/pyproject.toml tests/test_cortex_mcp_oauth.py
git commit -m "refactor(mcp): isolate Cortex OAuth provider"
```

## Task 2: Add the authenticated Cortex callback and fail-closed remote startup

**Files:**
- Create: `apps/cortex_mcp/cortex_mcp_callback.py`
- Modify: `apps/cortex_mcp/server.py`
- Modify: `apps/cortex_mcp/pyproject.toml`
- Modify: `tests/test_cortex_mcp_oauth.py`
- Create: `tests/test_cortex_mcp_callback.py`

**Interfaces:**
- Consumes: `POST /authorize/complete`, `X-Cortex-MCP-Secret`, `{stateId, token}`, Bridge `GET /api/query`, and `CortexOAuthProvider.peek_pending()`.
- Produces: `complete_authorization(request, provider, callback_secret, bridge_url) -> JSONResponse`, with pending state consumed only after successful bearer validation.

- [ ] **Step 1: Add failing callback, replay, redaction, and startup tests**

Add a real loopback `ThreadingHTTPServer` fixture to
`tests/test_cortex_mcp_callback.py`. It implements Bridge `GET /api/query`,
records the request path and Authorization header, and can return `200`, `401`,
or a delayed response. The fixture owns its thread and shuts it down after the
test. Do not replace `validate_cortex_token`, `asyncio.to_thread`, or
`secrets.compare_digest` with mocks.

Add request helpers and cases; the examples below use the loopback fixture as
`bridge_server`:

```python
import asyncio
import os
import subprocess
import sys

import jwt as pyjwt
from starlette.requests import Request

from apps.cortex_mcp.cortex_mcp_callback import complete_authorization


CALLBACK_SECRET = "test-cortex-callback-secret"
INVALID_CALLBACK_SECRET = CALLBACK_SECRET + "-invalid"
PENDING_ID = "state_abcdefghijklmnop"
TEST_JWT_SECRET = "test-callback-jwt-secret-at-least-32-bytes"
MARKED_BEARER = pyjwt.encode(
    {
        "sub": "callback-test@velocityfibre.co.za",
        "email": "callback-test@velocityfibre.co.za",
        "instance_id": "velocity-fibre",
        "token_use": "mcp",
    },
    TEST_JWT_SECRET,
    algorithm="HS256",
)
UNMARKED_BEARER = pyjwt.encode(
    {
        "sub": "callback-test@velocityfibre.co.za",
        "email": "callback-test@velocityfibre.co.za",
        "instance_id": "velocity-fibre",
    },
    TEST_JWT_SECRET,
    algorithm="HS256",
)


def request(body: bytes, secret: str = CALLBACK_SECRET) -> Request:
    sent = False

    async def receive():
        nonlocal sent
        if sent:
            return {"type": "http.request", "body": b"", "more_body": False}
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/authorize/complete",
        "headers": [
            (b"content-type", b"application/json"),
            (b"x-cortex-mcp-secret", secret.encode()),
        ],
    }
    return Request(scope, receive)


def seed_pending(provider: CortexOAuthProvider) -> None:
    provider.data["pending"][PENDING_ID] = {
        "client_id": "claude-client",
        "scopes": ["cortex.read"],
        "code_challenge": "challenge",
        "redirect_uri": "https://claude.ai/api/mcp/auth_callback?existing=1",
        "redirect_uri_provided_explicitly": True,
        "resource": None,
        "state": "claude-state",
        "expires_at": 4_102_444_800,
    }


@pytest.mark.asyncio
async def test_callback_rejects_bad_secret_without_touching_state(
    tmp_path: Path,
    bridge_server,
):
    provider = CortexOAuthProvider(
        tmp_path / "oauth.json",
        "https://app.fibreflow.app",
    )
    seed_pending(provider)

    with bridge_server(status=200) as bridge:
        response = await complete_authorization(
            request(
                json.dumps(
                    {"stateId": PENDING_ID, "token": MARKED_BEARER}
                ).encode(),
                secret=INVALID_CALLBACK_SECRET,
            ),
            provider,
            CALLBACK_SECRET,
            bridge.url,
        )

    assert response.status_code == 401
    assert bridge.path is None
    assert PENDING_ID in provider.data["pending"]
    assert MARKED_BEARER.encode() not in response.body


@pytest.mark.asyncio
async def test_rejected_bearer_keeps_pending_state_retryable(tmp_path: Path):
    provider = CortexOAuthProvider(
        tmp_path / "oauth.json",
        "https://app.fibreflow.app",
    )
    seed_pending(provider)

    with bridge_server(status=401) as bridge:
        response = await complete_authorization(
            request(
                json.dumps(
                    {"stateId": PENDING_ID, "token": MARKED_BEARER}
                ).encode()
            ),
            provider,
            CALLBACK_SECRET,
            bridge.url,
        )

    assert response.status_code == 401
    assert PENDING_ID in provider.data["pending"]
    assert provider.data["codes"] == {}
    assert MARKED_BEARER.encode() not in response.body


@pytest.mark.asyncio
async def test_unmarked_bearer_fails_before_bridge_and_keeps_state(
    tmp_path: Path,
):
    provider = CortexOAuthProvider(
        tmp_path / "oauth.json",
        "https://app.fibreflow.app",
    )
    seed_pending(provider)

    with bridge_server(status=200) as bridge:
        response = await complete_authorization(
            request(
                json.dumps(
                    {"stateId": PENDING_ID, "token": UNMARKED_BEARER}
                ).encode()
            ),
            provider,
            CALLBACK_SECRET,
            bridge.url,
        )

    assert response.status_code == 401
    assert bridge.path is None
    assert PENDING_ID in provider.data["pending"]
    assert provider.data["codes"] == {}
    assert UNMARKED_BEARER.encode() not in response.body


@pytest.mark.asyncio
async def test_success_consumes_once_and_returns_only_safe_redirect(tmp_path: Path):
    provider = CortexOAuthProvider(
        tmp_path / "oauth.json",
        "https://app.fibreflow.app",
    )
    seed_pending(provider)

    with bridge_server(status=200) as bridge:
        response = await complete_authorization(
            request(
                json.dumps(
                    {"stateId": PENDING_ID, "token": MARKED_BEARER}
                ).encode()
            ),
            provider,
            CALLBACK_SECRET,
            bridge.url,
        )

    payload = json.loads(response.body)
    assert response.status_code == 200
    assert set(payload) == {"redirectUrl"}
    assert payload["redirectUrl"].startswith(
        "https://claude.ai/api/mcp/auth_callback?existing=1&code=ctxc_"
    )
    assert "state=claude-state" in payload["redirectUrl"]
    assert PENDING_ID not in provider.data["pending"]
    assert len(provider.data["codes"]) == 1
    assert MARKED_BEARER not in json.dumps(payload)
    assert bridge.authorization == f"Bearer {MARKED_BEARER}"
    assert bridge.path.startswith("/api/query?")

    with bridge_server(status=200) as replay_bridge:
        replay = await complete_authorization(
            request(
                json.dumps(
                    {"stateId": PENDING_ID, "token": MARKED_BEARER}
                ).encode()
            ),
            provider,
            CALLBACK_SECRET,
            replay_bridge.url,
        )
    assert replay.status_code == 400
    assert replay_bridge.path is None
    assert len(provider.data["codes"]) == 1


def test_streamable_http_requires_callback_secret_but_stdio_does_not():
    base_env = os.environ.copy()
    base_env.pop("CORTEX_MCP_CALLBACK_SECRET", None)

    remote = subprocess.run(
        [sys.executable, "-c", "import apps.cortex_mcp.server"],
        cwd=Path(__file__).parent.parent,
        env={**base_env, "CORTEX_MCP_TRANSPORT": "streamable-http"},
        capture_output=True,
        text=True,
        check=False,
    )
    stdio = subprocess.run(
        [sys.executable, "-c", "import apps.cortex_mcp.server"],
        cwd=Path(__file__).parent.parent,
        env={**base_env, "CORTEX_MCP_TRANSPORT": "stdio"},
        capture_output=True,
        text=True,
        check=False,
    )

    assert remote.returncode != 0
    assert "CORTEX_MCP_CALLBACK_SECRET" in remote.stderr
    assert stdio.returncode == 0
```

Also add parametrized cases for:

```python
@pytest.mark.parametrize(
    ("body", "status"),
    [
        (b"not-json", 400),
        (b"[]", 400),
        (
            json.dumps(
                {"stateId": "short", "token": MARKED_BEARER}
            ).encode(),
            400,
        ),
        (json.dumps({"stateId": PENDING_ID}).encode(), 400),
        (json.dumps({"stateId": PENDING_ID, "token": ""}).encode(), 400),
    ],
)
```

Add:

- an expired-state case by seeding `expires_at=1`;
- an unsafe redirect case using `javascript:alert(1)` that asserts the pending
  state remains available and the loopback Bridge received no request;
- secret acceptance/rejection behavior through the real `secrets_match()` path;
- a delayed loopback Bridge case that starts `complete_authorization()` and a
  zero-delay coroutine together, proving the second coroutine advances before
  Bridge responds and bearer validation therefore did not block the event loop;
- a metadata regression asserting
  `grant_types_supported == ["authorization_code", "refresh_token"]`.

Constant-time byte comparison remains a code-review invariant: the
implementation must visibly call `secrets.compare_digest`. Do not write a test
that merely spies on that function call.

- [ ] **Step 2: Run the callback tests and observe the missing handler failures**

Run:

```bash
uv run pytest tests/test_cortex_mcp_callback.py -q
```

Expected: FAIL because `complete_authorization` and the remote startup guard do not exist.

- [ ] **Step 3: Implement callback authentication, validation, and safe redirect creation**

Add these functions to the focused `cortex_mcp_callback.py` module so both
production modules remain below 300 lines:

```python
from apps.cortex_mcp.cortex_mcp_tokens import has_unverified_mcp_token_marker


def secrets_match(provided: str, expected: str) -> bool:
    return secrets.compare_digest(
        provided.encode("utf-8"),
        expected.encode("utf-8"),
    )


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


NO_REDIRECT_OPENER = urllib.request.build_opener(_NoRedirectHandler())
BRIDGE_VALIDATION_TIMEOUT_SECONDS = 5.0


def validate_cortex_token(
    token: str,
    bridge_url: str,
    timeout: float = BRIDGE_VALIDATION_TIMEOUT_SECONDS,
) -> None:
    if not has_unverified_mcp_token_marker(token):
        raise ValueError("Cortex bearer rejected")
    query = urllib.parse.urlencode(
        {"q": "cortex", "limit": 1, "include_citations": "true"}
    )
    req = urllib.request.Request(
        f"{bridge_url.rstrip('/')}/api/query?{query}",
        headers={
            "Authorization": f"Bearer {token}",
            "User-Agent": "cortex-remote-mcp-oauth/0.2",
        },
    )
    try:
        with NO_REDIRECT_OPENER.open(req, timeout=timeout) as response:
            if response.status != 200:
                raise ValueError("Cortex bearer rejected by Bridge")
    except urllib.error.HTTPError as exc:
        raise ValueError("Cortex bearer rejected by Bridge") from exc
    except TimeoutError as exc:
        raise RuntimeError("Cortex Bridge is unavailable") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError("Cortex Bridge is unavailable") from exc


def callback_redirect(
    redirect_uri: str,
    code: str,
    pending_state: str | None,
) -> str:
    parsed = urllib.parse.urlsplit(redirect_uri)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("OAuth redirect is unsafe")
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    query.append(("code", code))
    if pending_state is not None:
        query.append(("state", pending_state))
    return urllib.parse.urlunsplit(
        parsed._replace(query=urllib.parse.urlencode(query))
    )


def validate_pending_redirect(pending: dict[str, object]) -> None:
    redirect_uri = pending.get("redirect_uri")
    if not isinstance(redirect_uri, str):
        raise ValueError("OAuth redirect is unsafe")
    parsed = urllib.parse.urlsplit(redirect_uri)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("OAuth redirect is unsafe")


async def complete_authorization(
    request: Request,
    provider: CortexOAuthProvider,
    callback_secret: str,
    bridge_url: str,
    bridge_timeout: float = BRIDGE_VALIDATION_TIMEOUT_SECONDS,
) -> JSONResponse:
    provided_secret = request.headers.get("x-cortex-mcp-secret", "")
    if not secrets_match(provided_secret, callback_secret):
        return JSONResponse({"error": "Unauthorized callback"}, status_code=401)
    try:
        payload = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JSONResponse({"error": "Malformed request"}, status_code=400)
    if not isinstance(payload, dict):
        return JSONResponse({"error": "Malformed request"}, status_code=400)
    state_id = payload.get("stateId")
    token = payload.get("token")
    if (
        not isinstance(state_id, str)
        or not STATE_ID_SHAPE.fullmatch(state_id)
        or not isinstance(token, str)
        or not token
    ):
        return JSONResponse({"error": "Malformed request"}, status_code=400)
    try:
        pending = provider.peek_pending(state_id)
        validate_pending_redirect(pending)
    except ValueError:
        return JSONResponse({"error": "Invalid authorization state"}, status_code=400)
    try:
        async with asyncio.timeout(bridge_timeout):
            await asyncio.to_thread(
                validate_cortex_token,
                token,
                bridge_url,
                bridge_timeout,
            )
    except ValueError:
        return JSONResponse({"error": "Bearer rejected"}, status_code=401)
    except (RuntimeError, TimeoutError):
        return JSONResponse({"error": "Authorization service unavailable"}, status_code=502)
    try:
        redirect_uri, code, pending_state = provider.complete_pending(state_id, token)
        redirect_url = callback_redirect(redirect_uri, code, pending_state)
    except ValueError:
        return JSONResponse({"error": "Invalid authorization state"}, status_code=400)
    return JSONResponse({"redirectUrl": redirect_url})
```

Do not log `payload`, `token`, the callback secret, request headers, or Bridge response bodies.
Update `apps/cortex_mcp/pyproject.toml` to:

```toml
[tool.setuptools]
py-modules = ["server", "cortex_mcp_oauth", "cortex_mcp_callback"]
```

- [ ] **Step 4: Wire the route and remote-only startup guard**

In `server.py`, read the secret without a tracked default:

```python
CORTEX_MCP_CALLBACK_SECRET = os.environ.get(
    "CORTEX_MCP_CALLBACK_SECRET",
    "",
).strip()

if REMOTE_TRANSPORT and not CORTEX_MCP_CALLBACK_SECRET:
    raise RuntimeError(
        "CORTEX_MCP_CALLBACK_SECRET is required for streamable-http Cortex MCP"
    )
```

Register the callback:

```python
@mcp.custom_route("/authorize/complete", methods=["POST"])
async def authorize_complete(request: Request):
    assert _oauth_provider is not None
    return await complete_authorization(
        request,
        _oauth_provider,
        CORTEX_MCP_CALLBACK_SECRET,
        BRIDGE_URL,
    )
```

Retain `/authorize/approve` and its manual token form, but remove
`_validate_cortex_token` from `server.py`. In that retained route call the
extracted validator with
`await asyncio.to_thread(validate_cortex_token, token, BRIDGE_URL)`. Do not
link to `/authorize/approve` from `authorize()`, `/help`, or the updated
FibreFlow UI.

- [ ] **Step 5: Run callback and existing OAuth/tool regressions**

Run:

```bash
uv run pytest tests/test_cortex_mcp_oauth.py tests/test_cortex_mcp_callback.py \
  tests/test_cortex_mcp.py -q
uv run pytest tests/test_cortex_mcp.py::TestReadOnlySurface -q
uv run ruff check apps/cortex_mcp tests/test_cortex_mcp_oauth.py \
  tests/test_cortex_mcp_callback.py
uv tool run ty check apps/cortex_mcp tests/test_cortex_mcp_oauth.py \
  tests/test_cortex_mcp_callback.py --exit-zero-on-warning
```

Expected: all Pytest and Ruff commands PASS; ty has no error-level diagnostic.

- [ ] **Step 6: Commit the authenticated callback**

Run:

```bash
git add apps/cortex_mcp/cortex_mcp_callback.py apps/cortex_mcp/server.py \
  apps/cortex_mcp/pyproject.toml tests/test_cortex_mcp_oauth.py \
  tests/test_cortex_mcp_callback.py
git commit -m "feat(mcp): complete OAuth through FibreFlow consent"
```

## Task 3: Document Cortex configuration and prove Lew's tenant policy

**Files:**
- Modify: `.env.example`
- Modify: `docs/cortex-mcp-connect.md`
- Modify: `tests/test_superadmin_bypass.py`

**Interfaces:**
- Consumes: `CORTEX_SUPER_ADMIN_EMAILS` as a comma-separated import-time allowlist and the remote endpoint `https://app.fibreflow.app/api/cortex-remote-mcp/mcp`.
- Produces: reviewed configuration names, remote-first operator documentation, and tests that preserve ordinary-user ACL behavior.

- [ ] **Step 1: Add the failing Lew policy test**

Replace the current two-user examples with explicit multi-entry coverage:

```python
def test_configured_admins_include_lew_without_losing_existing_entries(monkeypatch):
    mod = _reload_with(
        monkeypatch,
        "hein@velocityfibre.co.za,lew@velocityfibre.co.za",
    )

    hein = _Ctx("velocity-fibre", "hein@velocityfibre.co.za")
    lew = _Ctx("velocity-fibre", "Lew@VelocityFibre.co.za")
    ordinary = _Ctx("velocity-fibre", "ordinary@velocityfibre.co.za")

    assert mod.resolve_principal_access(hein, sub="user") is None
    assert mod.resolve_principal_access(lew, sub="user") is None
    assert mod.resolve_principal_access(ordinary, sub="user") is not None
```

Keep the service-credential and empty-allowlist cases.

- [ ] **Step 2: Run the policy tests before documentation changes**

Run:

```bash
uv run pytest tests/test_superadmin_bypass.py -q
```

Expected: PASS if the existing parser already handles the approved policy. This is a characterization test; do not change `membership.py` when it passes.

- [ ] **Step 3: Add configuration names with blank secret values**

Add this remote section to `.env.example`:

```dotenv
# ─── Cortex Remote MCP OAuth ─────────────────────────────────────────────────
CORTEX_MCP_TRANSPORT=stdio
CORTEX_REMOTE_MCP_HOST=127.0.0.1
CORTEX_REMOTE_MCP_PORT=7414
CORTEX_REMOTE_MCP_PUBLIC_BASE=https://app.fibreflow.app/api/cortex-remote-mcp
# Omit CORTEX_REMOTE_MCP_STORE to use ~/.cortex_remote_mcp_oauth.json.
CORTEX_FF_APP_BASE=https://app.fibreflow.app
# Generate separately from FF_MCP_CALLBACK_SECRET; leave blank in tracked files.
CORTEX_MCP_CALLBACK_SECRET=
```

Do not add a real secret or live allowlist value to the example.

- [ ] **Step 4: Make remote browser consent the primary connection documentation**

At the top of `docs/cortex-mcp-connect.md`, put the normal workflow first:

```markdown
## Connect from Claude

1. In Claude, add a custom connector named **Cortex Knowledge**.
2. Use `https://app.fibreflow.app/api/cortex-remote-mcp/mcp`.
3. Claude opens FibreFlow. Sign in, review the read-only scope, and choose **Allow**.
4. Claude returns connected without displaying or asking you to paste a bearer token.

The verified FibreFlow email drives Cortex tenant and channel access. An email in the
server-managed `CORTEX_SUPER_ADMIN_EMAILS` allowlist receives full tenant read scope;
other users remain membership/ACL-scoped.
```

Retitle the current token/`uv` material to `Operator and stdio fallback`, state that it is not the normal remote connector workflow, keep bearer-handling warnings, and retain the exact read-only tool table.

- [ ] **Step 5: Run focused and full Cortex verification**

Run:

```bash
uv run pytest tests/test_cortex_mcp_oauth.py tests/test_cortex_mcp_callback.py \
  tests/test_cortex_mcp.py tests/test_superadmin_bypass.py -q
bash scripts/ci/run-ci.sh
git status --short
git diff --check
```

Expected: focused tests PASS, CI reports all required gates, and the worktree contains only intended Cortex PR files.

- [ ] **Step 6: Commit Cortex policy/configuration docs**

Run:

```bash
git add .env.example docs/cortex-mcp-connect.md tests/test_superadmin_bypass.py
git commit -m "docs(mcp): make FibreFlow consent the primary flow"
```

## Task 4: Add the FibreFlow Cortex consent API trust boundary

**Files:**
- Create: `pages/api/cortex/mcp-consent.ts`
- Create: `pages/api/cortex/__tests__/mcpConsent.testHarness.ts`
- Create: `pages/api/cortex/__tests__/mcpConsent.handler.test.ts`
- Create: `pages/api/cortex/__tests__/mcpConsent.errors.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: authenticated `req.user.email`, `cortex.review:view`, `mintMcpToken(email, '90d')`, `CORTEX_REMOTE_MCP_URL`, and `CORTEX_MCP_CALLBACK_SECRET`.
- Produces: `POST /api/cortex/mcp-consent { stateId } -> apiResponse.success({ redirectUrl })`.

- [ ] **Step 1: Write the failing API trust-boundary suite**

Do not replace application middleware modules. Existing behavioral middleware
suites cover the real `withAuth`/`withPermission` gates, and the real dev route
later proves their composition. Extract the smallest server-only
`createCortexConsentHandler()` seam whose defaults are the production
`mintMcpToken`, `fetch`, and `log`; the default export still wraps that handler
with the real middleware. Core tests pass hand-written deterministic boundary
adapters and invoke the handler through a loopback HTTP harness. The callback
side is a real loopback HTTP server that records the wire request. Do not use
`vi.mock`, `vi.fn`, or assert on a spy.

The central success scenario records values in plain arrays:

```typescript
it('uses only the verified email and returns only redirectUrl', async () => {
  const mintedFor: Array<[string, '90d']> = [];
  const callback = await startCallbackServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      redirectUrl: 'https://claude.ai/api/mcp/auth_callback?code=ctxc_abc',
    }));
  });
  const app = await startConsentHandler({
    user: { id: 'user-1', email: 'lew@velocityfibre.co.za' },
    permission: { key: 'cortex.review', action: 'view', allowed: true },
    callbackBase: callback.url,
    mintToken: async (email, lifetime) => {
      mintedFor.push([email, lifetime]);
      return {
        token: 'jwt-never-echo',
        expiresAt: new Date('2026-10-28T00:00:00.000Z'),
      };
    },
  });

  const response = await app.post('/api/cortex/mcp-consent', {
      stateId: VALID_STATE_ID,
      email: 'attacker@example.com',
      token: 'browser-token',
      redirectUrl: 'javascript:alert(1)',
  });

  expect(mintedFor).toEqual([['lew@velocityfibre.co.za', '90d']]);
  expect(callback.requests).toHaveLength(1);
  expect(callback.requests[0]).toMatchObject({
    path: '/authorize/complete',
    method: 'POST',
    cortexSecret: 'test-callback-secret',
  });
  expect(callback.requests[0]?.json).toEqual({
    stateId: VALID_STATE_ID,
    token: 'jwt-never-echo',
  });
  expect(response.json.data).toEqual({
    redirectUrl: 'https://claude.ai/api/mcp/auth_callback?code=ctxc_abc',
  });
  expect(JSON.stringify(response.json)).not.toContain('jwt-never-echo');
  expect(JSON.stringify(response.json)).not.toContain('test-callback-secret');
});
```

Add table-driven cases for missing, blank, too-short, whitespace-containing,
and non-string state values. Assert the real HTTP status/body, and assert the
plain `mintedFor` and callback request arrays remain empty.

Also assert:

- no verified user → `401`, no mint/callback;
- missing `cortex.review:view` → `403`, no mint/callback;
- `GET` → `405`, no mint/callback;
- missing `CORTEX_MCP_CALLBACK_SECRET` → `500` before mint;
- `CORTEX_REMOTE_MCP_URL=http://127.0.0.1:17414/` is honored;
- non-2xx, timeout/rejection, invalid JSON, missing redirect, `javascript:`, `data:`, scheme-relative, and relative redirects → failed authorization with no bearer in response/logs;
- `http://localhost/callback` and
  `https://claude.ai/api/mcp/auth_callback` redirects are accepted;
- callback options include `AbortSignal.timeout(10_000)`;
- mint failure returns a structured `500`.

- [ ] **Step 2: Run the API suite and observe the missing-route failure**

Run:

```bash
npx vitest run pages/api/cortex/__tests__/mcpConsent.handler.test.ts \
  pages/api/cortex/__tests__/mcpConsent.errors.test.ts
```

Expected: FAIL because `/api/cortex/mcp-consent` does not exist.

- [ ] **Step 3: Implement the minimal consent handler**

Use these exact constants and trust-boundary order:

```typescript
const STATE_ID_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;
const CALLBACK_TIMEOUT_MS = 10_000;
const GATEWAY_MESSAGE =
  'Authorization could not be completed. Return to Claude and try connecting again.';

const serviceUrl = (): string =>
  (process.env.CORTEX_REMOTE_MCP_URL || 'http://127.0.0.1:7414')
    .replace(/\/$/, '');

function isSafeRedirect(value: unknown): value is string {
  return (
    typeof value === 'string'
    && /^https?:\/\/[^/\s?#]+(?:[/?#]\S*)?$/i.test(value)
  );
}
```

The handler sequence is:

```typescript
async function consentHandler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  const stateId: unknown = req.body?.stateId;
  if (typeof stateId !== 'string' || !STATE_ID_SHAPE.test(stateId)) {
    return apiResponse.badRequest(res, 'stateId is missing or malformed');
  }

  const secret = (process.env.CORTEX_MCP_CALLBACK_SECRET ?? '').trim();
  if (!secret) {
    log.error(
      'Cortex MCP consent rejected: callback secret is not configured',
      { userId: req.user.id },
      'CortexMcpConsent',
    );
    return apiResponse.error(
      res,
      ErrorCode.INTERNAL_ERROR,
      GATEWAY_MESSAGE,
    );
  }

  const { token } = await mintMcpToken(req.user.email, '90d');
  let redirectUrl: unknown;
  try {
    const upstream = await fetch(`${serviceUrl()}/authorize/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cortex-MCP-Secret': secret,
      },
      body: JSON.stringify({ stateId, token }),
      signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
    });
    if (upstream.ok) {
      const payload: unknown = await upstream.json().catch((error) => {
        log.warn(
          'Cortex MCP consent callback returned invalid JSON',
          {
            userId: req.user.id,
            error: error instanceof Error ? error.message : String(error),
          },
          'CortexMcpConsent',
        );
        return null;
      });
      redirectUrl = (
        payload as { redirectUrl?: unknown } | null
      )?.redirectUrl;
    } else {
      log.warn(
        'Cortex MCP consent callback refused',
        { userId: req.user.id, status: upstream.status },
        'CortexMcpConsent',
      );
    }
  } catch (error) {
    log.warn(
      'Cortex MCP consent callback unavailable',
      {
        userId: req.user.id,
        error: error instanceof Error ? error.message : String(error),
      },
      'CortexMcpConsent',
    );
  }

  if (!isSafeRedirect(redirectUrl)) {
    return apiResponse.error(
      res,
      ErrorCode.BAD_GATEWAY,
      GATEWAY_MESSAGE,
    );
  }
  log.info(
    'Cortex MCP consent granted',
    { userId: req.user.id },
    'CortexMcpConsent',
  );
  return apiResponse.success(res, { redirectUrl });
}
```

Wrap it so `withAuth` runs first, non-POST is rejected, then `withPermission('cortex.review', 'view')` runs, and exceptions map through `apiResponse.internalError`. Do not call `deleteSession`: Cortex JWTs are stateless and are not FibreFlow MCP sessions.

- [ ] **Step 4: Document only blank/local configuration values**

Add:

```dotenv
# Cortex Remote MCP consent callback (server-only)
CORTEX_REMOTE_MCP_URL=http://127.0.0.1:7414
# Dedicated to Cortex; never reuse FF_MCP_CALLBACK_SECRET.
CORTEX_MCP_CALLBACK_SECRET=
```

Do not include `BRIDGE_JWT_SECRET`, callback values, or live env contents in the plan, commit, or PR.

- [ ] **Step 5: Run the focused API and existing FibreFlow MCP suites**

Run:

```bash
npx vitest run pages/api/cortex/__tests__/mcpConsent.handler.test.ts \
  pages/api/cortex/__tests__/mcpConsent.errors.test.ts \
  pages/api/mcp/__tests__/consent.test.ts \
  tests/api/ff-remote-mcp-proxy.test.ts \
  tests/api/mcp-proxy-route-errors.test.ts
```

Expected: all suites PASS; the existing FibreFlow connector behavior remains green.

- [ ] **Step 6: Commit the FibreFlow API**

Run:

```bash
git add .env.example pages/api/cortex/mcp-consent.ts \
  pages/api/cortex/__tests__/mcpConsent.testHarness.ts \
  pages/api/cortex/__tests__/mcpConsent.handler.test.ts \
  pages/api/cortex/__tests__/mcpConsent.errors.test.ts
git commit -m "feat(cortex): authorize MCP from verified FibreFlow sessions"
```

## Task 5: Add the standalone Cortex consent page

**Files:**
- Create: `pages/cortex/mcp/authorize.tsx`
- Create: `src/components/cortex/CortexMcpConsentCard.tsx`
- Create: `tests/pages/cortex-mcp-authorize.test.tsx`

**Interfaces:**
- Consumes: `useAuth()`, `router.query.state_id`, the encoded return URL
  supplied to `/sign-in`, and `POST /api/cortex/mcp-consent`.
- Produces: a terminal standalone consent flow that renders the verified email and never posts twice.

- [ ] **Step 1: Write the failing page tests**

Render the real page with Next's `RouterContext` and the real `AuthProvider`.
Use a deterministic in-memory router and a network-boundary responder for
`/api/auth/me` and `/api/cortex/mcp-consent`; do not replace `useRouter`,
`useAuth`, `Head`, or the consent card module. Assert DOM and recorded HTTP or
navigation behavior, never calls on a spy.

```typescript
const STATE_ID = 'pZJqcS1uZH4fXo0WmXtYyRA7d2NcQk5g';

it('preserves state through FibreFlow sign-in', async () => {
  const browser = renderConsentPage({
    route: `/cortex/mcp/authorize?state_id=${STATE_ID}`,
    authResponse: { status: 401 },
  });

  await browser.waitForPath('/sign-in');
  expect(browser.returnUrl()).toBe(
    `/cortex/mcp/authorize?state_id=${STATE_ID}`,
  );
  expect(browser.recordedRequests('/api/cortex/mcp-consent')).toEqual([]);
});

it('posts only stateId once and follows the service redirect', async () => {
  const browser = renderConsentPage({
    route: `/cortex/mcp/authorize?state_id=${STATE_ID}`,
    authResponse: authenticatedLewResponse,
    consentResponse: {
      status: 200,
      body: {
      data: {
        redirectUrl:
          'https://claude.ai/api/mcp/auth_callback?code=ctxc_abc',
      },
      },
    },
  });

  const allow = await screen.findByRole('button', { name: /^Allow$/ });
  await act(async () => {
    allow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    allow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  expect(browser.recordedRequests('/api/cortex/mcp-consent')).toEqual([{
    method: 'POST',
    json: { stateId: STATE_ID },
  }]);
  expect(browser.externalLocation()).toBe(
    'https://claude.ai/api/mcp/auth_callback?code=ctxc_abc',
  );
});
```

Also assert router/auth hydration waits, missing state is user-readable with no Allow button, the exact signed-in email is shown, Cancel makes no request, API/network errors never navigate, and `200` without `redirectUrl` fails safely.

- [ ] **Step 2: Run the page test and observe the missing component/page failures**

Run:

```bash
npx vitest run tests/pages/cortex-mcp-authorize.test.tsx
```

Expected: FAIL because the Cortex page/card do not exist.

- [ ] **Step 3: Implement the Cortex-specific card**

Create `CortexMcpConsentCard.tsx` with the same phase union used by the working FibreFlow consent card, but use Cortex-specific content:

```tsx
<h1>Allow Claude to read Cortex Knowledge as you?</h1>
<p>
  Claude can search meetings, email, WhatsApp, SharePoint, timelines and cited
  evidence that your Cortex access permits. It cannot add, change, approve or
  delete anything.
</p>
<ul>
  <li>· Read-only Cortex tools</li>
  <li>· Full or limited scope is decided by your verified FibreFlow email</li>
  <li>· The connector never displays or asks you to paste a bearer token</li>
</ul>
```

Render `Signed in as` and `email`, retain terminal `cancelled`/`error` notices, and change the notice link to `/connections/cortex`.

- [ ] **Step 4: Implement the standalone page controller**

Use the proven state machine and synchronous `useRef(false)` double-submit guard from `pages/mcp/authorize.tsx`, changing only:

```typescript
fetch('/api/cortex/mcp-consent', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ stateId }),
});
```

Set:

```tsx
<title>Authorize Cortex Knowledge | FibreFlow</title>
<meta name="robots" content="noindex, nofollow" />
<meta name="referrer" content="no-referrer" />
```

The sign-in redirect must use:

```typescript
void router.replace(
  `/sign-in?returnUrl=${encodeURIComponent(router.asPath)}`,
);
```

The page remains outside `AppLayout`/`ProtectedRoute`; export `getServerSideProps = async () => ({ props: {} })`.

- [ ] **Step 5: Run both consent-page suites**

Run:

```bash
npx vitest run tests/pages/cortex-mcp-authorize.test.tsx \
  tests/pages/mcp-authorize.test.tsx
```

Expected: both suites PASS; the existing FibreFlow page is unchanged.

- [ ] **Step 6: Commit the Cortex consent UI**

Run:

```bash
git add pages/cortex/mcp/authorize.tsx \
  src/components/cortex/CortexMcpConsentCard.tsx \
  tests/pages/cortex-mcp-authorize.test.tsx
git commit -m "feat(cortex): add FibreFlow consent screen"
```

## Task 6: Build the AI Connections pages and horizontal navigation

**Files:**
- Create: `src/components/connections/ConnectionsNav.tsx`
- Create: `src/components/connections/ConnectorSetupCard.tsx`
- Create: `src/components/connections/CortexConnectionPanel.tsx`
- Move/modify: `src/components/connections/FibreFlowConnectionPanel.tsx`
- Move: `src/components/connections/FibreFlowTokenList.tsx`
- Move: `src/components/connections/FibreFlowTokenReveal.tsx`
- Create: `src/components/connections/__tests__/ConnectionsNav.test.tsx`
- Create: `src/components/connections/__tests__/ConnectionPanels.test.tsx`
- Create: `pages/connections/index.tsx`
- Create: `pages/connections/fibreflow.tsx`
- Create: `pages/connections/cortex.tsx`
- Create: `tests/pages/connections.test.tsx`

**Interfaces:**
- Consumes: `ModuleNav`, `AppLayout`, `ProtectedPage`, `/api/me/mcp-tokens`, and the two public MCP URLs.
- Produces: separate FibreFlow Operations and Cortex Knowledge setup pages with no token/local-runtime material in either primary path.

- [ ] **Step 1: Write failing navigation and content tests**

Test the shared nav:

```typescript
it('renders horizontal FibreFlow and Cortex tabs', () => {
  renderWithRouter(<ConnectionsNav />, '/connections/fibreflow');
  expect(screen.getByRole('link', { name: 'FibreFlow' }))
    .toHaveAttribute('href', '/connections/fibreflow');
  expect(screen.getByRole('link', { name: 'Cortex' }))
    .toHaveAttribute('href', '/connections/cortex');
});
```

Test the Cortex primary panel:

```typescript
it('shows browser consent and no token or local runtime setup', () => {
  render(<CortexConnectionPanel />);
  expect(screen.getByText('Cortex Knowledge')).toBeInTheDocument();
  expect(screen.getByText(
    'https://app.fibreflow.app/api/cortex-remote-mcp/mcp',
  )).toBeInTheDocument();
  expect(screen.getByText(/FibreFlow sign-in and consent/i))
    .toBeInTheDocument();
  expect(screen.queryByLabelText(/Cortex MCP token/i)).toBeNull();
  expect(screen.queryByText(/\/path\/to\/Cortex/i)).toBeNull();
  expect(screen.queryByText(/uv run/i)).toBeNull();
  expect(screen.queryByText(/CORTEX_USER_TOKEN/i)).toBeNull();
});
```

Test FibreFlow session/Advanced behavior using the real panel and a
network-boundary responder that records requests:

```typescript
it('shows active sessions and keeps manual mint collapsed', async () => {
  const network = renderWithNetwork(<FibreFlowConnectionPanel />, {
    '/api/me/mcp-tokens': {
      status: 200,
      body: {
      data: {
        tokens: [{
          id: 'session-1',
          label: 'Claude connector',
          createdAt: '2026-07-30T08:00:00.000Z',
          expiresAt: '2026-10-28T08:00:00.000Z',
          lastUsedAt: null,
        }],
      },
      },
    },
  });

  expect(await screen.findByText('Claude connector')).toBeInTheDocument();
  expect(screen.getByText(
    'https://app.fibreflow.app/api/ff-remote-mcp/mcp',
  )).toBeInTheDocument();
  expect(screen.getByText('Advanced')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Generate token' })).toBeNull();
  expect(network.recordedRequests()).toEqual([{
    method: 'GET',
    path: '/api/me/mcp-tokens',
  }]);
});
```

Add behavior tests that expanding `Advanced` reveals manual
lifetime/label/mint controls, successful mint reveals once, revoke records a
real `DELETE /api/me/mcp-tokens/session-1` boundary request, an authorized user
sees Cortex connection content, and a user denied `cortex.review:view` sees the
real access-denied surface.

- [ ] **Step 2: Run the new component/page tests and observe missing-file failures**

Run:

```bash
npx vitest run src/components/connections/__tests__/ConnectionsNav.test.tsx \
  src/components/connections/__tests__/ConnectionPanels.test.tsx \
  tests/pages/connections.test.tsx
```

Expected: FAIL because the connections module does not exist.

- [ ] **Step 3: Implement `ConnectionsNav` with the existing `ModuleNav`**

Use:

```tsx
import { ModuleNav } from '@/components/layout/ModuleNav';
import type { Tab } from '@/components/accounting/accountingNavConfig';

const TABS: Tab[] = [
  { id: 'fibreflow', label: 'FibreFlow', href: '/connections/fibreflow' },
  { id: 'cortex', label: 'Cortex', href: '/connections/cortex' },
];

function getActiveTabId(pathname: string): string {
  return pathname.startsWith('/connections/cortex')
    ? 'cortex'
    : 'fibreflow';
}

export function ConnectionsNav() {
  return (
    <ModuleNav
      tabs={TABS}
      getActiveTabId={getActiveTabId}
      accentColor="violet"
      navLabel="AI Connections navigation"
    />
  );
}
```

- [ ] **Step 4: Implement the credential-free setup cards**

`ConnectorSetupCard` receives:

```typescript
interface ConnectorSetupCardProps {
  heading: string;
  description: string;
  endpoint: string;
  consentDescription: string;
}
```

It renders `heading` in an `<h1>`, renders the endpoint as selectable text, and
uses exactly these steps:

```tsx
<ol>
  <li>Open Claude Settings and choose Connectors.</li>
  <li>Choose Add custom connector and paste the URL above.</li>
  <li>Complete the FibreFlow sign-in and consent window Claude opens.</li>
</ol>
```

`CortexConnectionPanel` uses heading `Cortex Knowledge`, names meetings/email/WhatsApp/SharePoint/timelines/cited evidence, states read-only scope, and uses the production Cortex endpoint.

- [ ] **Step 5: Move and reshape the FibreFlow panel**

Use `git mv` for the three FibreFlow files. In `FibreFlowConnectionPanel`:

- render `ConnectorSetupCard` first with heading `FibreFlow Operations`, the production FibreFlow endpoint, and projects/QField/fleet/procurement/RBAC copy;
- keep active sessions and per-session Revoke controls visible;
- wrap only lifetime/label/manual mint/reveal controls in a native `<details>` with `<summary>Advanced</summary>`;
- keep the GET/list and DELETE/revoke contracts unchanged;
- preserve one-time token handling in React state only;
- replace `cx-*` classes with existing `--ff-*`/Tailwind design tokens so `/connections/*` does not depend on the `/cortex` premium skin.

- [ ] **Step 6: Add the three pages and permission gate**

`pages/connections/index.tsx`:

```typescript
export default function ConnectionsIndex() {
  return null;
}

export const getServerSideProps = async () => ({
  redirect: {
    destination: '/connections/fibreflow',
    permanent: false,
  },
});
```

Both pages use:

```tsx
<AppLayout>
  <Head>
    <title>AI Connections | FibreFlow</title>
  </Head>
  <ConnectionsNav />
  <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
    {content}
  </main>
</AppLayout>
```

The Cortex page must wrap `CortexConnectionPanel` with:

```tsx
<ProtectedPage permission="cortex.review" action="view">
  <CortexConnectionPanel />
</ProtectedPage>
```

- [ ] **Step 7: Run connections tests and size checks**

Run:

```bash
npx vitest run src/components/connections/__tests__/ConnectionsNav.test.tsx \
  src/components/connections/__tests__/ConnectionPanels.test.tsx \
  tests/pages/connections.test.tsx \
  pages/api/me/__tests__/mcp-tokens.test.ts \
  pages/api/me/__tests__/mcp-tokens-revoke.test.ts
wc -l src/components/connections/*.tsx
```

Expected: tests PASS; every new file is under 300 lines and each new component is under 200 lines.

- [ ] **Step 8: Commit the AI Connections module**

Run:

```bash
git add pages/connections src/components/connections tests/pages/connections.test.tsx
git commit -m "feat(connections): add separate AI connector pages"
```

## Task 7: Remove connector setup from `/cortex` and wire the single sidebar entry

**Files:**
- Modify: `pages/cortex.tsx`
- Modify: `src/components/layout/sidebar/config/cortexSection.ts`
- Create: `tests/pages/cortex-page.test.tsx`
- Delete: `src/components/cortex/CortexConnectPanel.tsx`
- Delete: `src/components/cortex/McpTokenReveal.tsx`
- Delete: `src/components/cortex/__tests__/CortexConnectPanel.test.tsx`

**Interfaces:**
- Consumes: `PermissionGate`, `/connections/cortex`, existing Cortex hero/search/review components, and sidebar `NavSection`.
- Produces: a knowledge-only `/cortex` plus one top-level `AI Connections` sidebar item.

- [ ] **Step 1: Write the failing Cortex-page regression test**

Render the real `CortexPage`, `PermissionGate`, hero, cited-search and review
components inside the same real router/auth providers used by the application.
Provide deterministic HTTP responses only at the network boundary. Assert:

```typescript
it('keeps knowledge features, removes panels, and links to connections', () => {
  render(<CortexPage />);

  expect(screen.getByRole('heading', { name: 'Cortex' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Knowledge base query' }))
    .toBeInTheDocument();
  expect(screen.getByText('Review queue is empty.')).toBeInTheDocument();
  expect(screen.queryByText(/Generate token/i)).toBeNull();
  expect(screen.queryByText(/FibreFlow \(read-only\)/i)).toBeNull();
  expect(screen.getByRole('link', { name: /AI Connections/i }))
    .toHaveAttribute('href', '/connections/cortex');
});
```

Render the real sidebar with an authorized user and assert its visible links:

```typescript
expect(screen.getByRole('link', { name: 'Cortex' }))
  .toHaveAttribute('href', '/cortex');
expect(screen.getByRole('link', { name: 'AI Connections' }))
  .toHaveAttribute('href', '/connections/fibreflow');
```

Add an unauthorized-user case against the real permission provider that proves
the Cortex Connections CTA is absent. Do not replace child components,
`PermissionGate`, `usePermission`, or sidebar configuration with test doubles.

- [ ] **Step 2: Run the page test and observe current connector-panel failures**

Run:

```bash
npx vitest run tests/pages/cortex-page.test.tsx
```

Expected: FAIL because `/cortex` still renders both panels and lacks the link/sidebar item.

- [ ] **Step 3: Make `/cortex` knowledge-only**

Remove the connector imports, `mcpEnabled`/`ffMcpEnabled` props, connector JSX, and `getServerSideProps`. Retain:

```tsx
<CortexHero />
<PermissionGate
  permission="cortex.review"
  action="view"
  showLoading
>
  <Link href="/connections/cortex">
    Manage AI Connections
  </Link>
</PermissionGate>
<CortexCitedSearch />
<CortexReviewPanel />
```

Keep the premium wrapper and page title unchanged.

- [ ] **Step 4: Add one sidebar item without a subtree**

Import `Cable` from `lucide-react` and append:

```typescript
{
  to: '/connections/fibreflow',
  icon: Cable,
  label: 'AI Connections',
  shortLabel: 'Connections',
  permissions: [],
},
```

Retain the existing `Cortex` item and its `cortex.review` RBAC key.

- [ ] **Step 5: Delete only the retired Cortex manual UI**

Delete `CortexConnectPanel.tsx`, `McpTokenReveal.tsx`, and the component test that exclusively exercises them. Keep:

- `pages/api/cortex/mcp-token.ts`;
- `pages/api/cortex/__tests__/mcpToken.handler.test.ts`;
- `src/lib/cortex/bridgeAuth.ts`;
- Cortex's `/authorize/approve` rollback route.

- [ ] **Step 6: Run page, navigation, and rollback API tests**

Run:

```bash
npx vitest run tests/pages/cortex-page.test.tsx \
  src/components/connections/__tests__/ConnectionPanels.test.tsx \
  pages/api/cortex/__tests__/mcpToken.handler.test.ts
npm run agents:check
```

Expected: tests PASS; the manual API remains covered but no normal UI renders its token/config flow.

- [ ] **Step 7: Commit the Cortex page/navigation split**

Run:

```bash
git add pages/cortex.tsx src/components/layout/sidebar/config/cortexSection.ts \
  tests/pages/cortex-page.test.tsx src/components/cortex
git commit -m "refactor(cortex): move connector setup to connections"
```

## Task 8: Add responsive Playwright proof and close both code-review gates

**Files:**
- Create: `tests/e2e/ai-connections.spec.ts`
- Modify only if tests expose a scoped defect: files already listed in Tasks 1-7

**Interfaces:**
- Consumes: authenticated FibreFlow dev, `/connections/*`, `/cortex`, and the deployed feature branches.
- Produces: local/static verification evidence, two draft PRs, and browser proof ready for the isolated OAuth test.

- [ ] **Step 1: Write the desktop/mobile Playwright specification**

Use authenticated storage and deterministic artifact paths:

```typescript
import { expect, test } from '@playwright/test';

const routes = [
  {
    path: '/connections/fibreflow',
    heading: 'FibreFlow Operations',
    endpoint: 'https://app.fibreflow.app/api/ff-remote-mcp/mcp',
  },
  {
    path: '/connections/cortex',
    heading: 'Cortex Knowledge',
    endpoint: 'https://app.fibreflow.app/api/cortex-remote-mcp/mcp',
  },
] as const;

for (const route of routes) {
  test(`${route.heading} desktop @connections`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: route.heading })).toBeVisible();
    await expect(page.getByText(route.endpoint)).toBeVisible();
    await expect(page.getByRole('link', { name: 'FibreFlow' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cortex' })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`${route.heading}-desktop.png`),
      fullPage: true,
    });
  });

  test(`${route.heading} mobile @connections @mobile`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: route.heading })).toBeVisible();
    expect(await page.evaluate(
      () => document.documentElement.scrollWidth
        <= document.documentElement.clientWidth,
    )).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`${route.heading}-mobile.png`),
      fullPage: true,
    });
  });
}

test('/cortex is knowledge-only @connections', async ({ page }) => {
  await page.goto('/cortex', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: /AI Connections/i })).toBeVisible();
  await expect(page.getByText(/Generate token/i)).toHaveCount(0);
  await expect(page.getByText('/path/to/Cortex')).toHaveCount(0);
});
```

- [ ] **Step 2: Run all FibreFlow local gates before push**

Run:

```bash
npx vitest run pages/api/cortex/__tests__/mcpConsent.handler.test.ts \
  pages/api/cortex/__tests__/mcpConsent.errors.test.ts \
  pages/api/mcp/__tests__/consent.test.ts \
  tests/pages/cortex-mcp-authorize.test.tsx \
  tests/pages/mcp-authorize.test.tsx \
  src/components/connections/__tests__/ConnectionsNav.test.tsx \
  src/components/connections/__tests__/ConnectionPanels.test.tsx \
  tests/pages/connections.test.tsx \
  tests/pages/cortex-page.test.tsx \
  tests/api/ff-remote-mcp-proxy.test.ts \
  tests/api/mcp-proxy-route-errors.test.ts
npm run ci:quick
npm run build
npm run antihall
git diff --check
bash scripts/secret-scan.sh
```

Expected: focused suites, quick CI, build, antihall, diff, and secret scan PASS. Record the known non-blocking TypeScript baseline separately; no new changed-file error is allowed.

- [ ] **Step 3: Run all Cortex local gates before push**

Run:

```bash
cd /home/hein/Workspace/Cortex-cortex-mcp-ff-consent
uv run pytest tests/test_cortex_mcp_oauth.py tests/test_cortex_mcp_callback.py \
  tests/test_cortex_mcp.py tests/test_superadmin_bypass.py -q
uv run pytest tests/test_cortex_mcp.py::TestReadOnlySurface -q
bash scripts/ci/run-ci.sh
git diff --check
git status --short
```

Expected: all required checks PASS and no live files or the dirty primary Cortex checkout changed.

- [ ] **Step 4: Push and open coordinated draft PRs with `gh`**

Run from each worktree:

```bash
gh pr create --draft --base main \
  --title "feat(mcp): authorize Cortex through FibreFlow consent" \
  --body-file /tmp/cortex-mcp-pr-body.md
```

When `gh` asks where to publish the current Cortex branch, choose `origin`.
For FibreFlow use base `master` and likewise let `gh` publish the current
branch to `origin`:

```bash
gh pr create --draft --base master \
  --title "feat(cortex): add FibreFlow-backed MCP consent and connections" \
  --body-file /tmp/fibreflow-cortex-consent-pr-body.md
```

Each PR body names the other PR, lists its own tests, states that no live configuration/access changed, and describes the shared callback contract without including a secret or token.

- [ ] **Step 5: Complete independent review and CI for both PRs**

Use the repository's blind-review workflow on each PR. Address findings through TDD, rerun the affected and full gates, push fixes, and wait for GitHub Actions:

```bash
gh pr checks <CORTEX_PR_NUMBER> --watch
gh pr checks <FIBREFLOW_PR_NUMBER> --watch
```

Do not mark either PR ready for merge until both are internally consistent and the cross-repository callback names/header/body/status behavior match.

- [ ] **Step 6: STOP for Hein's isolated-dev rollout approval**

Report:

- both PR URLs and review status;
- exact test/build results;
- isolated ports `17406`/`17403`/`17414` for Executor/Bridge/Remote MCP;
- proposed untracked dev env file locations;
- confirmation that production port `7414`, production OAuth store, live environment files, services, and Lew's live allowlist are unchanged.

Wait for explicit approval before Task 9.

## Task 9: Run the approved isolated dev OAuth and browser/Claude proof

**Files:**
- Untracked after approval: `~/.hermes/cortex-consent-dev.env` with mode `0600`
- Untracked after approval: a unique OAuth store under `~/.hermes/`
- Dev-only after approval: FibreFlow dev environment values for the callback secret and isolated upstream
- Transient after approval: isolated Agent Executor, Bridge, and Remote MCP user units
- No tracked source changes unless the proof finds a defect

**Interfaces:**
- Consumes: reviewed branches, `https://dev.fibreflow.app/api/cortex-remote-mcp/mcp`, isolated Agent Executor `127.0.0.1:17406`, isolated Bridge `127.0.0.1:17403`, isolated Remote MCP `127.0.0.1:17414`, a unique OAuth store/public base, a real Claude custom connector, Lew, and one ordinary user.
- Produces: evidence of no-token browser consent, tenant-vs-ACL scope, unchanged FibreFlow MCP RBAC, reconnect/revoke behavior, and responsive screenshots.

- [ ] **Step 0: Verify Lew's FibreFlow identity and consent permission**

Use the supported read-only account/RBAC lookup to verify that the account email is
exactly `lew@velocityfibre.co.za` and that it has `cortex.review:view`. Because
FibreFlow dev and production share one database, if the permission is absent,
STOP and present the exact scoped RBAC change for Hein's explicit approval; do
not grant it as an implicit dev-test setup action.

- [ ] **Step 1: Generate and place the dedicated dev callback secret without displaying it**

The operator generates one new random value and places the same value in:

- untracked `~/.hermes/cortex-consent-dev.env` as `CORTEX_MCP_CALLBACK_SECRET`;
- the approved FibreFlow dev server environment as `CORTEX_MCP_CALLBACK_SECRET`.

The dev env also contains:

```dotenv
CORTEX_MCP_TRANSPORT=streamable-http
CORTEX_REMOTE_MCP_HOST=127.0.0.1
CORTEX_REMOTE_MCP_PORT=17414
CORTEX_REMOTE_MCP_PUBLIC_BASE=https://dev.fibreflow.app/api/cortex-remote-mcp
CORTEX_FF_APP_BASE=https://dev.fibreflow.app
CORTEX_REMOTE_MCP_STORE=/home/hein/.hermes/cortex-remote-mcp-oauth-consent-dev.json
CORTEX_BRIDGE_URL=http://127.0.0.1:17403
EXECUTOR_PORT=17406
EXECUTOR_URL=http://127.0.0.1:17406
BRIDGE_URL=http://127.0.0.1:17403
```

Set mode `0600`. Compare non-reversible hashes of the callback secret loaded by FibreFlow dev and isolated Remote MCP and require equality. Separately compare it with `FF_MCP_CALLBACK_SECRET` and require inequality. Record only the equality/inequality verdicts; never print either secret.
Before either isolated service starts, also compare non-reversible hashes for
FibreFlow dev's `BRIDGE_JWT_SECRET` and the isolated Bridge's loaded
`BRIDGE_JWT_SECRET`, and compare `BRIDGE_JWT_KID` when configured. Abort on
either mismatch; never print the underlying values.

- [ ] **Step 2: Start an isolated Agent Executor, then the read-only Bridge**

Start a transient executor from the clean Cortex worktree before Bridge. Load only
the approved untracked executor environment followed by the consent-dev overrides;
the latter fixes `EXECUTOR_PORT=17406` and `BRIDGE_URL=http://127.0.0.1:17403`.
Never bind or call production executor port `7406` during this proof.

```bash
systemd-run --user --unit=cortex-agent-executor-consent-dev --collect \
  --property=WorkingDirectory=/home/hein/Workspace/Cortex-cortex-mcp-ff-consent/apps/agent_executor \
  --property=EnvironmentFile=/home/hein/Workspace/Cortex/.env \
  --property=EnvironmentFile=/home/hein/.hermes/cortex-consent-dev.env \
  /home/hein/.bun/bin/bun run src/server.ts

curl --fail --silent http://127.0.0.1:17406/health
systemctl --user is-active cortex-agent-executor-consent-dev
systemctl --user show cortex-agent-executor.service -p MainPID -p ActiveEnterTimestamp
```

Expected: the isolated executor is healthy on `17406`; the production executor PID
and start time are unchanged.

Use a transient user unit from the clean Cortex worktree, loading the existing untracked Bridge environment first and the consent-dev overrides second. The override's `CORTEX_SUPER_ADMIN_EMAILS` is the complete existing list plus `lew@velocityfibre.co.za`; verify the complete list before starting. Do not edit `~/.hermes/.env` and do not restart `cortex-bridge`.
Verify that the isolated process loads `CORTEX_INSTANCE_ID=velocity-fibre`;
abort before testing if it does not. Independently read back the complete effective
`CORTEX_SUPER_ADMIN_EMAILS` set, confirm `lew@velocityfibre.co.za` is present, and
abort if any pre-existing entry was dropped.

Start the isolated process:

```bash
systemd-run --user --unit=cortex-bridge-consent-dev --collect \
  --property=WorkingDirectory=/home/hein/Workspace/Cortex-cortex-mcp-ff-consent \
  --property=EnvironmentFile=/home/hein/.hermes/.env \
  --property=EnvironmentFile=/home/hein/.hermes/cortex-consent-dev.env \
  /home/hein/.local/bin/uv run uvicorn apps.bridge.main:app \
    --host 127.0.0.1 --port 17403
```

Verify:

```bash
curl --fail --silent http://127.0.0.1:17403/api/health
systemctl --user is-active cortex-bridge-consent-dev
systemctl --user is-active cortex-bridge
```

Expected: isolated and live Bridge units are both active; live Bridge PID/start time is unchanged.
Prove from the isolated Bridge environment and a representative request that its
executor target is `http://127.0.0.1:17406`, never production `7406`.

- [ ] **Step 3: Start the isolated Remote MCP process**

Start it from `/home/hein/Workspace/Cortex-cortex-mcp-ff-consent` with the
consent-dev environment:

```bash
systemd-run --user --unit=cortex-remote-mcp-consent-dev --collect \
  --property=WorkingDirectory=/home/hein/Workspace/Cortex-cortex-mcp-ff-consent \
  --property=EnvironmentFile=/home/hein/.hermes/.env \
  --property=EnvironmentFile=/home/hein/.hermes/cortex-consent-dev.env \
  /home/hein/.local/bin/uv run \
    --directory /home/hein/Workspace/Cortex-cortex-mcp-ff-consent \
    --package cortex-mcp cortex-mcp
```

Verify:

```bash
systemctl --user is-active cortex-remote-mcp-consent-dev
curl --fail --silent \
  http://127.0.0.1:17414/.well-known/openid-configuration
systemctl --user show cortex-remote-mcp.service -p MainPID -p ActiveEnterTimestamp
```

Expected: metadata advertises authorization-code plus refresh-token grants; the production `cortex-remote-mcp.service` PID/start time is unchanged.

- [ ] **Step 4: Point and deploy FibreFlow dev only**

After the reviewed feature branch is on GitHub, set FibreFlow dev:

```dotenv
CORTEX_REMOTE_MCP_URL=http://127.0.0.1:17414
FF_MCP_TOKEN_UI_ENABLED=true
```

Set `CORTEX_MCP_CALLBACK_SECRET` to the same dedicated value through the
approved server-environment editor without printing it. Record and preserve
the previous values so cleanup can restore them.

Deploy only the reviewed feature branch:

```bash
bash scripts/deploy-local.sh dev --branch feat/cortex-mcp-ff-consent
```

Verify `https://dev.fibreflow.app/api/cortex-remote-mcp/.well-known/openid-configuration`, `/connections/fibreflow`, `/connections/cortex`, and `/cortex`. Do not deploy production.

- [ ] **Step 5: Run the committed desktop/mobile Playwright proof**

Use credentials from the approved credential store, never from this plan or a PR:

```bash
E2E_BASE_URL=https://dev.fibreflow.app \
E2E_EMAIL="$E2E_EMAIL" \
E2E_PASSWORD="$E2E_PASSWORD" \
npx playwright test tests/e2e/ai-connections.spec.ts --project=chromium
```

Expected: desktop/mobile cases PASS and screenshots are captured in Playwright's test output.

- [ ] **Step 6: Complete two real Cortex connector authorizations**

In a real Claude client:

1. Add `https://dev.fibreflow.app/api/cortex-remote-mcp/mcp` as `Cortex Knowledge Dev`.
2. As Lew, confirm Claude opens FibreFlow sign-in/consent and no screen asks for a token.
3. Confirm the consent card shows exactly `lew@velocityfibre.co.za`.
4. Allow and run a cited query that includes a known tenant-wide and a known restricted source.
5. Repeat through a clean browser/Claude profile as an ordinary user.
6. Record citations/source IDs and scope counts without recording bearer/access/refresh tokens.
7. Prove Lew sees the full `velocity-fibre` tenant and the ordinary user remains ACL-limited.

- [ ] **Step 7: Prove the existing FibreFlow connector is unchanged**

Connect `https://dev.fibreflow.app/api/ff-remote-mcp/mcp`, complete its existing FibreFlow consent, and run:

- a permitted project/QField read;
- a read outside the ordinary user's RBAC, expecting denial/omission;
- a representative mutating request, expecting the existing read-only rejection.

Run the existing FibreFlow MCP consent/proxy tests again after the live proof.

- [ ] **Step 8: Exercise disconnect/revoke/reconnect**

- Disconnect the Cortex dev connector and prove the OAuth access token no longer authorizes.
- Reconnect through FibreFlow consent and prove one new usable OAuth grant.
- Revoke a FibreFlow Operations MCP session from `/connections/fibreflow` and prove that session stops authorizing.
- Confirm no bearer appears in browser history, page source, network response bodies, Next.js logs, Remote MCP logs, or screenshots.

- [ ] **Step 9: Stop only the three isolated transient units and restore dev**

With Hein's rollout approval covering cleanup:

- run
  `systemctl --user stop cortex-remote-mcp-consent-dev cortex-bridge-consent-dev cortex-agent-executor-consent-dev`;
- restore FibreFlow dev to its previously recorded branch/upstream values through the supported dev deploy path;
- verify production Agent Executor, Bridge, and Remote MCP PIDs/start times stayed unchanged throughout;
- retain the isolated store only as long as review evidence requires, then remove it through an explicitly approved recoverable cleanup.

- [ ] **Step 10: Fix any discovered defect through both PR gates**

If live proof exposes a defect, reproduce it in Vitest/Pytest/Playwright first, implement the smallest fix, rerun both repositories' affected/full gates, repeat blind review, and repeat the isolated proof. Do not bypass the failure by widening permissions or pointing dev at the production OAuth service.

## Task 10: Merge and production rollout after a separate explicit approval

**Files/state:**
- Merge: coordinated Cortex and FibreFlow PRs
- Approved untracked production envs: add the shared dedicated callback secret
- Approved Cortex allowlist: append Lew while retaining all current entries
- Services: Cortex Agent Executor, then Cortex Bridge, then Cortex Remote MCP, then FibreFlow production

**Interfaces:**
- Consumes: reviewed/green PRs, successful isolated proof, after-hours window, and Hein's explicit production approval.
- Produces: production browser consent and full/limited retrieval proof with a tested rollback.

- [ ] **Step 1: Present the production change set and obtain explicit approval**

Include:

- merge SHAs/PRs;
- CI, build, Playwright, and isolated Claude proof;
- current production health and deployment SHAs;
- exact services to restart;
- statement that adding Lew widens only a marked-compatible existing Lew grant after Bridge restart, while unsafe unmarked grants fail closed and require re-consent;
- rollback order below.

Do not infer approval from approval of Task 9.

- [ ] **Step 2: Merge both PRs only when both review/CI gates are green**

Use `gh pr merge` with the repository-approved merge method. Re-read `origin/master`/`origin/main` and record both merge SHAs.

- [ ] **Step 3: Configure the dedicated production callback secret before code restarts**

Place the same newly generated `CORTEX_MCP_CALLBACK_SECRET` in the FibreFlow production server env and Cortex Remote MCP's loaded untracked env. Compare non-reversible hashes and require equality between those two loaded values; separately require inequality with `FF_MCP_CALLBACK_SECRET`. Record only the two verdicts. Also require hash agreement for FibreFlow's and Bridge's loaded `BRIDGE_JWT_SECRET`, plus exact `BRIDGE_JWT_KID` agreement when configured. Abort on any mismatch; do not print or log underlying values.

Read the current production `FF_MCP_TOKEN_UI_ENABLED` value. The
`/connections/fibreflow` session list/revoke/Advanced controls require it to be
`true`; if it is absent or false, include that exact server-side flag change in
Hein's production approval and verify it after deployment. Do not change it as
an implicit side effect.

- [ ] **Step 4: Deploy Cortex Agent Executor first**

After hours and with explicit approval:

```bash
bash scripts/deploy_bridge.sh --units cortex-agent-executor
```

The supported script must load the executor unit from the `Cortex-bridge` deploy
clone, restart only the selected user unit, prove its deploy-clone working directory,
fresh/stable PID, and `GET http://127.0.0.1:7406/health` success.

- [ ] **Step 5: Deploy Cortex Bridge, then Remote MCP, through the supported script**

From merged Cortex `main`:

```bash
bash scripts/deploy_bridge.sh --units cortex-bridge
bash scripts/deploy_bridge.sh --verify-only --units cortex-bridge
bash scripts/deploy_bridge.sh --units cortex-remote-mcp
```

Use `--force-hein-ok` only when Hein explicitly approved a daytime rollout. Verify
metadata, service PID stability, loopback binding, public proxy reachability, one
marked-compatible OAuth access/refresh exchange, and the retained unlinked
`/authorize/approve`. Also prove an isolated unsafe unmarked authorization code,
access token, and refresh token fail closed and require re-consent; never require or
accept evidence that an unsafe grant continues working.

- [ ] **Step 6: Append Lew to the live allowlist without replacing entries**

Read the current `CORTEX_SUPER_ADMIN_EMAILS`, normalize/deduplicate it, append `lew@velocityfibre.co.za`, and independently read back the complete resulting set before restart. Abort if any prior entry is missing or `CORTEX_INSTANCE_ID` is not `velocity-fibre`.

Verify that Lew and every configured super-admin receive the distinct tenant-bound
full-read capability, including meeting detail and minutes packs, without becoming
meeting admins. `CORTEX_MEETING_ADMIN_EMAILS` is unchanged, and classify, legal-hold,
process, intake, action, delivery, and other write paths remain denied unless their
separate existing authority allows them.

Activate the allowlist through the supported Bridge path only:

```bash
bash scripts/deploy_bridge.sh --units cortex-bridge
bash scripts/deploy_bridge.sh --verify-only --units cortex-bridge
```

Do not restart unrelated Cortex units for the allowlist change.

- [ ] **Step 7: Deploy FibreFlow production last**

After Cortex Executor, Bridge, Remote MCP, allowlist readback, and health gates pass:

```bash
bash scripts/deploy-local.sh production
```

Verify production health, `/connections/*`, `/cortex`, and `/api/cortex/mcp-consent`
method/auth failure behavior. The new routes are inert until a user starts authorization.

- [ ] **Step 8: Run production acceptance proof**

- Lew connects via the published Cortex endpoint, signs into FibreFlow, consents, and retrieves cited tenant-bound full evidence, including meeting detail and a minutes pack, without copying a token.
- An ordinary employee follows the same flow and remains ACL-limited.
- FibreFlow Operations connector authentication, RBAC, and read-only enforcement remain unchanged.
- `/cortex` contains hero/search/review and the link; `/connections/*` contains setup.
- Neither primary UI contains `/path/to/Cortex`, a local runtime command, or a Cortex bearer.
- Disconnect/reconnect and FibreFlow session revoke behave as proven on dev.

- [ ] **Step 9: Execute rollback in this order if any acceptance gate fails**

1. Remove external exposure first: revert/hide the FibreFlow consent/proxy and connection pages through a FibreFlow rollback PR and the supported production deploy script.
2. Restore Cortex normal authorization to the retained `/authorize/approve` implementation through a reviewed rollback PR that keeps the marker gate and unsafe-grant invalidation, then redeploy Remote MCP.
3. Roll back Bridge read-scope behavior only if required. Remove Lew from `CORTEX_SUPER_ADMIN_EMAILS` only if the access decision itself is being rolled back; preserve every unrelated entry, read back the complete set, and restart only Bridge.
4. Roll back the Agent Executor last if its deployment itself is defective; never restore external FibreFlow exposure before the Cortex chain is healthy again.
5. Keep the FibreFlow MCP connector and marked-compatible Cortex OAuth grants usable. Never preserve, re-enable, or require proof of an unsafe unmarked grant; affected users re-consent through the retained safe flow.

- [ ] **Step 10: Record final evidence**

Record PRs/merge SHAs, deployments, service start times, health responses, test commands, screenshot locations, Lew-vs-ordinary scope proof, and whether rollback was exercised or only held ready. Never record token values, callback secrets, auth cookies, or credential-file contents.
