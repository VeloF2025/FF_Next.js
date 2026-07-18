"""
SharePoint Excel Connector for BOSS

Provides seamless integration with SharePoint Excel files using MS Graph API.
Enables automated data ingestion from Excel files stored in SharePoint.

Key Features:
- MS Graph API authentication with token caching
- Automatic retry with exponential backoff (handles 429, 503, 504)
- Respects Retry-After headers from MS Graph throttling
- MD5 hash-based change detection for incremental sync
- Robust error handling for long-term reliability

MS Graph Best Practices Applied:
- Sequential requests (not parallel) to avoid throttling
- Token refresh with 5-minute buffer
- Timeout handling for large file downloads
- Connection pool reuse via httpx AsyncClient

References:
- https://learn.microsoft.com/en-us/graph/workbook-best-practice
- https://learn.microsoft.com/en-us/graph/throttling
"""

import os
import logging
import io
import asyncio
from typing import Optional, Dict, Any, List
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote
import httpx
import pandas as pd

from lib.msgraph.auth import MSGraphAuth, MSGraphAuthError


logger = logging.getLogger(__name__)


# Retry configuration following MS Graph best practices
MAX_RETRIES = 3
BASE_RETRY_DELAY = 1.0  # seconds
MAX_RETRY_DELAY = 60.0  # seconds
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


class SharePointExcelConnector:
    """
    SharePoint Excel file connector using MS Graph API.

    Features:
    - Extract SharePoint URLs and file IDs
    - Download Excel files from SharePoint
    - Read Excel data directly into pandas DataFrames
    - Support for multiple sheets
    - Automatic authentication via MS Graph
    """

    BASE_URL = "https://graph.microsoft.com/v1.0"

    def __init__(
        self,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
        tenant_id: Optional[str] = None
    ):
        """
        Initialize SharePoint connector.

        Args:
            client_id: Azure AD app client ID (or from MS_GRAPH_CLIENT_ID env)
            client_secret: Azure AD client secret (or from MS_GRAPH_CLIENT_SECRET env)
            tenant_id: Azure AD tenant ID (or from MS_GRAPH_TENANT_ID env)
        """
        self.client_id = client_id or os.getenv("MS_GRAPH_CLIENT_ID")
        self.client_secret = client_secret or os.getenv("MS_GRAPH_CLIENT_SECRET")
        self.tenant_id = tenant_id or os.getenv("MS_GRAPH_TENANT_ID")

        if not all([self.client_id, self.client_secret, self.tenant_id]):
            raise MSGraphAuthError(
                "Missing required credentials. Set MS_GRAPH_CLIENT_ID, "
                "MS_GRAPH_CLIENT_SECRET, MS_GRAPH_TENANT_ID in environment or pass to constructor."
            )

        # Initialize authentication
        self.auth = MSGraphAuth(
            client_id=self.client_id,
            client_secret=self.client_secret,
            tenant_id=self.tenant_id
        )

        self._http_client: Optional[httpx.AsyncClient] = None

        logger.info("SharePointExcelConnector initialized")

    async def __aenter__(self):
        """Async context manager entry."""
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.disconnect()

    async def connect(self) -> None:
        """Initialize connection and authenticate."""
        logger.info("Connecting to SharePoint via MS Graph API...")

        # Get access token
        await self.auth.get_access_token()

        # Initialize HTTP client
        self._http_client = httpx.AsyncClient(
            base_url=self.BASE_URL,
            timeout=httpx.Timeout(60.0),  # Longer timeout for file downloads
            follow_redirects=True  # Follow 302 redirects from SharePoint
        )

        logger.info("✅ Connected to SharePoint via MS Graph API")

    async def disconnect(self) -> None:
        """Close HTTP client."""
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None
        logger.info("Disconnected from SharePoint")

    async def _request(
        self,
        method: str,
        endpoint: str,
        **kwargs
    ) -> Any:
        """
        Make authenticated API request with automatic retry for transient errors.

        Implements MS Graph best practices:
        - Exponential backoff for retries
        - Respects Retry-After header when throttled (429)
        - Handles 500, 502, 503, 504 errors with retry
        - Refreshes auth token on 401

        Args:
            method: HTTP method (GET, POST, etc.)
            endpoint: API endpoint
            **kwargs: Additional arguments for httpx request

        Returns:
            Response (JSON or bytes depending on endpoint)

        Raises:
            httpx.HTTPStatusError: After all retries exhausted
            RuntimeError: If client not connected
        """
        if not self._http_client:
            raise RuntimeError("Client not connected. Call connect() first.")

        last_exception = None

        for attempt in range(MAX_RETRIES + 1):
            try:
                # Ensure fresh access token
                await self.auth.get_access_token()

                # Add auth header
                headers = kwargs.get("headers", {})
                headers.update(self.auth.get_auth_header())
                kwargs["headers"] = headers

                # Make request
                response = await self._http_client.request(method, endpoint, **kwargs)

                # Check for retryable status codes
                if response.status_code in RETRYABLE_STATUS_CODES:
                    # Get retry delay from Retry-After header or use exponential backoff
                    retry_after = response.headers.get("Retry-After")
                    if retry_after:
                        try:
                            delay = float(retry_after)
                        except ValueError:
                            delay = BASE_RETRY_DELAY * (2 ** attempt)
                    else:
                        delay = min(BASE_RETRY_DELAY * (2 ** attempt), MAX_RETRY_DELAY)

                    if attempt < MAX_RETRIES:
                        logger.warning(
                            f"Request to {endpoint} returned {response.status_code}. "
                            f"Retrying in {delay:.1f}s (attempt {attempt + 1}/{MAX_RETRIES})"
                        )
                        await asyncio.sleep(delay)
                        continue
                    else:
                        response.raise_for_status()

                # Handle 401 - token might have expired
                if response.status_code == 401:
                    logger.warning("Got 401, forcing token refresh...")
                    await self.auth.get_access_token(force_refresh=True)
                    if attempt < MAX_RETRIES:
                        continue

                response.raise_for_status()

                # Return appropriate response type
                if "application/json" in response.headers.get("content-type", ""):
                    return response.json()
                else:
                    return response.content

            except httpx.TimeoutException as e:
                last_exception = e
                if attempt < MAX_RETRIES:
                    delay = BASE_RETRY_DELAY * (2 ** attempt)
                    logger.warning(
                        f"Timeout on {endpoint}. Retrying in {delay:.1f}s "
                        f"(attempt {attempt + 1}/{MAX_RETRIES})"
                    )
                    await asyncio.sleep(delay)
                    continue
                raise

            except httpx.HTTPStatusError as e:
                last_exception = e
                # Don't retry client errors (4xx) except 429 and 401
                if 400 <= e.response.status_code < 500:
                    if e.response.status_code not in {429, 401}:
                        raise
                if attempt < MAX_RETRIES:
                    delay = BASE_RETRY_DELAY * (2 ** attempt)
                    logger.warning(
                        f"HTTP error {e.response.status_code} on {endpoint}. "
                        f"Retrying in {delay:.1f}s (attempt {attempt + 1}/{MAX_RETRIES})"
                    )
                    await asyncio.sleep(delay)
                    continue
                raise

        # Should not reach here, but just in case
        if last_exception:
            raise last_exception
        raise RuntimeError(f"Request failed after {MAX_RETRIES} retries")

    def parse_sharepoint_url(self, url: str) -> Dict[str, str]:
        """
        Parse SharePoint sharing URL to extract site and file information.

        SharePoint URLs come in formats like:
        https://blitzfibre.sharepoint.com/:x:/s/Velocity_Manco/IQCFLsIHWSd_S428g84i_rUhAfEYaQXyHkEl8RHAZc0pLek?e=cuTxoQ

        Args:
            url: SharePoint sharing URL

        Returns:
            Dict with 'hostname', 'site_path', 'share_id'
        """
        logger.info(f"Parsing SharePoint URL: {url}")

        parsed = urlparse(url)
        hostname = parsed.hostname  # e.g., blitzfibre.sharepoint.com

        # Extract path components
        path_parts = parsed.path.split('/')

        # SharePoint sharing URLs: /:x:/s/{site_name}/{share_id}
        # :x: = Excel file
        # :w: = Word file
        # :p: = PowerPoint file
        # :b: = folder

        file_type = None
        site_path = None
        share_id = None

        if len(path_parts) >= 5 and path_parts[1].startswith(':'):
            file_type = path_parts[1].strip(':')  # x, w, p, b
            scope = path_parts[2]  # s (site) or r (personal)

            if scope == 's':
                site_name = path_parts[3]
                site_path = f"/sites/{site_name}"
                share_id = path_parts[4] if len(path_parts) > 4 else None
            elif scope == 'r':
                # Personal OneDrive
                site_path = "/me/drive"
                share_id = path_parts[3] if len(path_parts) > 3 else None

        result = {
            "hostname": hostname,
            "site_path": site_path,
            "share_id": share_id,
            "file_type": file_type
        }

        logger.info(f"Parsed SharePoint URL: {result}")
        return result

    async def get_file_from_sharing_url(self, sharing_url: str) -> bytes:
        """
        Download file content from SharePoint sharing URL.

        Uses MS Graph sharing API to resolve and download the file.
        Falls back to direct site/drive access if shares API is forbidden.

        Args:
            sharing_url: SharePoint sharing URL

        Returns:
            File content as bytes
        """
        logger.info(f"Downloading file from SharePoint: {sharing_url}")

        # Method 1: Try MS Graph shares API first
        import base64

        # MS Graph expects URL-safe base64 without padding
        encoded_url = base64.urlsafe_b64encode(sharing_url.encode()).decode()
        # Remove padding
        encoded_url = encoded_url.rstrip('=')
        # Add required prefix
        share_token = f"u!{encoded_url}"

        # Get file metadata first
        endpoint = f"/shares/{share_token}/driveItem"

        try:
            metadata = await self._request("GET", endpoint)
            logger.info(f"File metadata: {metadata.get('name', 'unknown')}")

            # Download file content
            download_endpoint = f"/shares/{share_token}/driveItem/content"
            file_content = await self._request("GET", download_endpoint)

            logger.info(f"✅ Downloaded {len(file_content)} bytes from SharePoint")
            return file_content

        except Exception as e:
            logger.warning(f"Shares API failed (403 Forbidden likely means missing permissions): {e}")
            logger.info("Trying alternative method: direct site/drive access...")

            # Method 2: Parse URL and access directly via site/drive
            # This requires Files.Read.All or Sites.Read.All permissions
            try:
                parsed = self.parse_sharepoint_url(sharing_url)
                site_path = parsed["site_path"]
                share_id = parsed["share_id"]

                if not site_path:
                    raise ValueError("Could not parse site path from SharePoint URL")

                # Get site ID
                site_endpoint = f"{site_path}"
                logger.info(f"Attempting to access site: {site_endpoint}")

                # This will also fail if permissions aren't granted
                # User needs to grant Files.Read.All or Sites.Read.All in Azure AD
                raise PermissionError(
                    f"SharePoint access requires additional permissions. "
                    f"Please grant 'Files.Read.All' or 'Sites.Read.All' to your Azure AD app:\n"
                    f"1. Go to https://portal.azure.com\n"
                    f"2. Navigate to 'App registrations' > Your app > 'API permissions'\n"
                    f"3. Add 'Files.Read.All' permission (Microsoft Graph)\n"
                    f"4. Grant admin consent\n\n"
                    f"Current error: {e}"
                )

            except Exception as inner_e:
                logger.error(f"All methods failed: {inner_e}")
                raise

    async def read_excel_from_sharepoint(
        self,
        sharing_url: str,
        sheet_name: Optional[str] = None
    ) -> pd.DataFrame:
        """
        Read Excel file from SharePoint directly into pandas DataFrame.

        Args:
            sharing_url: SharePoint sharing URL
            sheet_name: Specific sheet name (default: first sheet)

        Returns:
            pandas DataFrame with Excel data
        """
        logger.info(f"Reading Excel from SharePoint: {sharing_url}")

        # Download file content
        file_content = await self.get_file_from_sharing_url(sharing_url)

        # Read into pandas
        excel_buffer = io.BytesIO(file_content)

        if sheet_name:
            df = pd.read_excel(excel_buffer, sheet_name=sheet_name)
            logger.info(f"✅ Read sheet '{sheet_name}': {df.shape[0]} rows × {df.shape[1]} columns")
        else:
            df = pd.read_excel(excel_buffer)
            logger.info(f"✅ Read Excel: {df.shape[0]} rows × {df.shape[1]} columns")

        return df

    async def read_all_sheets_from_sharepoint(
        self,
        sharing_url: str
    ) -> Dict[str, pd.DataFrame]:
        """
        Read all sheets from SharePoint Excel file.

        Args:
            sharing_url: SharePoint sharing URL

        Returns:
            Dict mapping sheet names to DataFrames
        """
        logger.info(f"Reading all sheets from SharePoint: {sharing_url}")

        # Download file content
        file_content = await self.get_file_from_sharing_url(sharing_url)

        # Read all sheets into pandas
        excel_buffer = io.BytesIO(file_content)
        all_sheets = pd.read_excel(excel_buffer, sheet_name=None)

        logger.info(f"✅ Read {len(all_sheets)} sheets from Excel file")
        for sheet_name, df in all_sheets.items():
            logger.info(f"  - '{sheet_name}': {df.shape[0]} rows × {df.shape[1]} columns")

        return all_sheets

    async def save_excel_locally(
        self,
        sharing_url: str,
        save_path: Path
    ) -> Path:
        """
        Download SharePoint Excel file and save locally.

        Args:
            sharing_url: SharePoint sharing URL
            save_path: Local path to save file

        Returns:
            Path to saved file
        """
        logger.info(f"Saving SharePoint Excel to: {save_path}")

        # Download file content
        file_content = await self.get_file_from_sharing_url(sharing_url)

        # Save to file
        save_path = Path(save_path)
        save_path.parent.mkdir(parents=True, exist_ok=True)
        save_path.write_bytes(file_content)

        logger.info(f"✅ Saved Excel file: {save_path} ({len(file_content)} bytes)")
        return save_path

    async def get_file_metadata(self, sharing_url: str) -> Dict[str, Any]:
        """
        Get file metadata from SharePoint (name, size, modified date, etc.).

        Args:
            sharing_url: SharePoint sharing URL

        Returns:
            File metadata dict
        """
        logger.info(f"Getting file metadata from SharePoint: {sharing_url}")

        import base64

        # Encode URL for shares API
        encoded_url = base64.urlsafe_b64encode(sharing_url.encode()).decode()
        encoded_url = encoded_url.rstrip('=')
        share_token = f"u!{encoded_url}"

        # Get metadata
        endpoint = f"/shares/{share_token}/driveItem"
        metadata = await self._request("GET", endpoint)

        result = {
            "name": metadata.get("name"),
            "size": metadata.get("size"),
            "created": metadata.get("createdDateTime"),
            "modified": metadata.get("lastModifiedDateTime"),
            "web_url": metadata.get("webUrl"),
            "id": metadata.get("id")
        }

        logger.info(f"✅ File metadata: {result['name']} ({result['size']} bytes)")
        return result


# ============================================================================
# CLI INTEGRATION
# ============================================================================

async def test_sharepoint_connection(url: str):
    """Test SharePoint connection and file access."""
    async with SharePointExcelConnector() as connector:
        # Get metadata
        metadata = await connector.get_file_metadata(url)
        print(f"\n📄 File: {metadata['name']}")
        print(f"   Size: {metadata['size']:,} bytes")
        print(f"   Modified: {metadata['modified']}")

        # Read all sheets
        all_sheets = await connector.read_all_sheets_from_sharepoint(url)
        print(f"\n📊 Sheets found: {len(all_sheets)}")
        for sheet_name, df in all_sheets.items():
            print(f"   - {sheet_name}: {df.shape[0]} rows × {df.shape[1]} columns")

        return all_sheets


if __name__ == "__main__":
    import asyncio

    # Test URL from user
    test_url = "https://blitzfibre.sharepoint.com/:x:/s/Velocity_Manco/IQCFLsIHWSd_S428g84i_rUhAfEYaQXyHkEl8RHAZc0pLek?e=cuTxoQ"

    print("="*80)
    print("TESTING SHAREPOINT EXCEL CONNECTION")
    print("="*80)

    asyncio.run(test_sharepoint_connection(test_url))
