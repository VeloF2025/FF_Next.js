"""
PST File Validator and Repair Status Manager

Purpose: Validate PST/OST files before ingestion, detect corruption,
and track repair status for files that need Windows-native repair.

Authority: PAI-native development
Version: 1.0.0
"""

import os
import json
import logging
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime
from dataclasses import dataclass, asdict
from enum import Enum


logger = logging.getLogger(__name__)


class CorruptionType(Enum):
    """Types of PST corruption detected."""
    NONE = "none"
    FILE_NOT_FOUND = "file_not_found"
    FILE_EMPTY = "file_empty"
    INVALID_HEADER = "invalid_header"
    ROOT_RECORD_MISSING = "root_record_missing"
    INDEX_CORRUPTION = "index_corruption"
    ENCRYPTION_ERROR = "encryption_error"
    UNKNOWN = "unknown"


class RepairStatus(Enum):
    """Status of PST file repair."""
    OK = "ok"  # File is healthy
    NEEDS_REPAIR = "needs_repair"  # Corruption detected, needs repair
    REPAIR_IN_PROGRESS = "repair_in_progress"  # Currently being repaired
    REPAIRED = "repaired"  # Successfully repaired
    REPAIR_FAILED = "repair_failed"  # Repair attempted but failed
    SKIPPED = "skipped"  # User chose to skip this file


@dataclass
class ValidationResult:
    """Result of PST file validation."""
    file_path: str
    is_valid: bool
    corruption_type: CorruptionType
    error_message: Optional[str]
    file_size_bytes: int
    file_format: Optional[str]  # "Unicode" or "ANSI"
    encryption_type: Optional[str]  # "none", "permutative", "cyclic"
    repair_recommendation: str
    validated_at: str

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "file_path": self.file_path,
            "is_valid": self.is_valid,
            "corruption_type": self.corruption_type.value,
            "error_message": self.error_message,
            "file_size_bytes": self.file_size_bytes,
            "file_size_gb": round(self.file_size_bytes / (1024**3), 2),
            "file_format": self.file_format,
            "encryption_type": self.encryption_type,
            "repair_recommendation": self.repair_recommendation,
            "validated_at": self.validated_at
        }


@dataclass
class RepairRecord:
    """Record of repair status for a PST file."""
    file_path: str
    status: RepairStatus
    corruption_type: CorruptionType
    first_detected: str
    repair_attempts: int
    last_attempt: Optional[str]
    repair_method: Optional[str]
    repaired_at: Optional[str]
    error_details: Optional[str]

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "status": self.status.value,
            "corruption_type": self.corruption_type.value,
            "first_detected": self.first_detected,
            "repair_attempts": self.repair_attempts,
            "last_attempt": self.last_attempt,
            "repair_method": self.repair_method,
            "repaired_at": self.repaired_at,
            "error_details": self.error_details
        }

    @classmethod
    def from_dict(cls, file_path: str, data: Dict[str, Any]) -> "RepairRecord":
        """Create from dictionary."""
        return cls(
            file_path=file_path,
            status=RepairStatus(data.get("status", "needs_repair")),
            corruption_type=CorruptionType(data.get("corruption_type", "unknown")),
            first_detected=data.get("first_detected", datetime.now().isoformat()),
            repair_attempts=data.get("repair_attempts", 0),
            last_attempt=data.get("last_attempt"),
            repair_method=data.get("repair_method"),
            repaired_at=data.get("repaired_at"),
            error_details=data.get("error_details")
        )


class PSTValidator:
    """
    Validator for PST/OST files.

    Performs pre-flight checks to detect corruption before ingestion.
    Uses multiple validation methods:
    1. File existence and size check
    2. PST header signature validation
    3. Quick readpst dry-run test
    """

    # PST file magic bytes
    # "!BDN" signature at offset 0 (0x21, 0x42, 0x44, 0x4E)
    PST_MAGIC_BYTES = b'!BDN'

    def __init__(self):
        """Initialize validator."""
        self.readpst_available = shutil.which("readpst") is not None
        if not self.readpst_available:
            logger.warning("readpst not available - validation will be limited")

    def validate_file(self, file_path: str) -> ValidationResult:
        """
        Validate a PST/OST file.

        Args:
            file_path: Path to PST/OST file

        Returns:
            ValidationResult with validation details
        """
        logger.info(f"Validating PST file: {file_path}")

        # Default result
        result = ValidationResult(
            file_path=file_path,
            is_valid=False,
            corruption_type=CorruptionType.UNKNOWN,
            error_message=None,
            file_size_bytes=0,
            file_format=None,
            encryption_type=None,
            repair_recommendation="",
            validated_at=datetime.now().isoformat()
        )

        # Step 1: Check file exists
        if not os.path.exists(file_path):
            result.corruption_type = CorruptionType.FILE_NOT_FOUND
            result.error_message = f"File not found: {file_path}"
            result.repair_recommendation = "Verify file path is correct"
            logger.error(result.error_message)
            return result

        # Step 2: Check file size
        try:
            file_size = os.path.getsize(file_path)
            result.file_size_bytes = file_size

            if file_size == 0:
                result.corruption_type = CorruptionType.FILE_EMPTY
                result.error_message = "File is empty (0 bytes)"
                result.repair_recommendation = "File is empty and cannot be repaired. Check for backup."
                logger.error(result.error_message)
                return result

        except OSError as e:
            result.error_message = f"Cannot access file: {e}"
            result.repair_recommendation = "Check file permissions"
            logger.error(result.error_message)
            return result

        # Step 3: Validate PST header
        header_result = self._validate_header(file_path)
        if not header_result[0]:
            result.corruption_type = CorruptionType.INVALID_HEADER
            result.error_message = header_result[1]
            result.repair_recommendation = "Run ScanPST.exe (Microsoft Inbox Repair Tool)"
            logger.error(result.error_message)
            return result

        # Extract header info
        result.file_format = header_result[2].get("format")
        result.encryption_type = header_result[2].get("encryption")

        # Step 4: Quick readpst test (if available)
        if self.readpst_available:
            readpst_result = self._quick_readpst_test(file_path)
            if not readpst_result[0]:
                # Determine corruption type from error
                error_msg = readpst_result[1]
                if "root record" in error_msg.lower():
                    result.corruption_type = CorruptionType.ROOT_RECORD_MISSING
                elif "index" in error_msg.lower():
                    result.corruption_type = CorruptionType.INDEX_CORRUPTION
                else:
                    result.corruption_type = CorruptionType.UNKNOWN

                result.error_message = error_msg
                result.repair_recommendation = self._get_repair_recommendation(result.corruption_type)
                logger.error(f"readpst validation failed: {error_msg}")
                return result

        # All checks passed
        result.is_valid = True
        result.corruption_type = CorruptionType.NONE
        result.repair_recommendation = "No repair needed"
        logger.info(f"PST file validated successfully: {file_path}")

        return result

    def _validate_header(self, file_path: str) -> Tuple[bool, str, Dict[str, Any]]:
        """
        Validate PST file header.

        Returns:
            Tuple of (is_valid, error_message, header_info)
        """
        header_info = {}

        try:
            with open(file_path, 'rb') as f:
                # Read first 32 bytes for header validation
                header = f.read(32)

                if len(header) < 32:
                    return (False, "File too small to contain valid PST header", header_info)

                # Check magic bytes (offset 0, 4 bytes)
                if header[0:4] != self.PST_MAGIC_BYTES:
                    return (False, f"Invalid PST magic bytes: expected {self.PST_MAGIC_BYTES!r}, got {header[0:4]!r}", header_info)

                # Check PST version (offset 10, 2 bytes)
                # 14-15 = ANSI format
                # 21-23 = Unicode format (97-2003)
                # 23+ = Unicode format (2003+)
                version = int.from_bytes(header[10:12], 'little')

                if version in (14, 15):
                    header_info["format"] = "ANSI"
                elif version >= 21:
                    header_info["format"] = "Unicode"
                else:
                    header_info["format"] = f"Unknown (version {version})"

                # Check encryption type (offset 513 for Unicode, 461 for ANSI)
                # We'll check offset 513 as most modern PST files are Unicode
                f.seek(513)
                crypt_byte = f.read(1)
                if crypt_byte:
                    crypt_method = crypt_byte[0]
                    if crypt_method == 0:
                        header_info["encryption"] = "none"
                    elif crypt_method == 1:
                        header_info["encryption"] = "permutative"
                    elif crypt_method == 2:
                        header_info["encryption"] = "cyclic"
                    else:
                        header_info["encryption"] = f"unknown ({crypt_method})"

                return (True, "Header valid", header_info)

        except Exception as e:
            return (False, f"Error reading header: {e}", header_info)

    def _quick_readpst_test(self, file_path: str) -> Tuple[bool, str]:
        """
        Run quick readpst test to verify file can be opened.

        Returns:
            Tuple of (success, error_message)
        """
        try:
            # Use readpst with -t (just test, don't extract)
            # readpst doesn't have a true dry-run, so we extract to temp
            with tempfile.TemporaryDirectory() as temp_dir:
                result = subprocess.run(
                    ["readpst", "-o", temp_dir, "-e", file_path],
                    capture_output=True,
                    text=True,
                    timeout=30  # 30 second timeout for validation
                )

                # Check for known error patterns
                combined_output = result.stdout + result.stderr

                if "Could not get root record" in combined_output:
                    return (False, "Could not get root record - PST structure corrupted")

                if "Cannot open PST file" in combined_output:
                    return (False, "Cannot open PST file - file may be corrupted or locked")

                if result.returncode != 0:
                    return (False, f"readpst failed with code {result.returncode}: {result.stderr[:200]}")

                return (True, "")

        except subprocess.TimeoutExpired:
            return (False, "readpst validation timed out (>30s) - file may be very large or corrupted")
        except Exception as e:
            return (False, f"readpst test error: {e}")

    def _get_repair_recommendation(self, corruption_type: CorruptionType) -> str:
        """Get repair recommendation based on corruption type."""
        recommendations = {
            CorruptionType.NONE: "No repair needed",
            CorruptionType.FILE_NOT_FOUND: "Verify file path",
            CorruptionType.FILE_EMPTY: "File is empty - restore from backup",
            CorruptionType.INVALID_HEADER: "Run ScanPST.exe (Microsoft Inbox Repair Tool)",
            CorruptionType.ROOT_RECORD_MISSING: "Run ScanPST.exe multiple times until no errors. For large files (>10GB), this may take several hours.",
            CorruptionType.INDEX_CORRUPTION: "Run ScanPST.exe, then compact the PST in Outlook",
            CorruptionType.ENCRYPTION_ERROR: "Open in Outlook first to decrypt, then re-export",
            CorruptionType.UNKNOWN: "Try ScanPST.exe. If that fails, try commercial repair tools or restore from backup."
        }
        return recommendations.get(corruption_type, "Unknown - try ScanPST.exe")


class RepairStatusManager:
    """
    Manages repair status tracking for PST files.

    Persists repair status to JSON file for cross-session tracking.
    """

    def __init__(self, status_file_path: str = "data/pst_repair_status.json"):
        """
        Initialize repair status manager.

        Args:
            status_file_path: Path to repair status JSON file
        """
        self.status_file_path = Path(status_file_path)
        self._ensure_status_file()

    def _ensure_status_file(self):
        """Create status file if it doesn't exist."""
        if not self.status_file_path.exists():
            self.status_file_path.parent.mkdir(parents=True, exist_ok=True)
            self._save_status({"files": {}, "last_updated": datetime.now().isoformat()})

    def _load_status(self) -> Dict[str, Any]:
        """Load status from file."""
        try:
            with open(self.status_file_path, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            return {"files": {}, "last_updated": datetime.now().isoformat()}

    def _save_status(self, status: Dict[str, Any]):
        """Save status to file."""
        status["last_updated"] = datetime.now().isoformat()
        with open(self.status_file_path, 'w') as f:
            json.dump(status, f, indent=2)

    def get_file_status(self, file_path: str) -> Optional[RepairRecord]:
        """
        Get repair status for a specific file.

        Args:
            file_path: Path to PST file

        Returns:
            RepairRecord or None if not tracked
        """
        status = self._load_status()
        file_data = status.get("files", {}).get(file_path)
        if file_data:
            return RepairRecord.from_dict(file_path, file_data)
        return None

    def mark_needs_repair(
        self,
        file_path: str,
        corruption_type: CorruptionType,
        error_details: Optional[str] = None
    ) -> RepairRecord:
        """
        Mark a file as needing repair.

        Args:
            file_path: Path to PST file
            corruption_type: Type of corruption detected
            error_details: Additional error information

        Returns:
            Updated RepairRecord
        """
        status = self._load_status()

        # Check if already tracked
        existing = status.get("files", {}).get(file_path)

        if existing:
            # Update existing record
            record = RepairRecord.from_dict(file_path, existing)
            record.corruption_type = corruption_type
            record.error_details = error_details
            record.repair_attempts += 1
            record.last_attempt = datetime.now().isoformat()
            if record.status == RepairStatus.REPAIRED:
                # Was repaired but failed again
                record.status = RepairStatus.NEEDS_REPAIR
        else:
            # Create new record
            record = RepairRecord(
                file_path=file_path,
                status=RepairStatus.NEEDS_REPAIR,
                corruption_type=corruption_type,
                first_detected=datetime.now().isoformat(),
                repair_attempts=0,
                last_attempt=None,
                repair_method=None,
                repaired_at=None,
                error_details=error_details
            )

        # Save
        if "files" not in status:
            status["files"] = {}
        status["files"][file_path] = record.to_dict()
        self._save_status(status)

        logger.info(f"Marked file for repair: {file_path} ({corruption_type.value})")
        return record

    def mark_repaired(
        self,
        file_path: str,
        repair_method: str = "ScanPST.exe"
    ) -> Optional[RepairRecord]:
        """
        Mark a file as successfully repaired.

        Args:
            file_path: Path to PST file
            repair_method: Method used to repair (e.g., "ScanPST.exe")

        Returns:
            Updated RepairRecord or None if not found
        """
        status = self._load_status()

        if file_path not in status.get("files", {}):
            logger.warning(f"File not in repair status: {file_path}")
            return None

        record = RepairRecord.from_dict(file_path, status["files"][file_path])
        record.status = RepairStatus.REPAIRED
        record.repair_method = repair_method
        record.repaired_at = datetime.now().isoformat()

        status["files"][file_path] = record.to_dict()
        self._save_status(status)

        logger.info(f"Marked file as repaired: {file_path}")
        return record

    def mark_repair_failed(
        self,
        file_path: str,
        error_details: str
    ) -> Optional[RepairRecord]:
        """
        Mark a repair attempt as failed.

        Args:
            file_path: Path to PST file
            error_details: Details about the failure

        Returns:
            Updated RepairRecord or None if not found
        """
        status = self._load_status()

        if file_path not in status.get("files", {}):
            logger.warning(f"File not in repair status: {file_path}")
            return None

        record = RepairRecord.from_dict(file_path, status["files"][file_path])
        record.status = RepairStatus.REPAIR_FAILED
        record.repair_attempts += 1
        record.last_attempt = datetime.now().isoformat()
        record.error_details = error_details

        status["files"][file_path] = record.to_dict()
        self._save_status(status)

        logger.warning(f"Marked repair as failed: {file_path}")
        return record

    def mark_ok(self, file_path: str) -> RepairRecord:
        """
        Mark a file as OK (healthy).

        Args:
            file_path: Path to PST file

        Returns:
            RepairRecord with OK status
        """
        status = self._load_status()

        record = RepairRecord(
            file_path=file_path,
            status=RepairStatus.OK,
            corruption_type=CorruptionType.NONE,
            first_detected=datetime.now().isoformat(),
            repair_attempts=0,
            last_attempt=None,
            repair_method=None,
            repaired_at=None,
            error_details=None
        )

        if "files" not in status:
            status["files"] = {}
        status["files"][file_path] = record.to_dict()
        self._save_status(status)

        return record

    def get_files_needing_repair(self) -> List[RepairRecord]:
        """
        Get all files that need repair.

        Returns:
            List of RepairRecords with needs_repair status
        """
        status = self._load_status()
        records = []

        for file_path, data in status.get("files", {}).items():
            record = RepairRecord.from_dict(file_path, data)
            if record.status == RepairStatus.NEEDS_REPAIR:
                records.append(record)

        return records

    def get_all_status(self) -> Dict[str, RepairRecord]:
        """
        Get all file statuses.

        Returns:
            Dictionary of file_path -> RepairRecord
        """
        status = self._load_status()
        return {
            file_path: RepairRecord.from_dict(file_path, data)
            for file_path, data in status.get("files", {}).items()
        }

    def remove_file(self, file_path: str) -> bool:
        """
        Remove a file from tracking.

        Args:
            file_path: Path to PST file

        Returns:
            True if removed, False if not found
        """
        status = self._load_status()

        if file_path in status.get("files", {}):
            del status["files"][file_path]
            self._save_status(status)
            logger.info(f"Removed file from repair tracking: {file_path}")
            return True

        return False

    def print_status_report(self) -> str:
        """
        Generate a human-readable status report.

        Returns:
            Formatted status report string
        """
        status = self._load_status()

        lines = [
            "=" * 70,
            "PST REPAIR STATUS REPORT",
            "=" * 70,
            f"Last Updated: {status.get('last_updated', 'Unknown')}",
            ""
        ]

        files = status.get("files", {})

        if not files:
            lines.append("No files tracked.")
        else:
            # Group by status
            by_status = {}
            for file_path, data in files.items():
                file_status = data.get("status", "unknown")
                if file_status not in by_status:
                    by_status[file_status] = []
                by_status[file_status].append((file_path, data))

            # Print needs_repair first
            if "needs_repair" in by_status:
                lines.append("FILES NEEDING REPAIR:")
                lines.append("-" * 40)
                for file_path, data in by_status["needs_repair"]:
                    corruption = data.get("corruption_type", "unknown")
                    attempts = data.get("repair_attempts", 0)
                    lines.append(f"  {os.path.basename(file_path)}")
                    lines.append(f"    Path: {file_path}")
                    lines.append(f"    Corruption: {corruption}")
                    lines.append(f"    Repair Attempts: {attempts}")
                    lines.append("")

            # Print other statuses
            for status_name in ["repair_failed", "repaired", "ok"]:
                if status_name in by_status:
                    lines.append(f"\n{status_name.upper().replace('_', ' ')}:")
                    lines.append("-" * 40)
                    for file_path, data in by_status[status_name]:
                        lines.append(f"  {os.path.basename(file_path)}")

        lines.append("")
        lines.append("=" * 70)

        report = "\n".join(lines)
        print(report)
        return report
