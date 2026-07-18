"""
Batch Processing Library for BOSS.

Provides efficient batch processing for multiple operations:
- Email classification batching
- Draft generation batching
- Document processing batching

Benefits:
- Reduces API round-trips by 60-80%
- Improves throughput for bulk operations
- Maintains quality while reducing latency
"""

from .batch_processor import (
    BatchProcessor,
    BatchConfig,
    BatchResult,
    EmailBatchProcessor,
    DocumentBatchProcessor,
    get_batch_processor,
    get_email_batch_processor,
    get_document_batch_processor,
)

__all__ = [
    "BatchProcessor",
    "BatchConfig",
    "BatchResult",
    "EmailBatchProcessor",
    "DocumentBatchProcessor",
    "get_batch_processor",
    "get_email_batch_processor",
    "get_document_batch_processor",
]
