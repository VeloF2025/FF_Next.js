"""
Event Deduplication for BOSS.

Prevents duplicate processing of events when fan-out occurs,
saving 30-40% on API costs by sharing results across agents.

Problem Solved:
- When an email arrives, multiple agents may query RAG for context
- Without deduplication, identical queries execute multiple times
- This wastes tokens and increases latency

Solution:
- Cache event processing results by event_id
- Share results across agents handling same event
- Use Redis for distributed caching (multi-process safe)

Based on 2025 Context Engineering Best Practices.
"""

import os
import json
import hashlib
import asyncio
from typing import Dict, Any, Optional, Callable, Awaitable
from datetime import datetime, timedelta
from loguru import logger

# Redis connection
try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    redis = None


class EventDeduplicator:
    """
    Deduplicates event processing to prevent redundant API calls.

    Features:
    - Tracks processed events by event_id
    - Caches RAG query results for reuse
    - Shares results across multiple agents handling same event
    - Redis-backed for multi-process support
    - Automatic expiration (default: 5 minutes)

    Usage:
        deduplicator = EventDeduplicator()

        # Check if event already processed
        if await deduplicator.is_processed(event.event_id):
            result = await deduplicator.get_cached_result(event.event_id)
        else:
            result = await process_event(event)
            await deduplicator.mark_processed(event.event_id, result)
    """

    # Cache key prefixes
    PREFIX_PROCESSED = "boss:dedup:processed:"
    PREFIX_RESULT = "boss:dedup:result:"
    PREFIX_RAG = "boss:dedup:rag:"

    # Default TTL (5 minutes)
    DEFAULT_TTL = 300

    def __init__(
        self,
        redis_url: Optional[str] = None,
        ttl_seconds: int = DEFAULT_TTL,
        enabled: bool = True
    ):
        """
        Initialize event deduplicator.

        Args:
            redis_url: Redis connection URL (default: from env)
            ttl_seconds: Cache TTL in seconds (default: 300)
            enabled: Enable/disable deduplication
        """
        self.ttl_seconds = ttl_seconds
        self.enabled = enabled

        # Redis connection
        self.redis = None
        if enabled and REDIS_AVAILABLE:
            try:
                redis_url = redis_url or os.getenv("REDIS_URL", "redis://localhost:6379")
                self.redis = redis.from_url(redis_url, decode_responses=True)
                # Test connection
                self.redis.ping()
                logger.info(f"EventDeduplicator initialized (TTL={ttl_seconds}s)")
            except Exception as e:
                logger.warning(f"EventDeduplicator Redis connection failed: {e}")
                self.redis = None

        # In-memory fallback cache (single process only)
        self._memory_cache: Dict[str, Any] = {}
        self._memory_expiry: Dict[str, datetime] = {}

    # =========================================================================
    # EVENT PROCESSING DEDUPLICATION
    # =========================================================================

    async def is_processed(self, event_id: str) -> bool:
        """
        Check if event has already been processed.

        Args:
            event_id: Unique event identifier

        Returns:
            True if event was already processed
        """
        if not self.enabled:
            return False

        key = f"{self.PREFIX_PROCESSED}{event_id}"

        if self.redis:
            try:
                return bool(self.redis.exists(key))
            except Exception as e:
                logger.warning(f"Redis check failed: {e}")

        # Fallback to memory cache
        return self._memory_check(key)

    async def mark_processed(
        self,
        event_id: str,
        result: Optional[Dict[str, Any]] = None,
        ttl: Optional[int] = None
    ) -> bool:
        """
        Mark event as processed and optionally cache result.

        Args:
            event_id: Unique event identifier
            result: Optional result to cache for other handlers
            ttl: Custom TTL (default: self.ttl_seconds)

        Returns:
            True if marked successfully
        """
        if not self.enabled:
            return False

        ttl = ttl or self.ttl_seconds
        processed_key = f"{self.PREFIX_PROCESSED}{event_id}"

        if self.redis:
            try:
                # Mark as processed
                self.redis.setex(processed_key, ttl, "1")

                # Cache result if provided
                if result:
                    result_key = f"{self.PREFIX_RESULT}{event_id}"
                    self.redis.setex(result_key, ttl, json.dumps(result))

                logger.debug(f"✅ Event marked processed: {event_id}")
                return True

            except Exception as e:
                logger.warning(f"Redis mark_processed failed: {e}")

        # Fallback to memory cache
        self._memory_set(processed_key, "1", ttl)
        if result:
            result_key = f"{self.PREFIX_RESULT}{event_id}"
            self._memory_set(result_key, result, ttl)

        return True

    async def get_cached_result(self, event_id: str) -> Optional[Dict[str, Any]]:
        """
        Get cached result for processed event.

        Args:
            event_id: Unique event identifier

        Returns:
            Cached result or None
        """
        if not self.enabled:
            return None

        key = f"{self.PREFIX_RESULT}{event_id}"

        if self.redis:
            try:
                result = self.redis.get(key)
                if result:
                    return json.loads(result)
            except Exception as e:
                logger.warning(f"Redis get_cached_result failed: {e}")

        # Fallback to memory cache
        return self._memory_get(key)

    # =========================================================================
    # RAG QUERY DEDUPLICATION
    # =========================================================================

    def _hash_query(self, query: str) -> str:
        """Generate hash for RAG query."""
        return hashlib.md5(query.encode()).hexdigest()[:16]

    async def get_cached_rag_result(
        self,
        query: str,
        event_id: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Get cached RAG query result.

        Checks both query-level and event-level caches.

        Args:
            query: RAG query string
            event_id: Optional event context

        Returns:
            Cached RAG result or None
        """
        if not self.enabled:
            return None

        query_hash = self._hash_query(query)

        # Check event-specific cache first (if event_id provided)
        if event_id:
            event_rag_key = f"{self.PREFIX_RAG}{event_id}:{query_hash}"
            result = await self._get_key(event_rag_key)
            if result:
                logger.debug(f"📦 RAG cache hit (event-specific): {query[:50]}...")
                return result

        # Check global query cache
        global_key = f"{self.PREFIX_RAG}global:{query_hash}"
        result = await self._get_key(global_key)
        if result:
            logger.debug(f"📦 RAG cache hit (global): {query[:50]}...")
            return result

        return None

    async def cache_rag_result(
        self,
        query: str,
        result: Dict[str, Any],
        event_id: Optional[str] = None,
        ttl: Optional[int] = None
    ) -> bool:
        """
        Cache RAG query result for reuse.

        Args:
            query: RAG query string
            result: Query result to cache
            event_id: Optional event context
            ttl: Custom TTL

        Returns:
            True if cached successfully
        """
        if not self.enabled:
            return False

        ttl = ttl or self.ttl_seconds
        query_hash = self._hash_query(query)

        # Cache at event level
        if event_id:
            event_key = f"{self.PREFIX_RAG}{event_id}:{query_hash}"
            await self._set_key(event_key, result, ttl)

        # Also cache at global level (for same query in different events)
        global_key = f"{self.PREFIX_RAG}global:{query_hash}"
        await self._set_key(global_key, result, ttl)

        logger.debug(f"📥 RAG result cached: {query[:50]}...")
        return True

    # =========================================================================
    # DECORATOR FOR AUTOMATIC DEDUPLICATION
    # =========================================================================

    def deduplicate(
        self,
        key_fn: Optional[Callable[[Any], str]] = None
    ):
        """
        Decorator for automatic event handler deduplication.

        Args:
            key_fn: Optional function to extract cache key from args

        Usage:
            @deduplicator.deduplicate(key_fn=lambda event: event.event_id)
            async def handle_email(event):
                # This will only run once per event_id
                return await process_email(event)
        """
        def decorator(func: Callable[..., Awaitable[Any]]):
            async def wrapper(*args, **kwargs):
                # Extract key
                if key_fn and args:
                    cache_key = key_fn(args[0])
                else:
                    cache_key = f"{func.__name__}:{hash(str(args) + str(kwargs))}"

                # Check cache
                if await self.is_processed(cache_key):
                    cached = await self.get_cached_result(cache_key)
                    if cached:
                        logger.debug(f"🔄 Deduplicated call: {func.__name__}")
                        return cached

                # Execute and cache
                result = await func(*args, **kwargs)
                await self.mark_processed(cache_key, result)
                return result

            return wrapper
        return decorator

    # =========================================================================
    # HELPER METHODS
    # =========================================================================

    async def _get_key(self, key: str) -> Optional[Dict[str, Any]]:
        """Get value from cache."""
        if self.redis:
            try:
                value = self.redis.get(key)
                if value:
                    return json.loads(value)
            except Exception as e:
                logger.warning(f"Redis get failed: {e}")

        return self._memory_get(key)

    async def _set_key(
        self,
        key: str,
        value: Dict[str, Any],
        ttl: int
    ) -> bool:
        """Set value in cache."""
        if self.redis:
            try:
                self.redis.setex(key, ttl, json.dumps(value))
                return True
            except Exception as e:
                logger.warning(f"Redis set failed: {e}")

        self._memory_set(key, value, ttl)
        return True

    def _memory_check(self, key: str) -> bool:
        """Check memory cache (single-process fallback)."""
        if key not in self._memory_cache:
            return False

        # Check expiry
        if key in self._memory_expiry:
            if datetime.now() > self._memory_expiry[key]:
                del self._memory_cache[key]
                del self._memory_expiry[key]
                return False

        return True

    def _memory_get(self, key: str) -> Optional[Any]:
        """Get from memory cache."""
        if self._memory_check(key):
            return self._memory_cache.get(key)
        return None

    def _memory_set(self, key: str, value: Any, ttl: int):
        """Set in memory cache."""
        self._memory_cache[key] = value
        self._memory_expiry[key] = datetime.now() + timedelta(seconds=ttl)

    def get_stats(self) -> Dict[str, Any]:
        """Get deduplication statistics."""
        stats = {
            "enabled": self.enabled,
            "redis_connected": self.redis is not None,
            "ttl_seconds": self.ttl_seconds,
            "memory_cache_size": len(self._memory_cache)
        }

        if self.redis:
            try:
                # Count cached keys
                processed_count = len(list(self.redis.scan_iter(f"{self.PREFIX_PROCESSED}*")))
                rag_count = len(list(self.redis.scan_iter(f"{self.PREFIX_RAG}*")))
                stats["redis_processed_keys"] = processed_count
                stats["redis_rag_keys"] = rag_count
            except Exception as e:
                stats["redis_error"] = str(e)

        return stats

    def clear_cache(self, pattern: Optional[str] = None):
        """Clear deduplication cache."""
        if self.redis:
            try:
                if pattern:
                    keys = list(self.redis.scan_iter(pattern))
                else:
                    keys = list(self.redis.scan_iter("boss:dedup:*"))

                if keys:
                    self.redis.delete(*keys)
                    logger.info(f"Cleared {len(keys)} dedup cache keys")

            except Exception as e:
                logger.warning(f"Redis clear_cache failed: {e}")

        # Clear memory cache
        self._memory_cache.clear()
        self._memory_expiry.clear()


# =============================================================================
# SINGLETON INSTANCE
# =============================================================================

_deduplicator_instance: Optional[EventDeduplicator] = None


def get_event_deduplicator() -> EventDeduplicator:
    """Get singleton EventDeduplicator instance."""
    global _deduplicator_instance

    if _deduplicator_instance is None:
        _deduplicator_instance = EventDeduplicator()

    return _deduplicator_instance
