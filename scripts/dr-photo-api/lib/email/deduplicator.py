"""
Email Deduplication System

Purpose: Prevent duplicate emails from being ingested across PST, OST,
         IMAP, and MS Graph sources. Uses a multi-strategy approach:
         1. Message-ID based deduplication (primary)
         2. Content hash fallback (for emails without proper Message-ID)
         3. Set-based O(1) lookup for performance

Authority: PAI-native development
Version: 1.0.0
"""

import hashlib
import json
import logging
from pathlib import Path
from typing import Set, Dict, Any, Optional, Tuple
from datetime import datetime
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class DeduplicationStats:
    """Statistics for deduplication operations."""
    total_checked: int = 0
    duplicates_found: int = 0
    by_message_id: int = 0
    by_content_hash: int = 0
    new_emails: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "total_checked": self.total_checked,
            "duplicates_found": self.duplicates_found,
            "by_message_id": self.by_message_id,
            "by_content_hash": self.by_content_hash,
            "new_emails": self.new_emails,
            "duplicate_rate": f"{(self.duplicates_found / max(1, self.total_checked)) * 100:.1f}%"
        }


class EmailDeduplicator:
    """
    Multi-strategy email deduplication system.

    Uses two deduplication strategies:
    1. Message-ID: RFC 5322 compliant message identifiers (primary)
    2. Content Hash: SHA-256 of sender+subject+date+body_preview (fallback)

    Both use Set-based O(1) lookups for performance with 100K+ emails.
    """

    def __init__(self, checkpoint_path: Optional[Path] = None):
        """
        Initialize deduplicator.

        Args:
            checkpoint_path: Path to checkpoint file for persistence
        """
        self.checkpoint_path = checkpoint_path or Path("data/email_dedup_checkpoint.json")

        # Use sets for O(1) lookup (instead of lists which are O(n))
        self._message_ids: Set[str] = set()
        self._content_hashes: Set[str] = set()

        # Stats tracking
        self.stats = DeduplicationStats()

        # Load existing checkpoint
        self._load_checkpoint()

    def _load_checkpoint(self) -> None:
        """Load existing checkpoint data into memory sets."""
        if self.checkpoint_path.exists():
            try:
                with open(self.checkpoint_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)

                # Load message IDs (convert list to set)
                message_ids = data.get("processed_message_ids", [])
                self._message_ids = set(message_ids)

                # Load content hashes if they exist
                content_hashes = data.get("content_hashes", [])
                self._content_hashes = set(content_hashes)

                logger.info(
                    f"Loaded dedup checkpoint: {len(self._message_ids)} message IDs, "
                    f"{len(self._content_hashes)} content hashes"
                )
            except Exception as e:
                logger.error(f"Failed to load checkpoint: {e}")
        else:
            # Try loading from PST ingestion checkpoint for backwards compatibility
            pst_checkpoint = Path("data/pst_ingestion_checkpoint.json")
            if pst_checkpoint.exists():
                try:
                    with open(pst_checkpoint, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    message_ids = data.get("processed_message_ids", [])
                    self._message_ids = set(message_ids)
                    logger.info(f"Migrated {len(self._message_ids)} message IDs from PST checkpoint")
                except Exception as e:
                    logger.warning(f"Failed to migrate PST checkpoint: {e}")

    def save_checkpoint(self) -> None:
        """Save current state to checkpoint file."""
        try:
            self.checkpoint_path.parent.mkdir(parents=True, exist_ok=True)

            data = {
                "processed_message_ids": list(self._message_ids),
                "content_hashes": list(self._content_hashes),
                "last_updated": datetime.now().isoformat(),
                "stats": self.stats.to_dict()
            }

            with open(self.checkpoint_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)

            logger.info(f"Saved dedup checkpoint: {len(self._message_ids)} IDs, {len(self._content_hashes)} hashes")
        except Exception as e:
            logger.error(f"Failed to save checkpoint: {e}")

    @staticmethod
    def compute_content_hash(
        sender: str,
        subject: str,
        date: Optional[datetime],
        body_preview: str
    ) -> str:
        """
        Compute content-based hash for an email.

        Used as fallback when Message-ID is missing or synthetic.

        Args:
            sender: Email sender address
            subject: Email subject
            date: Email date/time
            body_preview: First 500 chars of body

        Returns:
            SHA-256 hash of normalized content
        """
        # Normalize inputs
        sender_norm = (sender or "").lower().strip()
        subject_norm = (subject or "").lower().strip()
        date_str = date.isoformat() if date else ""
        body_norm = (body_preview or "")[:500].lower().strip()

        # Create content string
        content = f"{sender_norm}|{subject_norm}|{date_str}|{body_norm}"

        # Compute hash
        return hashlib.sha256(content.encode('utf-8')).hexdigest()

    @staticmethod
    def is_synthetic_message_id(message_id: str) -> bool:
        """
        Check if a Message-ID is synthetic (generated by BOSS, not original).

        Synthetic IDs need content-based dedup because they're unique per extraction.

        Args:
            message_id: The Message-ID to check

        Returns:
            True if synthetic, False if original
        """
        if not message_id:
            return True

        # BOSS-generated IDs have these patterns
        synthetic_patterns = [
            "@boss.local>",
            "<pst-",
            "<ost-",
            "<msg-",
            "<imap-generated-",
        ]

        message_id_lower = message_id.lower()
        return any(pattern in message_id_lower for pattern in synthetic_patterns)

    def is_duplicate(
        self,
        message_id: Optional[str] = None,
        sender: Optional[str] = None,
        subject: Optional[str] = None,
        date: Optional[datetime] = None,
        body_preview: Optional[str] = None
    ) -> Tuple[bool, str]:
        """
        Check if an email is a duplicate.

        Uses Message-ID first, falls back to content hash for synthetic IDs.

        Args:
            message_id: RFC 5322 Message-ID
            sender: Email sender address
            subject: Email subject
            date: Email date
            body_preview: First 500 chars of body (for content hash)

        Returns:
            Tuple of (is_duplicate: bool, reason: str)
        """
        self.stats.total_checked += 1

        # Strategy 1: Check by Message-ID (if not synthetic)
        if message_id and not self.is_synthetic_message_id(message_id):
            if message_id in self._message_ids:
                self.stats.duplicates_found += 1
                self.stats.by_message_id += 1
                return True, f"message_id:{message_id}"

        # Strategy 2: Check by content hash (always, as additional safety)
        if sender or subject or date:
            content_hash = self.compute_content_hash(sender, subject, date, body_preview or "")
            if content_hash in self._content_hashes:
                self.stats.duplicates_found += 1
                self.stats.by_content_hash += 1
                return True, f"content_hash:{content_hash[:16]}..."

        # Not a duplicate
        self.stats.new_emails += 1
        return False, "new"

    def mark_processed(
        self,
        message_id: Optional[str] = None,
        sender: Optional[str] = None,
        subject: Optional[str] = None,
        date: Optional[datetime] = None,
        body_preview: Optional[str] = None
    ) -> None:
        """
        Mark an email as processed (add to dedup sets).

        Args:
            message_id: RFC 5322 Message-ID
            sender: Email sender address
            subject: Email subject
            date: Email date
            body_preview: First 500 chars of body
        """
        # Add Message-ID if not synthetic
        if message_id and not self.is_synthetic_message_id(message_id):
            self._message_ids.add(message_id)

        # Always add content hash for additional safety
        if sender or subject or date:
            content_hash = self.compute_content_hash(sender, subject, date, body_preview or "")
            self._content_hashes.add(content_hash)

    def get_stats(self) -> Dict[str, Any]:
        """Get current deduplication statistics."""
        return {
            **self.stats.to_dict(),
            "total_message_ids": len(self._message_ids),
            "total_content_hashes": len(self._content_hashes)
        }

    def merge_from_checkpoint(self, checkpoint_path: Path) -> int:
        """
        Merge message IDs from another checkpoint file.

        Useful for combining PST/IMAP/MS Graph checkpoints.

        Args:
            checkpoint_path: Path to checkpoint file to merge

        Returns:
            Number of new IDs merged
        """
        if not checkpoint_path.exists():
            logger.warning(f"Checkpoint not found: {checkpoint_path}")
            return 0

        try:
            with open(checkpoint_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            initial_count = len(self._message_ids)

            # Merge message IDs
            new_ids = data.get("processed_message_ids", [])
            self._message_ids.update(new_ids)

            # Merge content hashes if present
            new_hashes = data.get("content_hashes", [])
            self._content_hashes.update(new_hashes)

            merged = len(self._message_ids) - initial_count
            logger.info(f"Merged {merged} new IDs from {checkpoint_path}")
            return merged

        except Exception as e:
            logger.error(f"Failed to merge checkpoint: {e}")
            return 0


def create_unified_dedup_checkpoint() -> EmailDeduplicator:
    """
    Create a unified deduplicator from all existing checkpoints.

    Merges:
    - PST ingestion checkpoint
    - IMAP checkpoint(s)
    - MS Graph checkpoint(s)

    Returns:
        EmailDeduplicator with all known message IDs
    """
    dedup = EmailDeduplicator(Path("data/unified_email_dedup.json"))

    # Merge PST checkpoint
    pst_checkpoint = Path("data/pst_ingestion_checkpoint.json")
    if pst_checkpoint.exists():
        dedup.merge_from_checkpoint(pst_checkpoint)

    # Merge IMAP checkpoints
    imap_dir = Path("data")
    for checkpoint in imap_dir.glob("imap_checkpoint_*.json"):
        dedup.merge_from_checkpoint(checkpoint)

    # Merge msgraph checkpoints
    for checkpoint in imap_dir.glob("msgraph_checkpoint_*.json"):
        dedup.merge_from_checkpoint(checkpoint)

    # Save unified checkpoint
    dedup.save_checkpoint()

    logger.info(f"Created unified dedup with {len(dedup._message_ids)} message IDs")
    return dedup


# Convenience function for quick duplicate check
def is_email_duplicate(
    message_id: Optional[str] = None,
    sender: Optional[str] = None,
    subject: Optional[str] = None,
    date: Optional[datetime] = None,
    body_preview: Optional[str] = None,
    checkpoint_path: Optional[Path] = None
) -> bool:
    """
    Quick check if an email is a duplicate.

    Creates a deduplicator instance and checks. For batch processing,
    use EmailDeduplicator directly to avoid repeated checkpoint loads.
    """
    dedup = EmailDeduplicator(checkpoint_path)
    is_dup, _ = dedup.is_duplicate(message_id, sender, subject, date, body_preview)
    return is_dup
