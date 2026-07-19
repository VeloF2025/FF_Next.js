#!/usr/bin/env python
"""
1Map Specialist Agent

A comprehensive agent with deep knowledge of the 1Map GIS platform API.
This agent is automatically invoked when BOSS needs to interact with 1Map
for DR verification, photo retrieval, project queries, and GIS operations.

Key Capabilities:
- DR (Drop) record lookup and management
- Photo attachment retrieval and download
- Photo upload to DR records (NEW)
- Project/Site filtering and access control
- GIS layer queries
- Address geocoding

API Knowledge Base:
- Base URL: https://www.1map.co.za/api/v1
- Authentication: Token-based via /auth/login
- Data format: GeoJSON FeatureCollection
- Filter syntax: CQL_FILTER parameter (OGC standard)
- Layer ID for Fibertime Installations: 5121
"""

import asyncio
import logging
import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

# --- Per-project account gating (1Map, 2026-07-14) ---------------------------
# 1Map split each user into per-project "accounts"; the v1 token API has NO
# account selector, so it only ever sees the default (Etwatwa) account. A DR in
# any other project is invisible to the v1 query. The web-session login DOES take
# an account_id, so we fall back to it (per project) to fetch the record; photo
# binaries then still download via the v1 attachment endpoint, which is NOT
# account-scoped. Etwatwa (1862) stays on the v1 path — this fallback only runs
# when the v1 query finds nothing, so the working path is never touched.
WEB_BASE_URL = "https://www.1map.co.za"
WEB_ACCOUNT_IDS = ["1876", "1877", "1867", "2093"]  # LAWLEY, MAMELODI, MOHADIN, TEMBISA

# Non-default project accounts use a cookie web-login, cached per account_id with a
# short TTL (_WEB_SESSION_TTL). Two failure modes bound this design:
#   1. Cache FOREVER (old bug): 1Map silently expires the cookie server-side after
#      ~2 days — getattributes then returns HTTP 200 with an EMPTY result and no
#      error to catch, so every non-ETW lookup silently returns "not found"
#      (2026-07-17 regression).
#   2. Login PER REQUEST (also bad): floods 1Map's login endpoint, which then
#      rate-limits the whole account (HTTP 413) under any burst — e.g. the hourly
#      catch-up sweep — taking the entire service down (2026-07-18).
# A ~20-min TTL threads both: sessions refresh long before the ~2-day expiry, and
# logins stay ~3/account/hour even under load. A per-account lock prevents duplicate
# concurrent logins. Accounts are queried CONCURRENTLY (see _web_get_dr).
_WEB_SESSION_TTL = 1200.0  # seconds (20 min); << 1Map's ~2-day silent cookie expiry
# account_id -> (created_monotonic, client)
_WEB_SESSIONS: Dict[str, Tuple[float, httpx.AsyncClient]] = {}
_WEB_LOCKS: Dict[str, asyncio.Lock] = {}


class PhotoType(Enum):
    """Standard photo types in Fibertime installations."""
    PROPERTY = "ph_prop"           # Property/house front photo
    SIGNATURE_1 = "ph_sign1"       # Customer signature (signup)
    SIGNATURE_2 = "ph_sign2"       # Customer signature (completion)
    SIGNATURE_3 = "ph_sign3"       # Pole permission signature
    POWER_METER_1 = "ph_powm1"     # Power meter before
    POWER_METER_2 = "ph_powm2"     # Power meter after
    DROP_CABLE = "ph_drop"         # Drop cable installation
    CONNECTION_1 = "ph_conn1"      # Connection point 1
    HOUSEHOLD_1 = "ph_hh1"         # Household photo 1
    HOUSEHOLD_2 = "ph_hh2"         # Household photo 2
    WALL_MOUNT = "ph_wall"         # Wall mount location
    HOME_LINE = "ph_hm_ln"         # Home line entry
    HOME_ENTRY = "ph_hm_en"        # Home entry point
    OUTSIDE = "ph_outs"            # Outside view
    ONT_SERIAL = "ph_ont"          # ONT serial number (not a photo)
    BOX_LABEL = "ph_bl"            # Box label
    CABLE_ROUTE = "ph_cbl_r"       # Cable route
    AFTER = "ph_after"             # After completion


@dataclass
class PropertyRecord:
    """
    Represents a single Property ID (transaction) within a DR.

    Property IDs are transaction records - a new one is created each time
    an action/stage is performed on a DR (signup, pole permission, installation, etc.).
    Each Property ID has its own set of photos relevant to that stage.
    """
    primary_id: str      # Transaction ID (e.g., "391251")
    feature_id: str      # Full feature ID (e.g., "fibertime_installations.391251")
    status: Optional[str] = None  # Stage status (e.g., "Home Installation: Installed")
    photos: Dict[str, int] = field(default_factory=dict)  # photo_type -> attachment_id
    raw_data: Dict[str, Any] = field(default_factory=dict)


@dataclass
class DRRecord:
    """
    Represents a Drop Record from 1Map with all its Property IDs (transactions).

    Data Model:
    - DR Number = Unique ID for the physical location/customer (e.g., "DR1733592")
    - Property ID = Transaction ID - created for each action/stage on the DR

    A single DR can have multiple Property IDs because each stage creates a new transaction:
    - Signup Stage → Property ID with signup photos
    - Pole Permission → Property ID with pole photos
    - Installation → Property ID with installation photos
    - Completion → Property ID with final photos

    To get the COMPLETE picture, collect photos from ALL Property IDs.
    """
    dr_number: str       # Unique ID for the location (e.g., "DR1733592")
    primary_id: str      # Primary ID of first/main record (for backwards compatibility)
    feature_id: str      # Feature ID of first/main record
    site: str            # Project/Site code (e.g., LAW, KWN)
    status: Optional[str] = None       # Status of first/main record
    address: Optional[str] = None
    coordinates: Optional[Dict[str, float]] = None
    photos: Dict[str, int] = field(default_factory=dict)  # Combined photos from ALL Property IDs
    raw_data: Dict[str, Any] = field(default_factory=dict)
    # All Property IDs (transactions) for this DR
    property_records: List['PropertyRecord'] = field(default_factory=list)


@dataclass
class PhotoDownload:
    """Result of a photo download operation."""
    photo_type: str
    attachment_id: int
    content: bytes
    filename: str
    size: int


class OneMapSpecialistAgent:
    """
    1Map GIS Specialist Agent

    Expert knowledge of 1Map API for Fibertime fiber installation management.
    Automatically handles authentication, filtering, and data retrieval.

    Usage:
        agent = OneMapSpecialistAgent()
        await agent.connect()

        # Find a DR record
        record = await agent.get_dr("DR1733592")

        # Download all photos
        photos = await agent.download_all_photos(record, output_dir="/photos")

        # Upload a photo to a DR
        result = await agent.upload_dr_photo("DR1733592", "/path/to/photo.jpg", "ph_test")

        # Search by project
        records = await agent.search_by_project("LAW", status="Installed")

        await agent.disconnect()
    """

    # API Configuration
    BASE_URL = "https://www.1map.co.za/api/v1"
    FIBERTIME_LAYER_ID = "5121"
    DR_FIELD = "drp"

    # Known projects/sites
    KNOWN_SITES = {
        "LAW": "Lawley",
        "KWN": "KwaNobuhle",
        "KWM": "KwaMashu",
        "KWA": "Kwazakhele",
        "NTU": "Ntuzuma",
        "INA": "Inanda",
        "ALE": "Alexandra",
        "GRH": "Grahamstown/Rini",
        "MOA": "Moakeng/Ikageng",
        "ORA": "Orange Farm",
        "ZAM": "Zamdela",
        "LAN": "Langaville",
        "NYA": "Nyanga/Guguletu",
        "OLI": "Olievenhoutbos",
        "WEL": "Wells Estate",
    }

    # Status categories
    STATUS_CATEGORIES = {
        "installed": ["Home Installation: Installed"],
        "approved": ["Home Sign Ups: Approved & Installation Scheduled"],
        "declined": ["Home Sign Ups: Declined"],
        "pole_approved": ["Pole Permission: Approved"],
        "brand_awareness": ["Brand Awareness"],
    }

    def __init__(
        self,
        email: Optional[str] = None,
        password: Optional[str] = None,
        allowed_sites: Optional[List[str]] = None
    ):
        """
        Initialize the 1Map Specialist Agent.

        Args:
            email: 1Map account email (defaults to ONEMAP_EMAIL env var)
            password: 1Map account password (defaults to ONEMAP_PASSWORD env var)
            allowed_sites: List of site codes this agent can access (None = all)
        """
        self.email = email or os.getenv("ONEMAP_EMAIL")
        self.password = password or os.getenv("ONEMAP_PASSWORD")
        self.allowed_sites = allowed_sites

        if not self.email or not self.password:
            raise ValueError(
                "1Map credentials required. Set ONEMAP_EMAIL and ONEMAP_PASSWORD "
                "environment variables or pass to constructor."
            )

        self._token: Optional[str] = None
        self._token_expires: Optional[datetime] = None
        self._client: Optional[httpx.AsyncClient] = None

        logger.info("OneMapSpecialistAgent initialized")
        if allowed_sites:
            logger.info(f"Access restricted to sites: {allowed_sites}")

    async def connect(self) -> None:
        """Establish connection and authenticate with 1Map API."""
        self._client = httpx.AsyncClient(
            base_url=self.BASE_URL,
            timeout=60.0,
            headers={"User-Agent": "BOSS/1.0 OneMapSpecialistAgent"}
        )

        await self._authenticate()
        logger.info("Connected to 1Map API")

    async def disconnect(self) -> None:
        """Close the API connection."""
        if self._client:
            await self._client.aclose()
            self._client = None
            self._token = None
        # _WEB_SESSIONS are process-wide, TTL-cached, and intentionally NOT closed
        # here — they're reused across requests until they expire (see _web_session).
        logger.info("Disconnected from 1Map API")

    async def __aenter__(self):
        await self.connect()
        return self

    async def __aexit__(self, *args):
        await self.disconnect()

    async def _authenticate(self) -> None:
        """Authenticate and obtain API token."""
        response = await self._client.get(
            "/auth/login",
            params={"email": self.email, "password": self.password}
        )

        if response.status_code != 200:
            raise Exception(f"Authentication failed: {response.status_code}")

        data = response.json()
        api_token = data.get("apiToken", {})
        self._token = api_token.get("token") if isinstance(api_token, dict) else None

        if not self._token:
            raise Exception("No token received from authentication")

        # Token is valid for 2 hours
        self._token_expires = datetime.now()

        logger.debug("Successfully authenticated with 1Map")

    async def _request(
        self,
        method: str,
        endpoint: str,
        params: Optional[Dict] = None,
        **kwargs
    ) -> Dict:
        """Make an authenticated API request."""
        if params is None:
            params = {}
        params["token"] = self._token

        response = await self._client.request(method, endpoint, params=params, **kwargs)

        if response.status_code != 200:
            raise Exception(f"API request failed: {response.status_code} - {response.text[:200]}")

        return response.json()

    async def _request_binary(
        self,
        endpoint: str,
        params: Optional[Dict] = None
    ) -> bytes:
        """Make an authenticated API request for binary data (photos)."""
        if params is None:
            params = {}
        params["token"] = self._token

        response = await self._client.get(endpoint, params=params)

        if response.status_code != 200:
            raise Exception(f"Binary request failed: {response.status_code}")

        content = response.content

        # Validate photo content - reject placeholder GIFs
        MIN_PHOTO_SIZE = 1024  # 1KB minimum for real photos
        if len(content) < MIN_PHOTO_SIZE:
            # Check if it's a GIF placeholder
            if content.startswith(b'GIF89a') or content.startswith(b'GIF87a'):
                logger.warning(f"Rejected placeholder GIF ({len(content)} bytes) from {endpoint}")
                raise Exception(f"Photo not available (placeholder GIF returned, {len(content)} bytes)")
            logger.warning(f"Photo too small ({len(content)} bytes) from {endpoint}")
            raise Exception(f"Photo too small ({len(content)} bytes, minimum {MIN_PHOTO_SIZE} bytes)")

        return content

    def _check_site_access(self, site: str) -> bool:
        """Check if access to a site is allowed."""
        if self.allowed_sites is None:
            return True
        return site in self.allowed_sites

    # =========================================================================
    # DR RECORD OPERATIONS
    # =========================================================================

    async def get_dr(self, dr_number: str) -> Optional[DRRecord]:
        """
        Fetch a DR record by DR number, including ALL Property IDs.

        A single DR can have multiple Property IDs (transactions) representing
        different stages (signup, installation, etc.). This method fetches all
        of them and combines their photos.

        Args:
            dr_number: The DR number (e.g., "DR1733592")

        Returns:
            DRRecord with combined photos from all Property IDs, None if not found

        Raises:
            PermissionError: If the DR's site is not in allowed_sites
        """
        logger.info(f"Fetching DR: {dr_number}")

        # Normalize DR number
        if not dr_number.upper().startswith("DR"):
            dr_number = f"DR{dr_number}"

        data = await self._request(
            "GET",
            f"/attributes/{self.FIBERTIME_LAYER_ID}/unsorted",
            params={
                "includeData": "true",
                "CQL_FILTER": f"{self.DR_FIELD}='{dr_number}'"
            }
        )

        features = data.get("result", {}).get("geomResult", {}).get("features", [])

        if not features:
            # v1 (default Etwatwa account) sees nothing → try the per-project
            # web-session fallback before giving up (account-gating workaround).
            web_record = await self._web_get_dr(dr_number)
            if web_record:
                return web_record
            logger.warning(f"DR {dr_number} not found")
            return None

        # Parse ALL features (Property IDs) for this DR
        property_records = []
        combined_photos = {}
        main_record = None

        for i, feature in enumerate(features):
            record = self._parse_feature(feature)

            # Create PropertyRecord for each feature
            prop_record = PropertyRecord(
                primary_id=record.primary_id,
                feature_id=record.feature_id,
                status=record.status,
                photos=record.photos.copy(),
                raw_data=record.raw_data
            )
            property_records.append(prop_record)

            # Combine photos from all Property IDs
            # Use format: photo_type -> (attachment_id, property_index) to track source
            for photo_type, attachment_id in record.photos.items():
                if photo_type not in combined_photos:
                    combined_photos[photo_type] = attachment_id
                else:
                    # If same photo type exists, use unique key with property index
                    unique_key = f"{photo_type}_{i+1}"
                    combined_photos[unique_key] = attachment_id

            # Use first record as main record (for backwards compatibility)
            if main_record is None:
                main_record = record

        # Check site access
        if not self._check_site_access(main_record.site):
            raise PermissionError(
                f"Access denied to site '{main_record.site}'. "
                f"Allowed sites: {self.allowed_sites}"
            )

        # Create combined DRRecord with all Property IDs
        main_record.photos = combined_photos
        main_record.property_records = property_records

        logger.info(f"Found DR {dr_number} in site {main_record.site} with {len(property_records)} Property ID(s) and {len(combined_photos)} total photos")
        return main_record

    async def _web_session(self, account_id: str) -> Optional[httpx.AsyncClient]:
        """Return a TTL-cached cookie-auth web session for a project account_id.

        The v1 token API cannot select an account, so non-default projects are only
        reachable via the web login (which takes account_id; no reCAPTCHA on this
        POST). Sessions are cached per account and reused for up to _WEB_SESSION_TTL,
        then re-logged-in. This bounds login volume (1Map rate-limits its login
        endpoint with HTTP 413 under bursts) while refreshing well before 1Map's
        ~2-day silent cookie expiry. A per-account lock prevents duplicate concurrent
        logins. Cached sessions are NOT closed by callers. Returns None on failure.
        """
        now = time.monotonic()
        cached = _WEB_SESSIONS.get(account_id)
        if cached is not None and (now - cached[0]) < _WEB_SESSION_TTL:
            return cached[1]
        lock = _WEB_LOCKS.setdefault(account_id, asyncio.Lock())
        async with lock:
            cached = _WEB_SESSIONS.get(account_id)  # re-check under lock
            if cached is not None and (time.monotonic() - cached[0]) < _WEB_SESSION_TTL:
                return cached[1]
            # Expired (or absent): drop and close the stale client before re-login.
            if cached is not None:
                _WEB_SESSIONS.pop(account_id, None)
                try:
                    await cached[1].aclose()
                except Exception:
                    pass
            client = httpx.AsyncClient(
                base_url=WEB_BASE_URL, timeout=30.0, follow_redirects=True,
                headers={"User-Agent": "Mozilla/5.0"},
            )
            try:
                page = (await client.get("/login")).text
                m = re.search(r'name="_csrf"[^>]*value="([^"]+)"', page)
                csrf = m.group(1) if m else ""
                resp = await client.post("/login", data={
                    "_csrf": csrf, "email": self.email,
                    "password": self.password, "account_id": account_id,
                })
                if "/dashboard" not in str(resp.url):
                    await client.aclose()
                    return None
                # init layer access (required before getattributes works)
                await client.get(f"/app?layer={self.FIBERTIME_LAYER_ID}")
                _WEB_SESSIONS[account_id] = (time.monotonic(), client)
                return client
            except Exception as e:
                logger.warning(f"1Map web login failed for account {account_id}: {e}")
                try:
                    await client.aclose()
                except Exception:
                    pass
                return None

    def _build_web_record(self, dr_number: str, rec: Dict) -> DRRecord:
        """Build a DRRecord from a web getattributes row (mirrors _parse_feature)."""
        prop_id = str(rec.get("prop_id") or "")
        photos: Dict[str, int] = {}
        for pt in PhotoType:
            if pt == PhotoType.ONT_SERIAL:
                continue
            att = rec.get(pt.value)
            if att and str(att).strip():
                first = str(att).split(",")[0].strip()
                try:
                    photos[pt.value] = int(first)
                except ValueError:
                    pass
        coordinates = None
        try:
            lat, lng = rec.get("latitude"), rec.get("longitude")
            if lat and lng:
                coordinates = {"lat": float(lat), "lng": float(lng)}
        except (TypeError, ValueError):
            pass
        feature_id = f"{self.FIBERTIME_LAYER_ID}.{prop_id}"
        prop_record = PropertyRecord(
            primary_id=prop_id, feature_id=feature_id,
            status=rec.get("status"), photos=photos.copy(), raw_data=rec,
        )
        return DRRecord(
            dr_number=dr_number, primary_id=prop_id, feature_id=feature_id,
            site=rec.get("site", "unknown"), status=rec.get("status"),
            address=rec.get("address"), coordinates=coordinates,
            photos=photos, raw_data=rec, property_records=[prop_record],
        )

    async def _query_web_account(self, account_id: str, dr_number: str) -> Optional[DRRecord]:
        """Look up a DR in one project account via its web session.

        Retries once if the getattributes call throws — i.e. 1Map served the login
        page HTML instead of JSON, meaning the cached cookie died before its TTL.
        Drop that session and re-login. This does NOT catch the silent-expiry case
        (HTTP 200 + empty result); the TTL refresh in _web_session bounds that. The
        cached client is not closed here — it is reused across requests.
        """
        for _attempt in (1, 2):
            client = await self._web_session(account_id)
            if not client:
                return None
            try:
                resp = await client.post("/api/apps/app/getattributes", data={
                    "ungeocoded": "false", "left": "0", "bottom": "0", "right": "0", "top": "0",
                    "selfilter": "", "action": "get", "email": self.email,
                    "layerid": self.FIBERTIME_LAYER_ID, "sort": "prop_id",
                    "templateExpression": "", "q": dr_number,
                    "page": "1", "start": "0", "limit": "20",
                })
                data = resp.json()
            except Exception as e:
                stale = _WEB_SESSIONS.pop(account_id, None)
                if stale is not None:
                    try:
                        await stale[1].aclose()
                    except Exception:
                        pass
                    continue  # cookie died early — retry once with a fresh login
                logger.warning(f"1Map web getattributes failed (account {account_id}) for {dr_number}: {e}")
                return None
            for rec in (data.get("result") or []):
                if rec.get(self.DR_FIELD) == dr_number:
                    record = self._build_web_record(dr_number, rec)
                    logger.info(f"DR {dr_number} found via web-session account {account_id} (site {record.site})")
                    return record
            return None
        return None

    async def _web_get_dr(self, dr_number: str) -> Optional[DRRecord]:
        """Per-project web-session fallback for get_dr (account-gating workaround).

        Queries all non-default project accounts CONCURRENTLY (must stay under
        FibreFlow's 5s fetchOneMapRecord abort — sequential logins did not) and
        returns the first exact drp match. Photo binaries still download via the
        v1 attachment endpoint, which is not account-scoped.
        """
        tasks = [self._query_web_account(acct, dr_number) for acct in WEB_ACCOUNT_IDS]
        for result in await asyncio.gather(*tasks, return_exceptions=True):
            if isinstance(result, DRRecord):
                return result
        return None

    async def search_dr(
        self,
        dr_pattern: str,
        limit: int = 100
    ) -> List[DRRecord]:
        """
        Search for DR records matching a pattern.

        Args:
            dr_pattern: DR number pattern (supports wildcards with %)
            limit: Maximum records to return

        Returns:
            List of matching DRRecord objects
        """
        logger.info(f"Searching for DRs matching: {dr_pattern}")

        # Build CQL filter
        if "%" in dr_pattern:
            cql_filter = f"{self.DR_FIELD} LIKE '{dr_pattern}'"
        else:
            cql_filter = f"{self.DR_FIELD}='{dr_pattern}'"

        data = await self._request(
            "GET",
            f"/attributes/{self.FIBERTIME_LAYER_ID}/unsorted",
            params={
                "includeData": "true",
                "CQL_FILTER": cql_filter,
                "limit": limit
            }
        )

        features = data.get("result", {}).get("geomResult", {}).get("features", [])
        records = []

        for feature in features:
            record = self._parse_feature(feature)
            if self._check_site_access(record.site):
                records.append(record)

        logger.info(f"Found {len(records)} matching records")
        return records

    async def search_by_project(
        self,
        site: str,
        status: Optional[str] = None,
        limit: int = 100
    ) -> List[DRRecord]:
        """
        Search for DR records by project/site.

        Args:
            site: Site code (e.g., "LAW", "KWN")
            status: Optional status filter
            limit: Maximum records to return

        Returns:
            List of DRRecord objects
        """
        if not self._check_site_access(site):
            raise PermissionError(f"Access denied to site '{site}'")

        logger.info(f"Searching site {site}")

        # Build CQL filter
        cql_filter = f"site='{site}'"
        if status:
            cql_filter += f" AND status='{status}'"

        data = await self._request(
            "GET",
            f"/attributes/{self.FIBERTIME_LAYER_ID}/unsorted",
            params={
                "includeData": "true",
                "CQL_FILTER": cql_filter,
                "limit": limit
            }
        )

        features = data.get("result", {}).get("geomResult", {}).get("features", [])
        records = [self._parse_feature(f) for f in features]

        logger.info(f"Found {len(records)} records in site {site}")
        return records

    def _parse_feature(self, feature: Dict) -> DRRecord:
        """Parse a GeoJSON feature into a DRRecord."""
        props = feature.get("properties", {})
        feature_id = feature.get("id", "")
        primary_id = feature_id.split(".")[-1] if "." in feature_id else ""

        # Extract coordinates
        geometry = feature.get("geometry", {})
        coords = geometry.get("coordinates", [])
        coordinates = None
        if coords and len(coords) >= 2:
            coordinates = {"lng": coords[0], "lat": coords[1]}

        # Extract photo attachment IDs
        photos = {}
        for photo_type in PhotoType:
            if photo_type == PhotoType.ONT_SERIAL:
                continue  # This is serial number, not a photo
            attachment_id = props.get(photo_type.value)
            if attachment_id:
                # Handle comma-separated IDs (take first)
                if "," in str(attachment_id):
                    attachment_id = str(attachment_id).split(",")[0]
                try:
                    photos[photo_type.value] = int(attachment_id)
                except ValueError:
                    pass

        return DRRecord(
            dr_number=props.get(self.DR_FIELD, ""),
            primary_id=primary_id,
            feature_id=feature_id,
            site=props.get("site", "unknown"),
            status=props.get("status"),
            address=props.get("address"),
            coordinates=coordinates,
            photos=photos,
            raw_data=props
        )

    # =========================================================================
    # PHOTO OPERATIONS
    # =========================================================================

    async def upload_photo(
        self,
        layer_id: str,
        property_id: int,
        photo_path: str,
        field_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Upload a photo to a 1Map property.

        Args:
            layer_id: Layer ID (e.g., "5121" for Fibertime Installations)
            property_id: Property ID (transaction ID)
            photo_path: Path to the photo file to upload
            field_name: Optional field name (e.g., "ph_test", "ph_prop")

        Returns:
            API response with upload status

        Raises:
            FileNotFoundError: If photo_path doesn't exist
            Exception: If upload fails
        """
        import os
        from pathlib import Path

        photo_file = Path(photo_path)
        if not photo_file.exists():
            raise FileNotFoundError(f"Photo not found: {photo_path}")

        logger.info(f"Uploading {photo_file.name} ({photo_file.stat().st_size} bytes) to Property ID {property_id}")

        # Prepare multipart form data
        with open(photo_path, 'rb') as f:
            files = {
                'file': (photo_file.name, f, 'image/jpeg')
            }

            # Build parameters
            params = {
                "layer_id": layer_id,
                "property_id": property_id,
                "token": self._token
            }

            if field_name:
                params["field_name"] = field_name

            # Try primary upload endpoint
            upload_url = f"{self.BASE_URL.replace('/v1', '')}/apps/app/attachments/upload"

            # Never log the bearer token in cleartext: for its ~2h validity it is
            # a full session credential, and this debug line reaches handlers the
            # moment anyone enables DEBUG to chase an upload issue.
            _log_params = {**params, "token": "***REDACTED***"} if "token" in params else params
            logger.debug(f"POST {upload_url} with params: {_log_params}")

            response = await self._client.post(
                upload_url,
                data=params,
                files=files
            )

            if response.status_code != 200:
                raise Exception(
                    f"Upload failed: {response.status_code} - {response.text[:200]}"
                )

            result = response.json()
            logger.info(f"Upload successful: {result}")
            return result

    async def upload_dr_photo(
        self,
        dr_number: str,
        photo_path: str,
        photo_type: str = "ph_test"
    ) -> Dict[str, Any]:
        """
        Upload a photo to a DR record's most recent Property ID.

        This is a convenience method that automatically finds the DR,
        gets its most recent Property ID, and uploads to that transaction.

        Args:
            dr_number: The DR number (e.g., "DR1733592")
            photo_path: Path to the photo file to upload
            photo_type: Photo type field name (e.g., "ph_prop", "ph_test")

        Returns:
            API response with upload status

        Raises:
            ValueError: If DR not found
            FileNotFoundError: If photo doesn't exist
            Exception: If upload fails
        """
        # Get the DR record
        record = await self.get_dr(dr_number)
        if not record:
            raise ValueError(f"DR {dr_number} not found")

        # Use the most recent Property ID (last in the list)
        if record.property_records:
            property_record = record.property_records[-1]
            property_id = int(property_record.primary_id)
            logger.info(f"Using Property ID {property_id} ({property_record.status})")
        else:
            property_id = int(record.primary_id)
            logger.info(f"Using primary Property ID {property_id}")

        # Upload to this Property ID
        return await self.upload_photo(
            layer_id=self.FIBERTIME_LAYER_ID,
            property_id=property_id,
            photo_path=photo_path,
            field_name=photo_type
        )

    async def download_photo(
        self,
        primary_id: str,
        attachment_id: int,
        photo_type: str = "photo"
    ) -> PhotoDownload:
        """
        Download a single photo by attachment ID.

        Args:
            primary_id: The primary ID of the record (from feature_id)
            attachment_id: The attachment ID from the record
            photo_type: The photo type name for logging

        Returns:
            PhotoDownload object with binary content
        """
        logger.debug(f"Downloading photo {photo_type} (ID: {attachment_id}) for record {primary_id}")

        # Try primary layer first (Layer 5121 - Fibertime Installations)
        content = None
        try:
            content = await self._request_binary(
                f"/attachments/file/{self.FIBERTIME_LAYER_ID}/{primary_id}/{attachment_id}"
            )
        except Exception as e:
            # If Layer 5121 returns placeholder GIF, try Layer 5658
            logger.warning(f"Photo {photo_type} failed from Layer {self.FIBERTIME_LAYER_ID}: {e}")
            logger.info(f"Trying Layer 5658 for photo {photo_type} (attachment {attachment_id})")
            try:
                content = await self._request_binary(
                    f"/attachments/file/5658/{primary_id}/{attachment_id}"
                )
                logger.info(f"Found real photo in Layer 5658 ({len(content)} bytes)")
            except Exception as e2:
                logger.error(f"Layer 5658 also failed: {e2}")
                # Re-raise original exception
                raise Exception(f"Photo {photo_type} not available in Layer {self.FIBERTIME_LAYER_ID} or Layer 5658")

        return PhotoDownload(
            photo_type=photo_type,
            attachment_id=attachment_id,
            content=content,
            filename=f"{photo_type}_{attachment_id}.jpg",
            size=len(content)
        )

    async def download_all_photos(
        self,
        record: DRRecord,
        output_dir: Optional[str] = None
    ) -> List[PhotoDownload]:
        """
        Download all photos for a DR record from ALL Property IDs.

        Args:
            record: The DRRecord to download photos for (includes all Property IDs)
            output_dir: Optional directory to save photos (creates if needed)

        Returns:
            List of PhotoDownload objects
        """
        # Calculate total photos across all Property IDs
        total_photos = sum(len(pr.photos) for pr in record.property_records) if record.property_records else len(record.photos)
        logger.info(f"Downloading {total_photos} photos for DR {record.dr_number} from {len(record.property_records)} Property ID(s)")

        downloads = []

        # If we have property_records, download from each one with correct primary_id
        if record.property_records:
            for prop_idx, prop_record in enumerate(record.property_records):
                logger.debug(f"Processing Property ID {prop_idx + 1}: {prop_record.primary_id} ({prop_record.status})")

                for photo_type, attachment_id in prop_record.photos.items():
                    try:
                        photo = await self.download_photo(prop_record.primary_id, attachment_id, photo_type)
                        downloads.append(photo)

                        # Save to file if output_dir specified
                        if output_dir:
                            output_path = Path(output_dir)
                            output_path.mkdir(parents=True, exist_ok=True)

                            filename = f"{record.dr_number}_{photo_type}_{attachment_id}.jpg"
                            filepath = output_path / filename

                            with open(filepath, "wb") as f:
                                f.write(photo.content)

                            logger.debug(f"Saved: {filepath}")

                    except Exception as e:
                        logger.error(f"Failed to download {photo_type} from Property ID {prop_record.primary_id}: {e}")
        else:
            # Fallback for backwards compatibility (single Property ID)
            for photo_type, attachment_id in record.photos.items():
                try:
                    photo = await self.download_photo(record.primary_id, attachment_id, photo_type)
                    downloads.append(photo)

                    if output_dir:
                        output_path = Path(output_dir)
                        output_path.mkdir(parents=True, exist_ok=True)

                        filename = f"{record.dr_number}_{photo_type}_{attachment_id}.jpg"
                        filepath = output_path / filename

                        with open(filepath, "wb") as f:
                            f.write(photo.content)

                        logger.debug(f"Saved: {filepath}")

                except Exception as e:
                    logger.error(f"Failed to download {photo_type}: {e}")

        logger.info(f"Downloaded {len(downloads)}/{total_photos} photos")
        return downloads

    async def get_attachments_metadata(self, primary_id: str) -> List[Dict[str, Any]]:
        """
        Get all attachment metadata for a record from the API.

        This returns detailed info including captions, upload dates, and GPS coordinates.

        Args:
            primary_id: The primary ID of the record

        Returns:
            List of attachment metadata dictionaries
        """
        logger.debug(f"Getting attachment metadata for record {primary_id}")

        data = await self._request(
            "GET",
            f"/attachments/{self.FIBERTIME_LAYER_ID}/{primary_id}"
        )

        return data.get("attachments", [])

    async def get_photo_summary(self, record: DRRecord) -> Dict[str, Any]:
        """
        Get a summary of available photos for a DR record.

        Args:
            record: The DRRecord to summarize

        Returns:
            Dictionary with photo availability information
        """
        all_types = [pt.value for pt in PhotoType if pt != PhotoType.ONT_SERIAL]

        return {
            "dr_number": record.dr_number,
            "total_photos": len(record.photos),
            "available": list(record.photos.keys()),
            "missing": [pt for pt in all_types if pt not in record.photos],
            "photo_ids": record.photos
        }

    # =========================================================================
    # PROJECT/SITE OPERATIONS
    # =========================================================================

    def get_site_name(self, site_code: str) -> str:
        """Get the full name for a site code."""
        return self.KNOWN_SITES.get(site_code, site_code)

    def list_known_sites(self) -> Dict[str, str]:
        """List all known site codes and names."""
        if self.allowed_sites:
            return {k: v for k, v in self.KNOWN_SITES.items() if k in self.allowed_sites}
        return self.KNOWN_SITES.copy()

    async def get_site_statistics(self, site: str) -> Dict[str, Any]:
        """
        Get statistics for a site.

        Args:
            site: Site code

        Returns:
            Dictionary with site statistics
        """
        if not self._check_site_access(site):
            raise PermissionError(f"Access denied to site '{site}'")

        records = await self.search_by_project(site, limit=1000)

        # Count by status
        status_counts = {}
        photo_counts = {"with_photos": 0, "without_photos": 0}

        for record in records:
            status = record.status or "Unknown"
            status_counts[status] = status_counts.get(status, 0) + 1

            if record.photos:
                photo_counts["with_photos"] += 1
            else:
                photo_counts["without_photos"] += 1

        return {
            "site": site,
            "site_name": self.get_site_name(site),
            "total_records": len(records),
            "status_breakdown": status_counts,
            "photo_coverage": photo_counts
        }

    # =========================================================================
    # VERIFICATION HELPERS
    # =========================================================================

    async def verify_dr_photos(
        self,
        dr_number: str,
        required_photos: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Verify that a DR has required photos.

        Args:
            dr_number: The DR number to verify
            required_photos: List of required photo types (defaults to standard set)

        Returns:
            Verification result dictionary
        """
        if required_photos is None:
            # Standard required photos for completed installation
            required_photos = [
                PhotoType.PROPERTY.value,
                PhotoType.SIGNATURE_1.value,
                PhotoType.WALL_MOUNT.value,
                PhotoType.HOME_ENTRY.value,
                PhotoType.AFTER.value,
            ]

        record = await self.get_dr(dr_number)
        if not record:
            return {
                "dr_number": dr_number,
                "verified": False,
                "error": "DR not found"
            }

        available = set(record.photos.keys())
        required = set(required_photos)

        missing = required - available
        extra = available - required

        return {
            "dr_number": dr_number,
            "site": record.site,
            "status": record.status,
            "verified": len(missing) == 0,
            "required_photos": list(required),
            "available_photos": list(available),
            "missing_photos": list(missing),
            "extra_photos": list(extra),
            "photo_count": len(available),
            "address": record.address
        }


# =============================================================================
# AGENT FACTORY FUNCTION
# =============================================================================

def create_onemap_agent(
    allowed_sites: Optional[List[str]] = None
) -> OneMapSpecialistAgent:
    """
    Factory function to create a configured 1Map agent.

    Args:
        allowed_sites: Optional list of site codes to restrict access

    Returns:
        Configured OneMapSpecialistAgent instance
    """
    return OneMapSpecialistAgent(allowed_sites=allowed_sites)


# =============================================================================
# CLI INTERFACE (for testing)
# =============================================================================

async def main():
    """CLI interface for testing the agent."""
    import argparse

    parser = argparse.ArgumentParser(description="1Map Specialist Agent CLI")
    parser.add_argument("command", choices=["get", "search", "photos", "verify", "sites", "upload"])
    parser.add_argument("--dr", help="DR number")
    parser.add_argument("--site", help="Site code")
    parser.add_argument("--output", help="Output directory for photos")
    parser.add_argument("--limit", type=int, default=10, help="Result limit")
    parser.add_argument("--photo", help="Path to photo file to upload")
    parser.add_argument("--type", default="ph_test", help="Photo type field name (default: ph_test)")

    args = parser.parse_args()

    async with OneMapSpecialistAgent() as agent:
        if args.command == "get":
            if not args.dr:
                print("Error: --dr required")
                return
            record = await agent.get_dr(args.dr)
            if record:
                print(f"DR: {record.dr_number}")
                print(f"Site: {record.site} ({agent.get_site_name(record.site)})")
                print(f"Status: {record.status}")
                print(f"Address: {record.address}")
                print(f"Photos: {len(record.photos)}")
                for pt, aid in record.photos.items():
                    print(f"  - {pt}: {aid}")
            else:
                print("DR not found")

        elif args.command == "search":
            pattern = args.dr or f"%"
            records = await agent.search_dr(pattern, limit=args.limit)
            print(f"Found {len(records)} records:")
            for r in records:
                print(f"  {r.dr_number} - {r.site} - {r.status}")

        elif args.command == "photos":
            if not args.dr:
                print("Error: --dr required")
                return
            record = await agent.get_dr(args.dr)
            if record:
                output = args.output or f"data/dr_photos/{args.dr}"
                photos = await agent.download_all_photos(record, output)
                print(f"Downloaded {len(photos)} photos to {output}")

        elif args.command == "verify":
            if not args.dr:
                print("Error: --dr required")
                return
            result = await agent.verify_dr_photos(args.dr)
            print(f"DR: {result['dr_number']}")
            print(f"Verified: {result['verified']}")
            print(f"Available: {result['photo_count']} photos")
            if result.get('missing_photos'):
                print(f"Missing: {result['missing_photos']}")

        elif args.command == "sites":
            sites = agent.list_known_sites()
            print("Known sites:")
            for code, name in sorted(sites.items()):
                print(f"  {code}: {name}")

        elif args.command == "upload":
            if not args.dr:
                print("Error: --dr required")
                return
            if not args.photo:
                print("Error: --photo required")
                return

            print(f"Uploading {args.photo} to DR {args.dr} as {args.type}...")
            result = await agent.upload_dr_photo(
                dr_number=args.dr,
                photo_path=args.photo,
                photo_type=args.type
            )
            print(f"Upload successful!")
            print(f"Result: {result}")


if __name__ == "__main__":
    asyncio.run(main())
