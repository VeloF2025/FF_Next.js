"""
Microsoft Graph authentication using OAuth2 client credentials flow.
"""

import os
import logging
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
import httpx


logger = logging.getLogger(__name__)


class MSGraphAuth:
    """
    Microsoft Graph OAuth2 authentication.

    Uses client credentials flow for daemon/service applications.
    """

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        tenant_id: str
    ):
        """
        Initialize MS Graph authentication.

        Args:
            client_id: Azure AD application (client) ID
            client_secret: Azure AD client secret
            tenant_id: Azure AD directory (tenant) ID
        """
        self.client_id = client_id
        self.client_secret = client_secret
        self.tenant_id = tenant_id

        self.token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
        self.access_token: Optional[str] = None
        self.token_expires_at: Optional[datetime] = None

        logger.info(f"MSGraphAuth initialized for tenant {tenant_id}")

    async def get_access_token(self, force_refresh: bool = False) -> str:
        """
        Get valid access token (cached or refreshed).

        Args:
            force_refresh: Force token refresh even if cached token valid

        Returns:
            Valid access token

        Raises:
            httpx.HTTPError: If authentication fails
        """
        # Return cached token if still valid
        if not force_refresh and self._is_token_valid():
            return self.access_token

        # Request new token
        await self._refresh_token()
        return self.access_token

    def _is_token_valid(self) -> bool:
        """Check if cached token is still valid."""
        if not self.access_token or not self.token_expires_at:
            return False

        # Consider token valid if >5 minutes remaining
        buffer = timedelta(minutes=5)
        return datetime.now() < (self.token_expires_at - buffer)

    async def _refresh_token(self) -> None:
        """Request new access token from Azure AD."""
        logger.info("Refreshing MS Graph access token...")

        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials"
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.token_url,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"}
            )

            response.raise_for_status()
            token_data = response.json()

        self.access_token = token_data["access_token"]
        expires_in = token_data.get("expires_in", 3600)  # Default 1 hour
        self.token_expires_at = datetime.now() + timedelta(seconds=expires_in)

        logger.info(f"Access token refreshed (expires in {expires_in}s)")

    def get_auth_header(self) -> Dict[str, str]:
        """
        Get authorization header for API requests.

        Returns:
            Dict with Authorization header

        Raises:
            ValueError: If no valid token available
        """
        if not self.access_token:
            raise ValueError("No access token available. Call get_access_token() first.")

        return {"Authorization": f"Bearer {self.access_token}"}


class MSGraphAuthError(Exception):
    """Microsoft Graph authentication error."""
    pass
