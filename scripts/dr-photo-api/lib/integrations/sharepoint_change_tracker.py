"""
SharePoint Excel Change Tracker for BOSS

Tracks changes to SharePoint Excel files and triggers processing when changes detected.

Features:
- Monitor file modifications via MS Graph API
- Detect which sheets changed
- Calculate row/column differences
- Store version history
- Trigger automated processing on changes
"""

import os
import logging
import asyncio
import hashlib
import json
from typing import Optional, Dict, Any, List
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv
import pandas as pd

from .sharepoint_connector import SharePointExcelConnector

load_dotenv()
logger = logging.getLogger(__name__)


class SharePointChangeTracker:
    """
    Track changes to SharePoint Excel files.

    Monitors file modifications, detects changes, and triggers processing.
    """

    def __init__(self, checkpoint_dir: str = "data/sharepoint/checkpoints"):
        """
        Initialize change tracker.

        Args:
            checkpoint_dir: Directory to store checkpoint data
        """
        self.checkpoint_dir = Path(checkpoint_dir)
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)

        logger.info(f"SharePoint Change Tracker initialized (checkpoints: {self.checkpoint_dir})")

    def _get_checkpoint_path(self, sharepoint_url: str) -> Path:
        """Get checkpoint file path for a SharePoint URL."""
        # Create safe filename from URL
        url_hash = hashlib.md5(sharepoint_url.encode()).hexdigest()
        return self.checkpoint_dir / f"checkpoint_{url_hash}.json"

    def _load_checkpoint(self, sharepoint_url: str) -> Optional[Dict[str, Any]]:
        """Load previous checkpoint data."""
        checkpoint_path = self._get_checkpoint_path(sharepoint_url)

        if not checkpoint_path.exists():
            logger.info(f"No previous checkpoint found for {sharepoint_url}")
            return None

        with open(checkpoint_path, 'r', encoding='utf-8') as f:
            checkpoint = json.load(f)

        logger.info(f"Loaded checkpoint: {checkpoint['file_modified']}")
        return checkpoint

    def _save_checkpoint(
        self,
        sharepoint_url: str,
        file_metadata: Dict[str, Any],
        sheet_checksums: Dict[str, str]
    ) -> None:
        """Save checkpoint data."""
        checkpoint_path = self._get_checkpoint_path(sharepoint_url)

        checkpoint = {
            'sharepoint_url': sharepoint_url,
            'file_name': file_metadata['name'],
            'file_size': file_metadata['size'],
            'file_modified': file_metadata['modified'],
            'file_id': file_metadata.get('id'),
            'last_checked': datetime.now().isoformat(),
            'sheet_checksums': sheet_checksums,
            'sheet_count': len(sheet_checksums)
        }

        with open(checkpoint_path, 'w', encoding='utf-8') as f:
            json.dump(checkpoint, f, indent=2)

        logger.info(f"Saved checkpoint: {checkpoint_path}")

    def _calculate_sheet_checksum(self, df: pd.DataFrame) -> str:
        """
        Calculate checksum for a DataFrame.

        Uses shape, column names, and sample of data to detect changes.
        """
        # Combine shape, columns, and data hash
        shape_str = f"{df.shape[0]}x{df.shape[1]}"
        cols_str = ",".join(df.columns.astype(str))

        # Hash first/last 100 rows to detect data changes
        sample_size = min(100, len(df))
        if sample_size > 0:
            try:
                # Reset index to avoid duplicate index issues
                sample_data = pd.concat([
                    df.head(sample_size).reset_index(drop=True),
                    df.tail(sample_size).reset_index(drop=True)
                ]).to_json()
            except Exception:
                # Fallback: just use string representation
                sample_data = str(df.head(sample_size)) + str(df.tail(sample_size))
        else:
            sample_data = ""

        checksum_input = f"{shape_str}|{cols_str}|{sample_data}"
        checksum = hashlib.md5(checksum_input.encode()).hexdigest()

        return checksum

    async def check_for_changes(
        self,
        sharepoint_url: str,
        download_if_changed: bool = True
    ) -> Dict[str, Any]:
        """
        Check if SharePoint file has changed since last check.

        Args:
            sharepoint_url: SharePoint sharing URL
            download_if_changed: Download file if changes detected

        Returns:
            Dict with change detection results:
            {
                'changed': bool,
                'file_modified': str,
                'changes_detected': {
                    'file_size': bool,
                    'sheets_added': List[str],
                    'sheets_removed': List[str],
                    'sheets_modified': List[str]
                },
                'all_sheets': Dict[str, pd.DataFrame] (if download_if_changed=True)
            }
        """
        logger.info(f"Checking for changes: {sharepoint_url}")

        async with SharePointExcelConnector() as connector:
            # Get current file metadata
            current_metadata = await connector.get_file_metadata(sharepoint_url)

            # Load previous checkpoint
            previous_checkpoint = self._load_checkpoint(sharepoint_url)

            result = {
                'changed': False,
                'file_modified': current_metadata['modified'],
                'file_name': current_metadata['name'],
                'file_size': current_metadata['size'],
                'changes_detected': {
                    'file_size': False,
                    'sheets_added': [],
                    'sheets_removed': [],
                    'sheets_modified': []
                },
                'all_sheets': None
            }

            # First run - no previous checkpoint
            if not previous_checkpoint:
                logger.info("First run - downloading file to establish baseline...")
                result['changed'] = True
                result['changes_detected']['reason'] = 'first_run'

                if download_if_changed:
                    all_sheets = await connector.read_all_sheets_from_sharepoint(sharepoint_url)
                    result['all_sheets'] = all_sheets

                    # Calculate checksums for all sheets
                    sheet_checksums = {
                        sheet_name: self._calculate_sheet_checksum(df)
                        for sheet_name, df in all_sheets.items()
                    }

                    # Save checkpoint
                    self._save_checkpoint(sharepoint_url, current_metadata, sheet_checksums)

                return result

            # Check if file modified date changed
            if current_metadata['modified'] != previous_checkpoint['file_modified']:
                logger.info(f"File modified date changed: {previous_checkpoint['file_modified']} → {current_metadata['modified']}")
                result['changed'] = True

                # Check file size
                if current_metadata['size'] != previous_checkpoint['file_size']:
                    result['changes_detected']['file_size'] = True
                    logger.info(f"File size changed: {previous_checkpoint['file_size']} → {current_metadata['size']}")

                # Download and compare sheets
                if download_if_changed:
                    logger.info("Downloading file to detect sheet changes...")
                    all_sheets = await connector.read_all_sheets_from_sharepoint(sharepoint_url)
                    result['all_sheets'] = all_sheets

                    # Calculate new checksums
                    current_checksums = {
                        sheet_name: self._calculate_sheet_checksum(df)
                        for sheet_name, df in all_sheets.items()
                    }

                    previous_checksums = previous_checkpoint['sheet_checksums']

                    # Detect added sheets
                    result['changes_detected']['sheets_added'] = [
                        sheet for sheet in current_checksums
                        if sheet not in previous_checksums
                    ]

                    # Detect removed sheets
                    result['changes_detected']['sheets_removed'] = [
                        sheet for sheet in previous_checksums
                        if sheet not in current_checksums
                    ]

                    # Detect modified sheets
                    result['changes_detected']['sheets_modified'] = [
                        sheet for sheet in current_checksums
                        if sheet in previous_checksums and
                        current_checksums[sheet] != previous_checksums[sheet]
                    ]

                    # Log changes
                    if result['changes_detected']['sheets_added']:
                        logger.info(f"Sheets added: {result['changes_detected']['sheets_added']}")

                    if result['changes_detected']['sheets_removed']:
                        logger.info(f"Sheets removed: {result['changes_detected']['sheets_removed']}")

                    if result['changes_detected']['sheets_modified']:
                        logger.info(f"Sheets modified: {result['changes_detected']['sheets_modified']}")

                    # Save new checkpoint
                    self._save_checkpoint(sharepoint_url, current_metadata, current_checksums)

            else:
                logger.info("No changes detected (file modified date unchanged)")

            return result

    async def monitor_continuous(
        self,
        sharepoint_url: str,
        check_interval_seconds: int = 3600,
        on_change_callback=None
    ):
        """
        Continuously monitor SharePoint file for changes.

        Args:
            sharepoint_url: SharePoint sharing URL
            check_interval_seconds: How often to check (default: 3600 = 1 hour)
            on_change_callback: Async function to call when changes detected
                                Signature: async def callback(change_result: Dict)
        """
        logger.info(f"Starting continuous monitoring (interval: {check_interval_seconds}s)")

        while True:
            try:
                # Check for changes
                result = await self.check_for_changes(sharepoint_url, download_if_changed=True)

                if result['changed']:
                    logger.info(f"Changes detected at {datetime.now()}")
                    logger.info(f"  File: {result['file_name']}")
                    logger.info(f"  Size: {result['file_size']:,} bytes")
                    logger.info(f"  Modified: {result['file_modified']}")
                    logger.info(f"  Sheets added: {len(result['changes_detected']['sheets_added'])}")
                    logger.info(f"  Sheets removed: {len(result['changes_detected']['sheets_removed'])}")
                    logger.info(f"  Sheets modified: {len(result['changes_detected']['sheets_modified'])}")

                    # Trigger callback if provided
                    if on_change_callback and callable(on_change_callback):
                        logger.info("Triggering change callback...")
                        await on_change_callback(result)

                else:
                    logger.info(f"No changes detected at {datetime.now()}")

                # Wait before next check
                logger.info(f"Next check in {check_interval_seconds} seconds...")
                await asyncio.sleep(check_interval_seconds)

            except KeyboardInterrupt:
                logger.info("Monitoring stopped by user")
                break

            except Exception as e:
                logger.error(f"Error during monitoring: {e}")
                logger.info(f"Retrying in {check_interval_seconds} seconds...")
                await asyncio.sleep(check_interval_seconds)


# ============================================================================
# CLI TEST
# ============================================================================

async def test_change_tracking():
    """Test change tracking functionality."""
    tracker = SharePointChangeTracker()

    test_url = "https://blitzfibre.sharepoint.com/:x:/s/Velocity_Manco/IQCFLsIHWSd_S428g84i_rUhAfEYaQXyHkEl8RHAZc0pLek?e=cuTxoQ"

    print("="*80)
    print("TESTING SHAREPOINT CHANGE TRACKING")
    print("="*80)
    print()

    # Check for changes
    result = await tracker.check_for_changes(test_url, download_if_changed=True)

    print(f"Changed: {result['changed']}")
    print(f"File: {result['file_name']}")
    print(f"Size: {result['file_size']:,} bytes")
    print(f"Modified: {result['file_modified']}")
    print()

    if result['changed']:
        print("Changes detected:")
        print(f"  File size changed: {result['changes_detected']['file_size']}")
        print(f"  Sheets added: {result['changes_detected']['sheets_added']}")
        print(f"  Sheets removed: {result['changes_detected']['sheets_removed']}")
        print(f"  Sheets modified: {result['changes_detected']['sheets_modified']}")

        if result['all_sheets']:
            print(f"\nSheets in file: {len(result['all_sheets'])}")
            for sheet_name, df in result['all_sheets'].items():
                print(f"  - {sheet_name}: {df.shape[0]} rows x {df.shape[1]} columns")

    print()
    print("="*80)
    print("RUN THIS SCRIPT AGAIN TO TEST CHANGE DETECTION")
    print("(Modify the SharePoint file between runs)")
    print("="*80)


if __name__ == "__main__":
    asyncio.run(test_change_tracking())
