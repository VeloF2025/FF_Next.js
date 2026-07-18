"""
SeaweedFS Client - File Storage Interface

Provides a Python client for interacting with SeaweedFS distributed file storage.
Supports upload, download, delete, and directory management operations.

Architecture:
- Filer API: HTTP REST interface for file operations
- Master API: Volume management and cluster status
- Volume API: Direct access to object storage

Usage:
    from lib.storage.seaweedfs_client import SeaweedFSClient

    client = SeaweedFSClient(
        filer_url="http://seaweedfs-filer:8888",
        master_url="http://seaweedfs-master:9333"
    )

    # Upload file
    result = client.upload("/documents/invoice.pdf", "/path/to/invoice.pdf")

    # Download file
    data = client.download("/documents/invoice.pdf")

    # List directory
    files = client.list_directory("/documents")

    # Delete file
    client.delete("/documents/invoice.pdf")

Environment Variables:
    SEAWEEDFS_FILER_URL: Filer server URL (default: http://seaweedfs-filer:8888)
    SEAWEEDFS_MASTER_URL: Master server URL (default: http://seaweedfs-master:9333)
"""

import os
import logging
import requests
from typing import Optional, Dict, List, BinaryIO, Union
from pathlib import Path
from urllib.parse import urljoin, quote
import mimetypes

logger = logging.getLogger(__name__)


class SeaweedFSError(Exception):
    """Base exception for SeaweedFS client errors"""
    pass


class SeaweedFSConnectionError(SeaweedFSError):
    """Raised when connection to SeaweedFS fails"""
    pass


class SeaweedFSUploadError(SeaweedFSError):
    """Raised when file upload fails"""
    pass


class SeaweedFSDownloadError(SeaweedFSError):
    """Raised when file download fails"""
    pass


class SeaweedFSDeleteError(SeaweedFSError):
    """Raised when file deletion fails"""
    pass


class SeaweedFSClient:
    """
    Client for interacting with SeaweedFS distributed file storage.

    Provides methods for upload, download, delete, and directory management.
    Uses the Filer API for file operations and Master API for cluster status.

    Attributes:
        filer_url: Base URL for Filer server (e.g., http://seaweedfs-filer:8888)
        master_url: Base URL for Master server (e.g., http://seaweedfs-master:9333)
        timeout: Request timeout in seconds
        session: Persistent HTTP session for connection pooling
    """

    def __init__(
        self,
        filer_url: Optional[str] = None,
        master_url: Optional[str] = None,
        timeout: int = 30
    ):
        """
        Initialize SeaweedFS client.

        Args:
            filer_url: Filer server URL (default: env SEAWEEDFS_FILER_URL or http://seaweedfs-filer:8888)
            master_url: Master server URL (default: env SEAWEEDFS_MASTER_URL or http://seaweedfs-master:9333)
            timeout: Request timeout in seconds (default: 30)
        """
        self.filer_url = filer_url or os.getenv("SEAWEEDFS_FILER_URL", "http://seaweedfs-filer:8888")
        self.master_url = master_url or os.getenv("SEAWEEDFS_MASTER_URL", "http://seaweedfs-master:9333")
        self.timeout = timeout

        # Remove trailing slashes
        self.filer_url = self.filer_url.rstrip("/")
        self.master_url = self.master_url.rstrip("/")

        # Create persistent session for connection pooling
        self.session = requests.Session()

        logger.info(f"Initialized SeaweedFS client: Filer={self.filer_url}, Master={self.master_url}")

    def __enter__(self):
        """Context manager entry"""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit - close session"""
        self.close()

    def close(self):
        """Close HTTP session"""
        self.session.close()
        logger.debug("Closed SeaweedFS client session")

    def health_check(self) -> Dict[str, bool]:
        """
        Check health of SeaweedFS cluster.

        Returns:
            Dict with health status: {"filer": bool, "master": bool}

        Raises:
            SeaweedFSConnectionError: If health check fails
        """
        health = {"filer": False, "master": False}

        # Check Filer
        try:
            response = self.session.get(f"{self.filer_url}/", timeout=self.timeout)
            health["filer"] = response.status_code == 200
        except requests.RequestException as e:
            logger.error(f"Filer health check failed: {e}")

        # Check Master
        try:
            response = self.session.get(f"{self.master_url}/cluster/status", timeout=self.timeout)
            health["master"] = response.status_code == 200
        except requests.RequestException as e:
            logger.error(f"Master health check failed: {e}")

        logger.info(f"Health check: {health}")
        return health

    def upload(
        self,
        remote_path: str,
        local_path: Optional[str] = None,
        data: Optional[Union[bytes, BinaryIO]] = None,
        mime_type: Optional[str] = None,
        metadata: Optional[Dict[str, str]] = None
    ) -> Dict:
        """
        Upload file to SeaweedFS.

        Args:
            remote_path: Remote file path (e.g., /documents/invoice.pdf)
            local_path: Local file path to upload (optional if data provided)
            data: File data as bytes or file-like object (optional if local_path provided)
            mime_type: MIME type of file (auto-detected if not provided)
            metadata: Optional metadata dict to store with file

        Returns:
            Dict with upload result: {"name": str, "size": int, "path": str}

        Raises:
            SeaweedFSUploadError: If upload fails
            ValueError: If neither local_path nor data provided

        Example:
            # Upload from file
            result = client.upload("/documents/invoice.pdf", local_path="/path/to/invoice.pdf")

            # Upload from bytes
            result = client.upload("/documents/test.txt", data=b"Hello World")

            # Upload with metadata
            result = client.upload(
                "/photos/img.jpg",
                local_path="/path/to/img.jpg",
                metadata={"photographer": "John", "location": "NYC"}
            )
        """
        if not local_path and data is None:
            raise ValueError("Either local_path or data must be provided")

        # Ensure remote path starts with /
        if not remote_path.startswith("/"):
            remote_path = f"/{remote_path}"

        try:
            # Prepare file data
            # Use remote filename for consistency
            filename = Path(remote_path).name

            if local_path:
                file_obj = open(local_path, "rb")
            else:
                if isinstance(data, bytes):
                    from io import BytesIO
                    file_obj = BytesIO(data)
                else:
                    file_obj = data

            # Auto-detect MIME type if not provided
            if not mime_type:
                mime_type, _ = mimetypes.guess_type(filename)
                if not mime_type:
                    mime_type = "application/octet-stream"

            # Prepare multipart form data
            files = {"file": (filename, file_obj, mime_type)}

            # Add metadata as form fields if provided
            form_data = {}
            if metadata:
                for key, value in metadata.items():
                    form_data[f"metadata.{key}"] = value

            # Upload to Filer
            url = f"{self.filer_url}{remote_path}"
            logger.debug(f"Uploading to {url}")

            response = self.session.post(
                url,
                files=files,
                data=form_data if form_data else None,
                timeout=self.timeout
            )

            # Close file if we opened it
            if local_path:
                file_obj.close()

            response.raise_for_status()

            result = response.json()
            result["path"] = remote_path

            logger.info(f"Uploaded file: {remote_path} ({result.get('size', 0)} bytes)")
            return result

        except requests.RequestException as e:
            logger.error(f"Upload failed for {remote_path}: {e}")
            raise SeaweedFSUploadError(f"Failed to upload {remote_path}: {e}")
        except Exception as e:
            logger.error(f"Unexpected error during upload: {e}")
            raise SeaweedFSUploadError(f"Unexpected error: {e}")

    def download(
        self,
        remote_path: str,
        local_path: Optional[str] = None
    ) -> Union[bytes, str]:
        """
        Download file from SeaweedFS.

        Args:
            remote_path: Remote file path (e.g., /documents/invoice.pdf)
            local_path: Optional local path to save file (if not provided, returns bytes)

        Returns:
            bytes: File content if local_path not provided
            str: Local file path if local_path provided

        Raises:
            SeaweedFSDownloadError: If download fails

        Example:
            # Download to memory
            data = client.download("/documents/invoice.pdf")

            # Download to file
            path = client.download("/documents/invoice.pdf", local_path="/tmp/invoice.pdf")
        """
        # Ensure remote path starts with /
        if not remote_path.startswith("/"):
            remote_path = f"/{remote_path}"

        try:
            url = f"{self.filer_url}{remote_path}"
            logger.debug(f"Downloading from {url}")

            response = self.session.get(url, timeout=self.timeout, stream=True)
            response.raise_for_status()

            if local_path:
                # Save to file
                with open(local_path, "wb") as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        f.write(chunk)

                logger.info(f"Downloaded file: {remote_path} -> {local_path}")
                return local_path
            else:
                # Return bytes
                data = response.content
                logger.info(f"Downloaded file: {remote_path} ({len(data)} bytes)")
                return data

        except requests.RequestException as e:
            logger.error(f"Download failed for {remote_path}: {e}")
            raise SeaweedFSDownloadError(f"Failed to download {remote_path}: {e}")
        except Exception as e:
            logger.error(f"Unexpected error during download: {e}")
            raise SeaweedFSDownloadError(f"Unexpected error: {e}")

    def delete(self, remote_path: str, recursive: bool = False) -> bool:
        """
        Delete file or directory from SeaweedFS.

        Args:
            remote_path: Remote file/directory path
            recursive: If True, delete directory and all contents (default: False)

        Returns:
            bool: True if deletion successful

        Raises:
            SeaweedFSDeleteError: If deletion fails

        Example:
            # Delete file
            client.delete("/documents/old_invoice.pdf")

            # Delete directory recursively
            client.delete("/documents/2024", recursive=True)
        """
        # Ensure remote path starts with /
        if not remote_path.startswith("/"):
            remote_path = f"/{remote_path}"

        try:
            url = f"{self.filer_url}{remote_path}"

            params = {}
            if recursive:
                params["recursive"] = "true"

            logger.debug(f"Deleting {url} (recursive={recursive})")

            response = self.session.delete(url, params=params, timeout=self.timeout)
            response.raise_for_status()

            logger.info(f"Deleted: {remote_path}")
            return True

        except requests.RequestException as e:
            logger.error(f"Delete failed for {remote_path}: {e}")
            raise SeaweedFSDeleteError(f"Failed to delete {remote_path}: {e}")
        except Exception as e:
            logger.error(f"Unexpected error during delete: {e}")
            raise SeaweedFSDeleteError(f"Unexpected error: {e}")

    def list_directory(
        self,
        remote_path: str = "/",
        recursive: bool = False
    ) -> List[Dict]:
        """
        List files and directories in a SeaweedFS directory.

        Args:
            remote_path: Remote directory path (default: /)
            recursive: If True, list recursively (default: False)

        Returns:
            List of file/directory metadata dicts with keys:
                - name: File/directory name
                - path: Full path
                - is_directory: bool
                - size: File size in bytes (0 for directories)
                - modified: Last modified timestamp

        Raises:
            SeaweedFSError: If listing fails

        Example:
            # List directory
            files = client.list_directory("/documents")
            for f in files:
                print(f"{f['path']} - {f['size']} bytes")

            # List recursively
            all_files = client.list_directory("/documents", recursive=True)
        """
        # Ensure remote path starts with / and ends with /
        if not remote_path.startswith("/"):
            remote_path = f"/{remote_path}"
        if not remote_path.endswith("/"):
            remote_path = f"{remote_path}/"

        try:
            url = f"{self.filer_url}{remote_path}"

            params = {"limit": 1000}  # Max results per request
            headers = {"Accept": "application/json"}  # Request JSON instead of HTML

            logger.debug(f"Listing directory {url}")

            response = self.session.get(url, params=params, headers=headers, timeout=self.timeout)
            response.raise_for_status()

            # Parse JSON response
            data = response.json()

            files = []
            entries = data.get("Entries", [])

            for entry in entries:
                # Check if directory by looking for chunks (files have chunks, directories don't)
                chunks = entry.get("chunks", entry.get("Chunks", []))
                is_directory = len(chunks) == 0 and entry.get("FileSize", 0) == 0

                file_info = {
                    "name": entry.get("FullPath", "").split("/")[-1],
                    "path": entry.get("FullPath", ""),
                    "is_directory": is_directory,
                    "size": entry.get("FileSize", 0),
                    "modified": entry.get("Mtime", "")
                }
                files.append(file_info)

                # Recursively list subdirectories if requested
                if recursive and file_info["is_directory"]:
                    subfiles = self.list_directory(file_info["path"], recursive=True)
                    files.extend(subfiles)

            logger.info(f"Listed {len(files)} items in {remote_path}")
            return files

        except requests.RequestException as e:
            logger.error(f"List directory failed for {remote_path}: {e}")
            raise SeaweedFSError(f"Failed to list directory {remote_path}: {e}")
        except Exception as e:
            logger.error(f"Unexpected error during list directory: {e}")
            raise SeaweedFSError(f"Unexpected error: {e}")

    def exists(self, remote_path: str) -> bool:
        """
        Check if file or directory exists.

        Args:
            remote_path: Remote path to check

        Returns:
            bool: True if exists, False otherwise

        Example:
            if client.exists("/documents/invoice.pdf"):
                print("File exists")
        """
        # Ensure remote path starts with /
        if not remote_path.startswith("/"):
            remote_path = f"/{remote_path}"

        try:
            url = f"{self.filer_url}{remote_path}"
            response = self.session.head(url, timeout=self.timeout)

            exists = response.status_code == 200
            logger.debug(f"Exists check for {remote_path}: {exists}")
            return exists

        except requests.RequestException:
            return False

    def get_file_info(self, remote_path: str) -> Dict:
        """
        Get detailed information about a file.

        Args:
            remote_path: Remote file path

        Returns:
            Dict with file metadata:
                - path: Full path
                - size: File size in bytes
                - mime_type: MIME type
                - modified: Last modified timestamp
                - chunks: Number of chunks

        Raises:
            SeaweedFSError: If file not found or error occurs

        Example:
            info = client.get_file_info("/documents/invoice.pdf")
            print(f"Size: {info['size']} bytes, Type: {info['mime_type']}")
        """
        # Ensure remote path starts with /
        if not remote_path.startswith("/"):
            remote_path = f"/{remote_path}"

        try:
            url = f"{self.filer_url}{remote_path}"
            response = self.session.head(url, timeout=self.timeout)
            response.raise_for_status()

            info = {
                "path": remote_path,
                "size": int(response.headers.get("Content-Length", 0)),
                "mime_type": response.headers.get("Content-Type", ""),
                "modified": response.headers.get("Last-Modified", ""),
                "etag": response.headers.get("ETag", "")
            }

            logger.debug(f"File info for {remote_path}: {info}")
            return info

        except requests.RequestException as e:
            logger.error(f"Get file info failed for {remote_path}: {e}")
            raise SeaweedFSError(f"Failed to get file info for {remote_path}: {e}")

    def create_directory(self, remote_path: str) -> bool:
        """
        Create a directory in SeaweedFS.

        Args:
            remote_path: Remote directory path to create

        Returns:
            bool: True if creation successful

        Raises:
            SeaweedFSError: If creation fails

        Example:
            client.create_directory("/documents/2025")
        """
        # Ensure remote path starts with /
        if not remote_path.startswith("/"):
            remote_path = f"/{remote_path}"

        # Ensure remote path ends with /
        if not remote_path.endswith("/"):
            remote_path = f"{remote_path}/"

        try:
            url = f"{self.filer_url}{remote_path}"

            # POST to directory path creates it
            response = self.session.post(url, timeout=self.timeout)

            # 409 Conflict means directory already exists - that's fine
            if response.status_code == 409:
                logger.debug(f"Directory already exists: {remote_path}")
                return True

            response.raise_for_status()

            logger.info(f"Created directory: {remote_path}")
            return True

        except requests.RequestException as e:
            logger.error(f"Create directory failed for {remote_path}: {e}")
            raise SeaweedFSError(f"Failed to create directory {remote_path}: {e}")

    def get_cluster_status(self) -> Dict:
        """
        Get SeaweedFS cluster status.

        Returns:
            Dict with cluster information:
                - IsLeader: bool
                - Leader: Leader address
                - Peers: List of peer addresses

        Raises:
            SeaweedFSConnectionError: If status check fails

        Example:
            status = client.get_cluster_status()
            print(f"Leader: {status['Leader']}")
        """
        try:
            url = f"{self.master_url}/cluster/status"
            response = self.session.get(url, timeout=self.timeout)
            response.raise_for_status()

            status = response.json()
            logger.debug(f"Cluster status: {status}")
            return status

        except requests.RequestException as e:
            logger.error(f"Get cluster status failed: {e}")
            raise SeaweedFSConnectionError(f"Failed to get cluster status: {e}")


# Convenience function for quick usage
def get_client() -> SeaweedFSClient:
    """
    Get SeaweedFS client instance with default configuration.

    Returns:
        SeaweedFSClient instance

    Example:
        from lib.storage.seaweedfs_client import get_client

        client = get_client()
        client.upload("/test/file.txt", data=b"Hello World")
    """
    return SeaweedFSClient()
