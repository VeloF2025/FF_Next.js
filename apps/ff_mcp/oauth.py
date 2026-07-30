"""The OAuth 2.1 authorization-server provider backing the connector.

A near-verbatim copy of ``CortexOAuthProvider`` from Cortex's
``apps/cortex_mcp/server.py`` — reviewed and running in production. Deliberately NOT
"improved": this is the one part of the build where an original bug is a silent auth
bypass. The changes are the token prefixes, the scope name, and the consent redirect,
which sends the user to FibreFlow's own consent page instead of a paste-a-token form.

Lives apart from server.py only to keep both files inside the project's 300-line limit.
"""

from __future__ import annotations

import json
import os
import secrets
import time
import urllib.parse
from pathlib import Path

from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    OAuthAuthorizationServerProvider,
    RefreshToken,
    TokenError,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from pydantic import AnyUrl

from .config import FF_APP_BASE, SCOPE


class FfAuthorizationCode(AuthorizationCode):
    ff_token: str


class FfRefreshToken(RefreshToken):
    ff_token: str
    resource: str | None = None


class FfAccessToken(AccessToken):
    ff_token: str


def _now() -> int:
    return int(time.time())


class FibreFlowOAuthProvider(
    OAuthAuthorizationServerProvider[FfAuthorizationCode, FfRefreshToken, FfAccessToken]
):
    def __init__(self, store_path: Path):
        self.store_path = store_path
        self.store_path.parent.mkdir(parents=True, exist_ok=True)
        self.data = self._load()

    def _load(self) -> dict:
        empty = {"clients": {}, "pending": {}, "codes": {}, "access": {}, "refresh": {}}
        if not self.store_path.exists():
            return empty
        try:
            return json.loads(self.store_path.read_text())
        except Exception as exc:
            # Cortex swallows this with a bare `except: pass`. Starting empty is the only
            # thing we CAN do, but doing it silently means every client registration and
            # every live grant vanishes with no trace and every user is mysteriously
            # logged out. Preserve the file and say so loudly.
            corrupt = self.store_path.with_suffix(self.store_path.suffix + ".corrupt")
            try:
                self.store_path.replace(corrupt)
            except OSError:
                corrupt = None
            print(
                f"[ff-remote-mcp] OAUTH STORE UNREADABLE ({exc}); starting with an empty "
                f"store — every existing grant is gone and all users must reconnect."
                + (f" Previous file kept at {corrupt}." if corrupt else ""),
                flush=True,
            )
            return empty

    def _purge_expired(self) -> None:
        """Drop entries that can no longer be used.

        Without this the store only ever grows: abandoned Connect attempts, unused
        codes and rotated access tokens are removed lazily, on a lookup of that exact
        key, which never comes. The whole dict is re-serialised on every mutation, so
        the file also gets slower to write over the service's uptime.
        """
        now = _now()
        for bucket in ("pending", "codes", "access", "refresh"):
            entries = self.data.get(bucket, {})
            for key in [k for k, v in entries.items() if (v or {}).get("expires_at", 0) < now]:
                del entries[key]

    def _save(self) -> None:
        self._purge_expired()
        tmp = self.store_path.with_suffix(self.store_path.suffix + ".tmp")
        # Created 0600 up front, not chmod'ed after writing: the file holds every
        # connected user's FibreFlow token, and chmod-after-write leaves a window in
        # which it exists at the default umask.
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as handle:
            handle.write(json.dumps(self.data, indent=2, sort_keys=True))
        tmp.replace(self.store_path)

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        raw = self.data["clients"].get(client_id)
        return OAuthClientInformationFull.model_validate(raw) if raw else None

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        if not client_info.redirect_uris:
            raise ValueError("redirect_uris is required")
        client_id = client_info.client_id or "ffmcp_" + secrets.token_urlsafe(24)
        client_secret = (
            None
            if client_info.token_endpoint_auth_method == "none"
            else client_info.client_secret or secrets.token_urlsafe(32)
        )
        full = client_info.model_copy(
            update={
                "client_id": client_id,
                "client_secret": client_secret,
                "client_id_issued_at": _now(),
                "client_secret_expires_at": 0 if client_secret else None,
                "scope": client_info.scope or SCOPE,
            }
        )
        self.data["clients"][client_id] = full.model_dump(mode="json")
        self._save()

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        pending_id = secrets.token_urlsafe(24)
        self.data["pending"][pending_id] = {
            "client_id": client.client_id,
            "scopes": params.scopes or [SCOPE],
            "code_challenge": params.code_challenge,
            "redirect_uri": str(params.redirect_uri),
            "redirect_uri_provided_explicitly": params.redirect_uri_provided_explicitly,
            "resource": params.resource,
            "state": params.state,
            "expires_at": _now() + 600,
        }
        self._save()
        # The one real divergence from Cortex: send the user to FibreFlow's own consent
        # page (where they already have a session) instead of a paste-your-token form.
        return FF_APP_BASE + "/mcp/authorize?state_id=" + urllib.parse.quote(pending_id)

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> FfAuthorizationCode | None:
        raw = self.data["codes"].get(authorization_code)
        return FfAuthorizationCode.model_validate(raw) if raw else None

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: FfAuthorizationCode
    ) -> OAuthToken:
        self.data["codes"].pop(authorization_code.code, None)
        access = "ffa_" + secrets.token_urlsafe(32)
        refresh = "ffr_" + secrets.token_urlsafe(32)
        expires_in = 3600
        access_obj = FfAccessToken(
            token=access,
            client_id=client.client_id or "",
            scopes=authorization_code.scopes,
            expires_at=_now() + expires_in,
            resource=authorization_code.resource,
            ff_token=authorization_code.ff_token,
        )
        refresh_obj = FfRefreshToken(
            token=refresh,
            client_id=client.client_id or "",
            scopes=authorization_code.scopes,
            expires_at=_now() + 30 * 24 * 3600,
            resource=authorization_code.resource,
            ff_token=authorization_code.ff_token,
        )
        self.data["access"][access] = access_obj.model_dump(mode="json")
        self.data["refresh"][refresh] = refresh_obj.model_dump(mode="json")
        self._save()
        return OAuthToken(
            access_token=access,
            refresh_token=refresh,
            expires_in=expires_in,
            scope=" ".join(authorization_code.scopes),
        )

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> FfRefreshToken | None:
        raw = self.data["refresh"].get(refresh_token)
        return FfRefreshToken.model_validate(raw) if raw else None

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: FfRefreshToken,
        scopes: list[str],
    ) -> OAuthToken:
        if refresh_token.expires_at and refresh_token.expires_at < _now():
            raise TokenError("invalid_grant", "refresh token expired")
        access = "ffa_" + secrets.token_urlsafe(32)
        expires_in = 3600
        access_obj = FfAccessToken(
            token=access,
            client_id=client.client_id or "",
            scopes=scopes or refresh_token.scopes,
            expires_at=_now() + expires_in,
            resource=refresh_token.resource,
            ff_token=refresh_token.ff_token,
        )
        self.data["access"][access] = access_obj.model_dump(mode="json")
        self._save()
        return OAuthToken(
            access_token=access,
            refresh_token=refresh_token.token,
            expires_in=expires_in,
            scope=" ".join(access_obj.scopes),
        )

    async def load_access_token(self, token: str) -> FfAccessToken | None:
        raw = self.data["access"].get(token)
        if not raw:
            return None
        access = FfAccessToken.model_validate(raw)
        if access.expires_at and access.expires_at < _now():
            self.data["access"].pop(token, None)
            self._save()
            return None
        return access

    async def revoke_token(self, token: FfAccessToken | FfRefreshToken) -> None:
        self.data["access"].pop(token.token, None)
        self.data["refresh"].pop(token.token, None)
        self._save()

    def peek_pending(self, pending_id: str) -> dict | None:
        """Read a pending request WITHOUT consuming it.

        Consumption belongs to complete_pending. Splitting them means a callback that
        fails token validation leaves the state intact, so the user can retry from
        Claude instead of the request being silently burned.
        """
        pending = self.data["pending"].get(pending_id)
        if not pending or pending.get("expires_at", 0) < _now():
            return None
        return pending

    def complete_pending(self, pending_id: str, ff_token: str) -> tuple[str, str, str | None]:
        pending = self.data["pending"].pop(pending_id, None)
        if not pending or pending.get("expires_at", 0) < _now():
            raise ValueError(
                "Authorization request expired. Return to Claude and click Connect again."
            )
        code = "ffc_" + secrets.token_urlsafe(32)
        auth_code = FfAuthorizationCode(
            code=code,
            scopes=pending["scopes"],
            expires_at=_now() + 300,
            client_id=pending["client_id"],
            code_challenge=pending["code_challenge"],
            redirect_uri=AnyUrl(pending["redirect_uri"]),
            redirect_uri_provided_explicitly=pending["redirect_uri_provided_explicitly"],
            resource=pending.get("resource"),
            ff_token=ff_token,
        )
        self.data["codes"][code] = auth_code.model_dump(mode="json")
        self._save()
        return pending["redirect_uri"], code, pending.get("state")
