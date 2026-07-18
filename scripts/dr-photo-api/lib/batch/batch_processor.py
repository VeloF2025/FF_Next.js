"""
Batch Processor for BOSS - Efficient Multi-Operation Processing.

Batches multiple similar operations into single API calls:
- Email classification: Process 5-10 emails per request
- Draft generation: Generate multiple drafts efficiently
- Document processing: Batch OCR and classification

Research-backed optimization (2025):
- Batching reduces API round-trips by 60-80%
- Optimal batch size: 5-10 items (balance latency vs throughput)
- Token budget management prevents overflow

Sources:
- Anthropic Batch Processing Guide
- Context Engineering Best Practices (2025)
"""

import asyncio
import logging
from typing import Dict, Any, Optional, List, Callable, TypeVar, Generic
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

logger = logging.getLogger(__name__)

T = TypeVar('T')
R = TypeVar('R')


class BatchStatus(Enum):
    """Status of a batch operation."""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    PARTIAL = "partial"  # Some items failed
    FAILED = "failed"


@dataclass
class BatchConfig:
    """Configuration for batch processing."""
    max_batch_size: int = 10
    max_tokens_per_batch: int = 8000
    timeout_seconds: float = 60.0
    retry_failed: bool = True
    max_retries: int = 2
    parallel_batches: int = 3


@dataclass
class BatchItem(Generic[T]):
    """Single item in a batch."""
    id: str
    data: T
    priority: int = 0
    tokens_estimate: int = 0
    result: Optional[Any] = None
    error: Optional[str] = None
    status: BatchStatus = BatchStatus.PENDING


@dataclass
class BatchResult(Generic[R]):
    """Result of a batch operation."""
    batch_id: str
    status: BatchStatus
    items_total: int
    items_succeeded: int
    items_failed: int
    results: List[R]
    errors: List[Dict[str, Any]]
    processing_time_ms: float
    tokens_used: int = 0
    cost_estimate: float = 0.0


class BatchProcessor:
    """
    Intelligent batch processor for API operations.

    Features:
    - Token-aware batching (respects token limits)
    - Priority ordering within batches
    - Automatic retry for failed items
    - Parallel batch execution
    - Cost tracking

    Usage:
        processor = BatchProcessor()

        # Batch email classification
        results = await processor.process_batch(
            items=emails,
            processor_fn=classify_email,
            batch_type="classification"
        )

        # Batch draft generation
        results = await processor.process_batch(
            items=email_contexts,
            processor_fn=generate_draft,
            batch_type="draft_generation"
        )
    """

    # Token estimates by operation type
    TOKEN_ESTIMATES = {
        "classification": 200,      # ~200 tokens per email classification
        "draft_generation": 800,    # ~800 tokens per draft
        "document_summary": 500,    # ~500 tokens per summary
        "entity_extraction": 300,   # ~300 tokens per extraction
    }

    def __init__(self, config: Optional[BatchConfig] = None):
        """
        Initialize batch processor.

        Args:
            config: Batch processing configuration
        """
        self.config = config or BatchConfig()
        self._stats = {
            "batches_processed": 0,
            "items_processed": 0,
            "items_failed": 0,
            "total_tokens": 0,
            "total_cost": 0.0,
        }

        logger.info(
            f"BatchProcessor initialized "
            f"(max_batch={self.config.max_batch_size}, "
            f"max_tokens={self.config.max_tokens_per_batch})"
        )

    async def process_batch(
        self,
        items: List[Dict[str, Any]],
        processor_fn: Callable,
        batch_type: str = "classification",
        context: Optional[Dict[str, Any]] = None
    ) -> BatchResult:
        """
        Process multiple items in optimized batches.

        Args:
            items: List of items to process
            processor_fn: Async function to process each batch
            batch_type: Type of operation for token estimation
            context: Optional shared context for all items

        Returns:
            BatchResult with all processed items
        """
        start_time = datetime.now()
        batch_id = f"batch_{start_time.timestamp()}"

        # Create batch items with token estimates
        batch_items = self._create_batch_items(items, batch_type)

        # Split into optimal batches
        batches = self._split_into_batches(batch_items, batch_type)

        logger.info(
            f"📦 Processing {len(items)} items in {len(batches)} batches "
            f"(type={batch_type})"
        )

        # Process batches (parallel if configured)
        all_results = []
        all_errors = []
        total_tokens = 0

        if self.config.parallel_batches > 1 and len(batches) > 1:
            # Parallel processing
            results = await self._process_parallel(
                batches, processor_fn, context
            )
            for batch_result in results:
                all_results.extend(batch_result.get("results", []))
                all_errors.extend(batch_result.get("errors", []))
                total_tokens += batch_result.get("tokens", 0)
        else:
            # Sequential processing
            for batch in batches:
                batch_result = await self._process_single_batch(
                    batch, processor_fn, context
                )
                all_results.extend(batch_result.get("results", []))
                all_errors.extend(batch_result.get("errors", []))
                total_tokens += batch_result.get("tokens", 0)

        # Retry failed items if configured
        if self.config.retry_failed and all_errors:
            retry_results = await self._retry_failed(
                all_errors, processor_fn, context
            )
            all_results.extend(retry_results.get("results", []))
            # Remove successfully retried from errors
            retried_ids = {r.get("id") for r in retry_results.get("results", [])}
            all_errors = [e for e in all_errors if e.get("id") not in retried_ids]

        # Calculate processing time
        processing_time = (datetime.now() - start_time).total_seconds() * 1000

        # Update stats
        self._stats["batches_processed"] += len(batches)
        self._stats["items_processed"] += len(all_results)
        self._stats["items_failed"] += len(all_errors)
        self._stats["total_tokens"] += total_tokens

        # Determine status
        if len(all_errors) == 0:
            status = BatchStatus.COMPLETED
        elif len(all_results) == 0:
            status = BatchStatus.FAILED
        else:
            status = BatchStatus.PARTIAL

        logger.info(
            f"✅ Batch {batch_id} completed: "
            f"{len(all_results)}/{len(items)} succeeded "
            f"({processing_time:.0f}ms)"
        )

        return BatchResult(
            batch_id=batch_id,
            status=status,
            items_total=len(items),
            items_succeeded=len(all_results),
            items_failed=len(all_errors),
            results=all_results,
            errors=all_errors,
            processing_time_ms=processing_time,
            tokens_used=total_tokens,
            cost_estimate=self._estimate_cost(total_tokens)
        )

    def _create_batch_items(
        self,
        items: List[Dict[str, Any]],
        batch_type: str
    ) -> List[BatchItem]:
        """Create batch items with token estimates."""
        base_tokens = self.TOKEN_ESTIMATES.get(batch_type, 300)

        batch_items = []
        for i, item in enumerate(items):
            # Estimate tokens based on content size
            content_size = len(str(item.get("body", ""))) // 4  # Rough token estimate
            tokens_estimate = base_tokens + min(content_size, 500)

            batch_items.append(BatchItem(
                id=item.get("id", f"item_{i}"),
                data=item,
                priority=item.get("priority", 0),
                tokens_estimate=tokens_estimate
            ))

        # Sort by priority (higher first)
        batch_items.sort(key=lambda x: x.priority, reverse=True)

        return batch_items

    def _split_into_batches(
        self,
        items: List[BatchItem],
        batch_type: str
    ) -> List[List[BatchItem]]:
        """Split items into optimal batches based on token limits."""
        batches = []
        current_batch = []
        current_tokens = 0

        for item in items:
            # Check if adding this item would exceed limits
            would_exceed_size = len(current_batch) >= self.config.max_batch_size
            would_exceed_tokens = (
                current_tokens + item.tokens_estimate >
                self.config.max_tokens_per_batch
            )

            if current_batch and (would_exceed_size or would_exceed_tokens):
                # Start new batch
                batches.append(current_batch)
                current_batch = []
                current_tokens = 0

            current_batch.append(item)
            current_tokens += item.tokens_estimate

        # Add remaining items
        if current_batch:
            batches.append(current_batch)

        return batches

    async def _process_single_batch(
        self,
        batch: List[BatchItem],
        processor_fn: Callable,
        context: Optional[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Process a single batch of items."""
        results = []
        errors = []
        tokens_used = 0

        try:
            # Call processor function with batch
            batch_data = [item.data for item in batch]
            batch_result = await processor_fn(batch_data, context)

            # Process results
            if isinstance(batch_result, dict):
                results = batch_result.get("results", [])
                tokens_used = batch_result.get("tokens", 0)

                # Match results to items
                for i, item in enumerate(batch):
                    if i < len(results):
                        item.result = results[i]
                        item.status = BatchStatus.COMPLETED
                    else:
                        item.status = BatchStatus.FAILED
                        item.error = "No result returned"
                        errors.append({
                            "id": item.id,
                            "data": item.data,
                            "error": item.error
                        })

            elif isinstance(batch_result, list):
                results = batch_result
                for i, item in enumerate(batch):
                    if i < len(results):
                        item.result = results[i]
                        item.status = BatchStatus.COMPLETED

        except Exception as e:
            logger.error(f"Batch processing error: {e}")
            for item in batch:
                item.status = BatchStatus.FAILED
                item.error = str(e)
                errors.append({
                    "id": item.id,
                    "data": item.data,
                    "error": str(e)
                })

        return {
            "results": [{"id": item.id, "result": item.result}
                       for item in batch if item.status == BatchStatus.COMPLETED],
            "errors": errors,
            "tokens": tokens_used
        }

    async def _process_parallel(
        self,
        batches: List[List[BatchItem]],
        processor_fn: Callable,
        context: Optional[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Process multiple batches in parallel."""
        # Limit concurrency
        semaphore = asyncio.Semaphore(self.config.parallel_batches)

        async def process_with_semaphore(batch):
            async with semaphore:
                return await self._process_single_batch(batch, processor_fn, context)

        tasks = [process_with_semaphore(batch) for batch in batches]
        return await asyncio.gather(*tasks)

    async def _retry_failed(
        self,
        errors: List[Dict[str, Any]],
        processor_fn: Callable,
        context: Optional[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Retry failed items individually."""
        results = []
        remaining_errors = []

        for error_item in errors[:self.config.max_retries * 5]:  # Limit retries
            try:
                result = await processor_fn([error_item["data"]], context)
                if result:
                    results.append({
                        "id": error_item["id"],
                        "result": result[0] if isinstance(result, list) else result
                    })
                else:
                    remaining_errors.append(error_item)
            except Exception as e:
                remaining_errors.append({
                    **error_item,
                    "retry_error": str(e)
                })

        return {"results": results, "errors": remaining_errors}

    def _estimate_cost(self, tokens: int) -> float:
        """Estimate cost based on tokens used."""
        # Using Sonnet pricing as default
        cost_per_1k = 0.003  # $3/MTok input
        return (tokens / 1000) * cost_per_1k

    def get_stats(self) -> Dict[str, Any]:
        """Get batch processing statistics."""
        return {
            **self._stats,
            "avg_items_per_batch": (
                self._stats["items_processed"] / max(self._stats["batches_processed"], 1)
            ),
            "success_rate": (
                self._stats["items_processed"] /
                max(self._stats["items_processed"] + self._stats["items_failed"], 1)
            ) * 100
        }

    def reset_stats(self):
        """Reset statistics."""
        self._stats = {
            "batches_processed": 0,
            "items_processed": 0,
            "items_failed": 0,
            "total_tokens": 0,
            "total_cost": 0.0,
        }


# =============================================================================
# SPECIALIZED BATCH PROCESSORS
# =============================================================================

class EmailBatchProcessor(BatchProcessor):
    """
    Specialized batch processor for email operations.

    Optimized for:
    - Email classification (5-10 emails per batch)
    - Draft generation (3-5 drafts per batch)
    - Reply suggestions
    """

    def __init__(self, config: Optional[BatchConfig] = None):
        if config is None:
            config = BatchConfig(
                max_batch_size=8,
                max_tokens_per_batch=6000,
                timeout_seconds=45.0
            )
        super().__init__(config)

    async def classify_batch(
        self,
        emails: List[Dict[str, Any]],
        classifier_fn: Callable
    ) -> BatchResult:
        """
        Classify multiple emails in a single batch.

        Args:
            emails: List of email dicts (subject, body, sender)
            classifier_fn: Classification function

        Returns:
            BatchResult with classifications
        """
        return await self.process_batch(
            items=emails,
            processor_fn=classifier_fn,
            batch_type="classification"
        )

    async def generate_drafts_batch(
        self,
        email_contexts: List[Dict[str, Any]],
        draft_fn: Callable,
        shared_context: Optional[Dict[str, Any]] = None
    ) -> BatchResult:
        """
        Generate multiple email drafts in batches.

        Args:
            email_contexts: List of email contexts for drafting
            draft_fn: Draft generation function
            shared_context: Shared context (user info, company info)

        Returns:
            BatchResult with generated drafts
        """
        return await self.process_batch(
            items=email_contexts,
            processor_fn=draft_fn,
            batch_type="draft_generation",
            context=shared_context
        )


class DocumentBatchProcessor(BatchProcessor):
    """
    Specialized batch processor for document operations.

    Optimized for:
    - Document classification
    - Text extraction batching
    - Summary generation
    """

    def __init__(self, config: Optional[BatchConfig] = None):
        if config is None:
            config = BatchConfig(
                max_batch_size=5,
                max_tokens_per_batch=10000,
                timeout_seconds=120.0
            )
        super().__init__(config)

    async def classify_documents_batch(
        self,
        documents: List[Dict[str, Any]],
        classifier_fn: Callable
    ) -> BatchResult:
        """Classify multiple documents in batches."""
        return await self.process_batch(
            items=documents,
            processor_fn=classifier_fn,
            batch_type="classification"
        )

    async def summarize_batch(
        self,
        documents: List[Dict[str, Any]],
        summarizer_fn: Callable
    ) -> BatchResult:
        """Generate summaries for multiple documents."""
        return await self.process_batch(
            items=documents,
            processor_fn=summarizer_fn,
            batch_type="document_summary"
        )


# =============================================================================
# SINGLETON INSTANCE
# =============================================================================

_batch_processor_instance: Optional[BatchProcessor] = None
_email_batch_processor: Optional[EmailBatchProcessor] = None
_document_batch_processor: Optional[DocumentBatchProcessor] = None


def get_batch_processor() -> BatchProcessor:
    """Get singleton BatchProcessor instance."""
    global _batch_processor_instance
    if _batch_processor_instance is None:
        _batch_processor_instance = BatchProcessor()
    return _batch_processor_instance


def get_email_batch_processor() -> EmailBatchProcessor:
    """Get singleton EmailBatchProcessor instance."""
    global _email_batch_processor
    if _email_batch_processor is None:
        _email_batch_processor = EmailBatchProcessor()
    return _email_batch_processor


def get_document_batch_processor() -> DocumentBatchProcessor:
    """Get singleton DocumentBatchProcessor instance."""
    global _document_batch_processor
    if _document_batch_processor is None:
        _document_batch_processor = DocumentBatchProcessor()
    return _document_batch_processor
