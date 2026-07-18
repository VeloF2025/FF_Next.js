"""
Email Filtering Module

Filters unwanted emails based on configurable rules:
- FF notices (Frogfoot installation notifications)
- Spam indicators
- Newsletter/marketing emails
- Automated notifications
"""

import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass

from loguru import logger


@dataclass
class FilterStats:
    """Email filtering statistics."""
    total_processed: int = 0
    filtered_out: int = 0
    filtered_by_subject: int = 0
    filtered_by_sender: int = 0
    filtered_by_folder: int = 0
    filtered_by_spam: int = 0
    filtered_by_category: int = 0


class EmailFilter:
    """
    Email filter with configurable rules.

    Filters emails based on:
    - Subject keywords/patterns
    - Sender domains
    - Folder names
    - Email categories
    - Spam indicators
    """

    def __init__(self, config_path: Optional[str] = None):
        """
        Initialize email filter.

        Args:
            config_path: Path to filter configuration JSON file
        """
        if config_path is None:
            config_path = "config/email_filters.json"

        self.config_path = Path(config_path)
        self.config = self._load_config()
        self.stats = FilterStats()

        logger.info(f"Email filter initialized from {config_path}")

    def _load_config(self) -> Dict[str, Any]:
        """Load filter configuration from JSON file."""
        if not self.config_path.exists():
            logger.warning(f"Filter config not found: {self.config_path}, using defaults")
            return self._get_default_config()

        with open(self.config_path, "r") as f:
            config = json.load(f)

        logger.info(
            f"Loaded {len(config.get('exclude_filters', {}).get('subject_contains', []))} subject filters, "
            f"{len(config.get('exclude_filters', {}).get('sender_domains', []))} sender filters"
        )

        return config

    def _get_default_config(self) -> Dict[str, Any]:
        """Get default filter configuration."""
        return {
            "exclude_filters": {
                "subject_contains": [],
                "subject_patterns": [],
                "sender_domains": [],
                "folder_names": ["junk", "spam"],
                "categories": ["spam", "junk"]
            },
            "spam_indicators": {
                "multiple_exclamation_marks": 3,
                "all_caps_subject_threshold": 0.7,
                "excessive_emoji_count": 5,
                "suspicious_phrases": []
            }
        }

    def should_filter_email(self, email: Any) -> tuple[bool, Optional[str]]:
        """
        Check if email should be filtered out.

        Args:
            email: Email object to check

        Returns:
            Tuple of (should_filter, reason)
        """
        self.stats.total_processed += 1

        # Check subject filters
        if self._check_subject_filters(email):
            self.stats.filtered_out += 1
            self.stats.filtered_by_subject += 1
            return True, "subject_filter"

        # Check sender filters
        if self._check_sender_filters(email):
            self.stats.filtered_out += 1
            self.stats.filtered_by_sender += 1
            return True, "sender_filter"

        # Check folder filters
        if self._check_folder_filters(email):
            self.stats.filtered_out += 1
            self.stats.filtered_by_folder += 1
            return True, "folder_filter"

        # Check category filters
        if self._check_category_filters(email):
            self.stats.filtered_out += 1
            self.stats.filtered_by_category += 1
            return True, "category_filter"

        # Check spam indicators
        if self._check_spam_indicators(email):
            self.stats.filtered_out += 1
            self.stats.filtered_by_spam += 1
            return True, "spam_indicator"

        return False, None

    def _check_subject_filters(self, email: Any) -> bool:
        """Check if email subject matches exclusion filters."""
        if not email.subject:
            return False

        subject = email.subject.lower()
        exclude_filters = self.config.get("exclude_filters", {})

        # Check exact phrase matches
        subject_contains = exclude_filters.get("subject_contains", [])
        for phrase in subject_contains:
            if phrase.lower() in subject:
                logger.debug(f"Filtered by subject phrase '{phrase}': {email.subject}")
                return True

        # Check regex patterns
        subject_patterns = exclude_filters.get("subject_patterns", [])
        for pattern in subject_patterns:
            if re.search(pattern, email.subject, re.IGNORECASE):
                logger.debug(f"Filtered by subject pattern '{pattern}': {email.subject}")
                return True

        return False

    def _check_sender_filters(self, email: Any) -> bool:
        """Check if email sender matches exclusion filters."""
        if not email.sender:
            return False

        sender = email.sender.lower()
        exclude_filters = self.config.get("exclude_filters", {})
        sender_domains = exclude_filters.get("sender_domains", [])

        for domain in sender_domains:
            if domain.lower() in sender:
                logger.debug(f"Filtered by sender domain '{domain}': {email.sender}")
                return True

        return False

    def _check_folder_filters(self, email: Any) -> bool:
        """Check if email folder matches exclusion filters."""
        if not hasattr(email, 'folder') or not email.folder:
            return False

        folder = email.folder.lower()
        exclude_filters = self.config.get("exclude_filters", {})
        folder_names = exclude_filters.get("folder_names", [])

        for excluded_folder in folder_names:
            if excluded_folder.lower() in folder:
                logger.debug(f"Filtered by folder '{excluded_folder}': {email.folder}")
                return True

        return False

    def _check_category_filters(self, email: Any) -> bool:
        """Check if email categories match exclusion filters."""
        if not hasattr(email, 'categories') or not email.categories:
            return False

        exclude_filters = self.config.get("exclude_filters", {})
        excluded_categories = [c.lower() for c in exclude_filters.get("categories", [])]

        for category in email.categories:
            if category.lower() in excluded_categories:
                logger.debug(f"Filtered by category '{category}': {email.subject}")
                return True

        return False

    def _check_spam_indicators(self, email: Any) -> bool:
        """Check for spam indicators in email."""
        if not email.subject:
            return False

        spam_config = self.config.get("spam_indicators", {})

        # Check for excessive exclamation marks
        exclamation_threshold = spam_config.get("multiple_exclamation_marks", 3)
        if email.subject.count("!") >= exclamation_threshold:
            logger.debug(f"Spam: excessive exclamation marks in '{email.subject}'")
            return True

        # Check for all-caps subject
        caps_threshold = spam_config.get("all_caps_subject_threshold", 0.7)
        if len(email.subject) > 10:  # Only check if subject is long enough
            alpha_chars = [c for c in email.subject if c.isalpha()]
            if alpha_chars:
                caps_ratio = sum(1 for c in alpha_chars if c.isupper()) / len(alpha_chars)
                if caps_ratio >= caps_threshold:
                    logger.debug(f"Spam: all-caps subject '{email.subject}'")
                    return True

        # Check for suspicious phrases
        subject_lower = email.subject.lower()
        suspicious_phrases = spam_config.get("suspicious_phrases", [])
        for phrase in suspicious_phrases:
            if phrase.lower() in subject_lower:
                logger.debug(f"Spam: suspicious phrase '{phrase}' in '{email.subject}'")
                return True

        return False

    def get_stats(self) -> Dict[str, int]:
        """Get filtering statistics."""
        return {
            "total_processed": self.stats.total_processed,
            "filtered_out": self.stats.filtered_out,
            "filtered_by_subject": self.stats.filtered_by_subject,
            "filtered_by_sender": self.stats.filtered_by_sender,
            "filtered_by_folder": self.stats.filtered_by_folder,
            "filtered_by_spam": self.stats.filtered_by_spam,
            "filtered_by_category": self.stats.filtered_by_category,
            "kept": self.stats.total_processed - self.stats.filtered_out,
            "filter_rate": (
                self.stats.filtered_out / self.stats.total_processed * 100
                if self.stats.total_processed > 0 else 0
            )
        }

    def log_stats(self):
        """Log filtering statistics."""
        stats = self.get_stats()
        logger.info("=" * 60)
        logger.info("EMAIL FILTERING STATISTICS")
        logger.info("=" * 60)
        logger.info(f"Total processed: {stats['total_processed']}")
        logger.info(f"Kept: {stats['kept']}")
        logger.info(f"Filtered out: {stats['filtered_out']} ({stats['filter_rate']:.1f}%)")
        logger.info("")
        logger.info("Filtered by:")
        logger.info(f"  - Subject: {stats['filtered_by_subject']}")
        logger.info(f"  - Sender: {stats['filtered_by_sender']}")
        logger.info(f"  - Folder: {stats['filtered_by_folder']}")
        logger.info(f"  - Category: {stats['filtered_by_category']}")
        logger.info(f"  - Spam indicators: {stats['filtered_by_spam']}")
        logger.info("=" * 60)
