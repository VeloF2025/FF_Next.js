"""Email Processing Library"""

from lib.email.deduplicator import (
    EmailDeduplicator,
    DeduplicationStats,
    create_unified_dedup_checkpoint,
    is_email_duplicate
)

__all__ = [
    "EmailDeduplicator",
    "DeduplicationStats",
    "create_unified_dedup_checkpoint",
    "is_email_duplicate"
]
