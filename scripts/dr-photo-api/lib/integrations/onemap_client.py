"""
1Map GIS API Client for BOSS

Provides integration with 1Map (www.1map.co.za) REST API for:
- Authentication (token-based, 2-hour session)
- Searching DR records across layers
- Downloading photo attachments
- Layer and project discovery

API Documentation: https://www.1map.co.za/help/api-docs
Base URL: https://www.1map.co.za/api/v1

Used for DR photo verification workflow:
1. Search for DR number in 1Map
2. Get all photo attachments for the record
3. Download photos for AI verification
"""

import os
import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field
import httpx

logger = logging.getLogger(__name__)


class OneMapAuthError(Exception):
    """1Map authentication error."""
    pass


class OneMapAPIError(Exception):
    """1Map API error."""
    pass


@dataclass
class PhotoAttachment:
    """Photo attachment metadata from 1Map."""
    attachment_id: str
    filename: str
    content_type: str
    size: int
    created_at: Optional[datetime] = None
    layer_id: str = ""
    primary_id: str = ""

    def __post_init__(self):
        # Ensure attachment_id is string
        self.attachment_id = str(self.attachment_id)


@dataclass
class DRRecord:
    """DR (drop) record from 1Map."""
    dr_number: str
    primary_id: str
    layer_id: str
    layer_name: str
    project: str = ""
    status: Optional[str] = None
    address: Optional[str] = None
    coordinates: Optional[Dict[str, float]] = None
    raw_data: Dict[str, Any] = field(default_factory=dict)
    attachments: List[PhotoAttachment] = field(default_factory=list)


@dataclass
class PhotoDownload:
    """Downloaded photo with metadata."""
    attachment: PhotoAttachment
    content: bytes
    dr_number: str
    downloaded_at: datetime = field(default_factory=datetime.now)


class OneMapClient:
    """
    1Map GIS API client for photo download and DR lookup.

    Features:
    - Token-based authentication (2-hour session expiry)
    - Search DR records across layers
    - Download photo attachments
    - Automatic token refresh

    Example:
        async with OneMapClient() as client:
            # Search for DR
            records = await client.search_dr("DR1234567")

            # Download all photos
            photos = await client.download_all_photos("DR1234567")
    """

    BASE_URL = "https://www.1map.co.za/api/v1"
    TOKEN_EXPIRY_HOURS = 2

    # 1Map Workspace and Layer Configuration
    # Discovered via Playwright exploration (2025-12-03)
    # Workspace: "Home Signup & Home Installation" (ID: 0_127)
    # Primary Layer: "Fibertime Installations"

    # Default workspace for Velocity/Fibertime installations
    DEFAULT_WORKSPACE_ID = "0_127"
    DEFAULT_WORKSPACE_NAME = "Home Signup & Home Installation"

    # Known 1Map layers for Velocity projects
    # Note: All Velocity projects (lawley, mohadin, mamelodi) share the same
    # "Fibertime Installations" layer within the Home Signup workspace
    VELOCITY_LAYERS = {
        "default": {
            "installations": "Fibertime Installations",
            "workspace_id": "0_127"
        },
        "lawley": {
            "installations": "Fibertime Installations",
            "workspace_id": "0_127"
        },
        "mohadin": {
            "installations": "Fibertime Installations",
            "workspace_id": "0_127"
        },
        "mamelodi": {
            "installations": "Fibertime Installations",
            "workspace_id": "0_127"
        }
    }

    # DR field name in the API (lowercase per GeoJSON properties)
    # The drp field contains values like "DR709050" or "no drop allocated"
    DR_FIELD_NAME = "drp"

    # Fibertime Installations layer ID (discovered via API exploration)
    FIBERTIME_LAYER_ID = "5121"

    # Photo fields discovered in the layer (ph_ prefix fields)
    # Each field contains an attachment ID (integer)
    # Maps to the 12-step verification workflow
    PHOTO_FIELDS = {
        "ph_prop": "Photo of Property",
        "ph_sign1": "Customer Consent Signature",
        "ph_sign2": "Customer Signature - Terms and Conditions",
        "ph_sign3": "Pole Permission Signature",
        "ph_wall": "Photo Showing Location on the Wall (before installation)",
        "ph_drop": "Drop cable photo",
        "ph_hm_ln": "Home Entry Point: Outside (Pigtail screw / Duct entry)",
        "ph_hm_en": "Home entry point",
        "ph_outs": "Outside cable span: Pole to Pigtail screw",
        "ph_bl": "Photo of Active Broadband Light (with FT sticker and Drop Number visible)",
        "ph_powm2": "Powermeter reading (at ONT before activation)",
        "ph_cbl_r": "Fiber cable: entry to ONT (after install)",
        "ph_after": "Overall work area after complete install",
    }

    # Site codes discovered (KWN, MFU, KWA, Ivory Park, Kraaifontein)
    KNOWN_SITE_CODES = ["KWN", "MFU", "KWA", "Ivory Park", "Kraaifontein"]

    def __init__(
        self,
        email: Optional[str] = None,
        password: Optional[str] = None,
        base_url: Optional[str] = None
    ):
        """
        Initialize 1Map client.

        Args:
            email: 1Map login email (or from ONEMAP_EMAIL env)
            password: 1Map password (or from ONEMAP_PASSWORD env)
            base_url: API base URL (or from ONEMAP_BASE_URL env)
        """
        self.email = email or os.getenv("ONEMAP_EMAIL")
        self.password = password or os.getenv("ONEMAP_PASSWORD")
        self.base_url = base_url or os.getenv("ONEMAP_BASE_URL", self.BASE_URL)

        if not self.email or not self.password:
            raise OneMapAuthError(
                "Missing 1Map credentials. Set ONEMAP_EMAIL and ONEMAP_PASSWORD "
                "in environment or pass to constructor."
            )

        self._token: Optional[str] = None
        self._token_expires: Optional[datetime] = None
        self._http_client: Optional[httpx.AsyncClient] = None
        self._layer_cache: Dict[str, str] = {}  # layer_name -> layer_id mapping
        self._workspaces: List[Dict[str, Any]] = []  # Available workspaces from login

        logger.info("OneMapClient initialized")

    async def __aenter__(self):
        """Async context manager entry."""
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.disconnect()

    async def connect(self) -> None:
        """Initialize connection and authenticate."""
        logger.info("Connecting to 1Map API...")

        self._http_client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(60.0),
            follow_redirects=True
        )

        await self._authenticate()
        logger.info("Connected to 1Map API")

    async def disconnect(self) -> None:
        """Close HTTP client and logout."""
        if self._http_client:
            try:
                await self._logout()
            except Exception as e:
                logger.warning(f"Logout failed: {e}")
            await self._http_client.aclose()
            self._http_client = None
        self._token = None
        self._token_expires = None
        logger.info("Disconnected from 1Map API")

    async def _authenticate(self) -> str:
        """
        Authenticate with 1Map and get session token.

        Returns:
            Session token
        """
        logger.info(f"Authenticating with 1Map as {self.email}...")

        response = await self._http_client.get(
            "/auth/login",
            params={
                "email": self.email,
                "password": self.password
            }
        )

        if response.status_code != 200:
            raise OneMapAuthError(
                f"Authentication failed: {response.status_code} - {response.text}"
            )

        data = response.json()

        # API returns token in apiToken.token structure
        api_token = data.get("apiToken", {})
        token = api_token.get("token") if isinstance(api_token, dict) else None

        # Also check legacy Token format
        if not token:
            token = data.get("Token")

        if not token:
            raise OneMapAuthError(
                f"No token in response: {data}"
            )

        self._token = token

        # Store workspace info if available
        result = data.get("result", {})
        if result.get("workspaces"):
            self._workspaces = result["workspaces"]
            logger.info(f"Available workspaces: {[w.get('workspaceName') for w in self._workspaces]}")
        self._token_expires = datetime.now() + timedelta(hours=self.TOKEN_EXPIRY_HOURS)

        logger.info(f"Authenticated with 1Map (token expires: {self._token_expires})")
        return self._token

    async def _logout(self) -> None:
        """Logout from 1Map."""
        if self._token:
            try:
                await self._request("GET", "/auth/logout")
                logger.info("Logged out from 1Map")
            except Exception as e:
                logger.warning(f"Logout request failed: {e}")

    async def _ensure_authenticated(self) -> None:
        """Ensure we have a valid token, refresh if needed."""
        if not self._token or not self._token_expires:
            await self._authenticate()
        elif datetime.now() >= self._token_expires - timedelta(minutes=5):
            logger.info("Token expiring soon, re-authenticating...")
            await self._authenticate()

    async def _request(
        self,
        method: str,
        endpoint: str,
        **kwargs
    ) -> Any:
        """
        Make authenticated API request.

        Args:
            method: HTTP method
            endpoint: API endpoint (without base URL)
            **kwargs: Additional httpx request args

        Returns:
            JSON response or bytes
        """
        if not self._http_client:
            raise RuntimeError("Client not connected. Call connect() first.")

        await self._ensure_authenticated()

        # Add token to params (lowercase 'token' per API docs)
        params = kwargs.get("params", {})
        params["token"] = self._token
        kwargs["params"] = params

        response = await self._http_client.request(method, endpoint, **kwargs)

        if response.status_code == 401:
            # Token expired, re-authenticate and retry
            logger.warning("Token expired, re-authenticating...")
            await self._authenticate()
            params["token"] = self._token
            response = await self._http_client.request(method, endpoint, **kwargs)

        response.raise_for_status()

        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            return response.json()
        else:
            return response.content

    async def get_projects(self) -> List[Dict[str, Any]]:
        """
        Get all available projects/workspaces.

        Returns:
            List of project metadata
        """
        logger.info("Getting 1Map projects...")
        data = await self._request("GET", "/parameters/projects")
        logger.info(f"Found {len(data) if isinstance(data, list) else 'unknown'} projects")
        return data

    async def get_layers(self, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get available layers.

        Args:
            project_id: Filter by project (optional)

        Returns:
            List of layer metadata
        """
        logger.info("Getting 1Map layers...")
        params = {}
        if project_id:
            params["ProjectId"] = project_id
        data = await self._request("GET", "/parameters/layers", params=params)

        # Cache layer IDs
        if isinstance(data, list):
            for layer in data:
                layer_name = layer.get("Name") or layer.get("name")
                layer_id = layer.get("Id") or layer.get("id")
                if layer_name and layer_id:
                    self._layer_cache[layer_name] = str(layer_id)

        logger.info(f"Found {len(data) if isinstance(data, list) else 'unknown'} layers")
        return data

    async def get_layer_id(self, layer_name: str) -> Optional[str]:
        """
        Get layer ID by name.

        Args:
            layer_name: Layer name (e.g., "1Map_Ins")

        Returns:
            Layer ID or None if not found
        """
        if layer_name in self._layer_cache:
            return self._layer_cache[layer_name]

        # Fetch layers to populate cache
        await self.get_layers()
        return self._layer_cache.get(layer_name)

    async def search_records(
        self,
        layer_id: str,
        field_name: str,
        field_value: str
    ) -> List[Dict[str, Any]]:
        """
        Search records in a layer by field value.

        Args:
            layer_id: Layer ID
            field_name: Field to search (e.g., "DR_Number", "drop_id")
            field_value: Value to search for

        Returns:
            List of matching records
        """
        logger.info(f"Searching layer {layer_id} for {field_name}={field_value}")

        # Use Attributes Basic API
        data = await self._request(
            "GET",
            f"/attributes-basic/{layer_id}",
            params={
                "FieldName": field_name,
                "FieldValue": field_value
            }
        )

        results = data if isinstance(data, list) else []
        logger.info(f"Found {len(results)} records")
        return results

    async def search_dr(
        self,
        dr_number: str,
        project: Optional[str] = None
    ) -> List[DRRecord]:
        """
        Search for DR record in Fibertime Installations layer.

        Uses the GeoJSON-based /attributes/{layer_id}/unsorted endpoint
        with includeData=true and WHERE clause filtering.

        Args:
            dr_number: DR number to search (e.g., "DR709050")
            project: Optional project filter (for future use)

        Returns:
            List of matching DR records
        """
        logger.info(f"Searching for DR: {dr_number}")

        results = []
        layer_id = self.FIBERTIME_LAYER_ID

        try:
            # Use the GeoJSON endpoint with WHERE filter
            data = await self._request(
                "GET",
                f"/attributes/{layer_id}/unsorted",
                params={
                    "includeData": "true",
                    "where": f"{self.DR_FIELD_NAME} = '{dr_number}'"
                }
            )

            # Extract features from GeoJSON response
            result = data.get("result", {}) if isinstance(data, dict) else {}
            geom_result = result.get("geomResult", {})
            features = geom_result.get("features", [])

            logger.info(f"Found {len(features)} features matching DR {dr_number}")

            for feature in features:
                props = feature.get("properties", {})
                feature_id = feature.get("id", "")

                # Extract primary ID from feature ID
                # Format: "fibertime:atr_fibertime_installations.{prop_id}"
                primary_id = ""
                if "." in feature_id:
                    primary_id = feature_id.split(".")[-1]
                else:
                    primary_id = str(props.get("prop_id", ""))

                # Extract coordinates
                geometry = feature.get("geometry", {})
                coordinates = None
                if geometry.get("type") == "Point":
                    coords = geometry.get("coordinates", [])
                    if len(coords) >= 2:
                        coordinates = {"lng": coords[0], "lat": coords[1]}

                # Determine project from site code
                site = props.get("site", "")
                detected_project = project or site or "default"

                dr_record = DRRecord(
                    dr_number=dr_number,
                    primary_id=primary_id,
                    layer_id=layer_id,
                    layer_name="Fibertime Installations",
                    project=detected_project,
                    address=props.get("address"),
                    status=props.get("status") or props.get("flowname"),
                    coordinates=coordinates,
                    raw_data=props
                )
                results.append(dr_record)

        except Exception as e:
            logger.error(f"Error searching for DR {dr_number}: {e}")
            raise

        logger.info(f"Found {len(results)} DR records for {dr_number}")
        return results

    async def search_records_geojson(
        self,
        layer_id: str,
        where_clause: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """
        Search records using the GeoJSON-based API.

        Args:
            layer_id: Layer ID
            where_clause: SQL-like WHERE clause (e.g., "drp = 'DR709050'")
            limit: Maximum records to return

        Returns:
            List of feature properties
        """
        logger.info(f"Searching layer {layer_id} with GeoJSON API")

        params = {
            "includeData": "true",
            "limit": limit
        }
        if where_clause:
            params["where"] = where_clause

        data = await self._request(
            "GET",
            f"/attributes/{layer_id}/unsorted",
            params=params
        )

        # Extract features from GeoJSON response
        result = data.get("result", {}) if isinstance(data, dict) else {}
        geom_result = result.get("geomResult", {})
        features = geom_result.get("features", [])

        # Return properties with feature ID added
        records = []
        for feature in features:
            props = feature.get("properties", {}).copy()
            props["_feature_id"] = feature.get("id", "")
            props["_geometry"] = feature.get("geometry", {})
            records.append(props)

        logger.info(f"Found {len(records)} records")
        return records

    async def get_attachments(
        self,
        layer_id: str,
        primary_id: str
    ) -> List[PhotoAttachment]:
        """
        Get all attachments for a record.

        Args:
            layer_id: Layer ID
            primary_id: Record primary ID

        Returns:
            List of photo attachments
        """
        logger.info(f"Getting attachments for layer={layer_id}, record={primary_id}")

        data = await self._request(
            "GET",
            f"/attachments/{layer_id}/{primary_id}"
        )

        attachments = []
        if isinstance(data, list):
            for item in data:
                attachment = PhotoAttachment(
                    attachment_id=item.get("Id") or item.get("id") or "",
                    filename=item.get("Filename") or item.get("filename") or "unknown",
                    content_type=item.get("ContentType") or item.get("content_type") or "image/jpeg",
                    size=item.get("Size") or item.get("size") or 0,
                    layer_id=layer_id,
                    primary_id=primary_id
                )
                attachments.append(attachment)

        logger.info(f"Found {len(attachments)} attachments")
        return attachments

    async def download_attachment(
        self,
        layer_id: str,
        primary_id: str,
        attachment_id: str
    ) -> bytes:
        """
        Download a specific attachment file.

        Args:
            layer_id: Layer ID
            primary_id: Record primary ID
            attachment_id: Attachment ID

        Returns:
            File content as bytes
        """
        logger.info(f"Downloading attachment {attachment_id}")

        content = await self._request(
            "GET",
            f"/attachments/file/{layer_id}/{primary_id}/{attachment_id}"
        )

        logger.info(f"Downloaded {len(content)} bytes")
        return content

    async def download_all_photos(
        self,
        dr_number: str,
        project: Optional[str] = None,
        save_dir: Optional[Path] = None
    ) -> List[PhotoDownload]:
        """
        Download all photos for a DR number.

        Args:
            dr_number: DR number
            project: Optional project filter
            save_dir: Optional directory to save files

        Returns:
            List of downloaded photos
        """
        logger.info(f"Downloading all photos for DR: {dr_number}")

        downloads = []

        # Find DR records
        dr_records = await self.search_dr(dr_number, project)

        if not dr_records:
            logger.warning(f"No records found for DR: {dr_number}")
            return downloads

        for record in dr_records:
            # Get attachments for each record
            attachments = await self.get_attachments(
                record.layer_id,
                record.primary_id
            )

            for attachment in attachments:
                try:
                    # Download file
                    content = await self.download_attachment(
                        attachment.layer_id,
                        attachment.primary_id,
                        attachment.attachment_id
                    )

                    download = PhotoDownload(
                        attachment=attachment,
                        content=content,
                        dr_number=dr_number
                    )
                    downloads.append(download)

                    # Save to disk if requested
                    if save_dir:
                        save_dir = Path(save_dir)
                        save_dir.mkdir(parents=True, exist_ok=True)
                        file_path = save_dir / f"{dr_number}_{attachment.filename}"
                        file_path.write_bytes(content)
                        logger.info(f"Saved: {file_path}")

                except Exception as e:
                    logger.error(f"Failed to download attachment {attachment.attachment_id}: {e}")

        logger.info(f"Downloaded {len(downloads)} photos for DR: {dr_number}")
        return downloads

    async def get_dr_with_photos(
        self,
        dr_number: str,
        project: Optional[str] = None
    ) -> List[DRRecord]:
        """
        Get DR records with all their photo attachments populated.

        Args:
            dr_number: DR number
            project: Optional project filter

        Returns:
            List of DR records with attachments
        """
        records = await self.search_dr(dr_number, project)

        for record in records:
            record.attachments = await self.get_attachments(
                record.layer_id,
                record.primary_id
            )

        return records

    def get_photo_ids_from_record(self, record: DRRecord) -> Dict[str, str]:
        """
        Extract photo attachment IDs from a DR record's raw_data.

        The photo fields (ph_prop, ph_sign1, etc.) contain attachment IDs
        that can be used to download the actual images.

        Args:
            record: DR record with raw_data

        Returns:
            Dict mapping field name to attachment ID
        """
        photo_ids = {}
        for field in self.PHOTO_FIELDS.keys():
            value = record.raw_data.get(field)
            if value:
                # Handle comma-separated IDs (take first one)
                if isinstance(value, str) and ',' in value:
                    photo_ids[field] = value.split(',')[0].strip()
                else:
                    photo_ids[field] = str(value)
        return photo_ids

    async def download_photo(
        self,
        layer_id: str,
        primary_id: str,
        attachment_id: str
    ) -> Optional[bytes]:
        """
        Download a single photo by attachment ID.

        Args:
            layer_id: Layer ID
            primary_id: Record primary ID (from feature ID)
            attachment_id: Attachment ID from photo field

        Returns:
            Photo content as bytes, or None on failure
        """
        try:
            content = await self.download_attachment(layer_id, primary_id, attachment_id)

            # Validate it's actually an image
            if content[:2] == b'\xff\xd8':  # JPEG
                return content
            elif content[:4] == b'\x89PNG':  # PNG
                return content
            elif content[:4] == b'GIF8' and len(content) > 100:  # GIF (not placeholder)
                return content
            else:
                logger.warning(f"Downloaded content is not a valid image for attachment {attachment_id}")
                return None
        except Exception as e:
            logger.error(f"Failed to download photo {attachment_id}: {e}")
            return None

    async def download_dr_photos(
        self,
        dr_number: str,
        save_dir: Optional[Path] = None,
        project: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Download all photos for a DR number.

        Args:
            dr_number: DR number (e.g., "DR138680")
            save_dir: Directory to save photos (default: data/dr_photos/{dr_number})
            project: Optional project filter

        Returns:
            Dict with download results including metadata
        """
        logger.info(f"Downloading photos for DR: {dr_number}")

        # Set up save directory
        if save_dir is None:
            save_dir = Path("data/dr_photos") / dr_number
        save_dir = Path(save_dir)
        save_dir.mkdir(parents=True, exist_ok=True)

        # Find the DR record
        records = await self.search_dr(dr_number, project)

        if not records:
            logger.warning(f"No records found for DR: {dr_number}")
            return {"error": "No records found", "dr_number": dr_number, "photos": []}

        # Use first matching record
        record = records[0]
        photo_ids = self.get_photo_ids_from_record(record)

        result = {
            "dr_number": dr_number,
            "project": record.project,
            "primary_id": record.primary_id,
            "layer_id": record.layer_id,
            "address": record.address,
            "status": record.status,
            "coordinates": record.coordinates,
            "save_dir": str(save_dir),
            "photos": [],
            "failed": []
        }

        # Download each photo
        for field_name, attachment_id in photo_ids.items():
            try:
                content = await self.download_photo(
                    record.layer_id,
                    record.primary_id,
                    attachment_id
                )

                if content:
                    # Save to file
                    filename = f"{field_name}_{attachment_id}.jpg"
                    file_path = save_dir / filename
                    file_path.write_bytes(content)

                    photo_info = {
                        "field": field_name,
                        "description": self.PHOTO_FIELDS.get(field_name, field_name),
                        "attachment_id": attachment_id,
                        "filename": filename,
                        "path": str(file_path),
                        "size": len(content)
                    }
                    result["photos"].append(photo_info)
                    logger.info(f"Downloaded {field_name}: {len(content)} bytes")
                else:
                    result["failed"].append({
                        "field": field_name,
                        "attachment_id": attachment_id,
                        "error": "Invalid image content"
                    })

            except Exception as e:
                result["failed"].append({
                    "field": field_name,
                    "attachment_id": attachment_id,
                    "error": str(e)
                })
                logger.error(f"Failed to download {field_name}: {e}")

        # Save metadata
        metadata_path = save_dir / "metadata.json"
        import json
        with open(metadata_path, 'w') as f:
            json.dump(result, f, indent=2, default=str)

        logger.info(f"Downloaded {len(result['photos'])} photos, {len(result['failed'])} failed")
        return result


# ============================================================================
# CLI INTEGRATION
# ============================================================================

async def test_onemap_connection():
    """Test 1Map connection and API access."""
    async with OneMapClient() as client:
        print("\n1Map Connection Test")
        print("=" * 60)

        # Get projects
        print("\n1. Getting projects...")
        projects = await client.get_projects()
        print(f"   Found {len(projects) if isinstance(projects, list) else 'N/A'} projects")

        # Get layers
        print("\n2. Getting layers...")
        layers = await client.get_layers()
        if isinstance(layers, list):
            print(f"   Found {len(layers)} layers:")
            for layer in layers[:10]:  # Show first 10
                name = layer.get("Name") or layer.get("name")
                layer_id = layer.get("Id") or layer.get("id")
                print(f"   - {name} (ID: {layer_id})")

        print("\n" + "=" * 60)
        print("Connection test complete!")


async def test_dr_search(dr_number: str, project: Optional[str] = None):
    """Test searching for a DR number."""
    async with OneMapClient() as client:
        print(f"\nSearching for DR: {dr_number}")
        print("=" * 60)

        records = await client.get_dr_with_photos(dr_number, project)

        if not records:
            print("No records found")
            return

        for record in records:
            print(f"\nDR Record: {record.dr_number}")
            print(f"  Project: {record.project}")
            print(f"  Layer: {record.layer_name}")
            print(f"  Primary ID: {record.primary_id}")
            print(f"  Address: {record.address or 'N/A'}")
            print(f"  Attachments: {len(record.attachments)}")

            for att in record.attachments:
                print(f"    - {att.filename} ({att.content_type}, {att.size} bytes)")


if __name__ == "__main__":
    import asyncio
    import sys

    if len(sys.argv) > 1:
        # Search for specific DR
        dr = sys.argv[1]
        project = sys.argv[2] if len(sys.argv) > 2 else None
        asyncio.run(test_dr_search(dr, project))
    else:
        # Just test connection
        asyncio.run(test_onemap_connection())
