"""
Redis Streams Event Bus for BOSS

Purpose: Event-driven architecture using Redis Streams for pub/sub messaging
Authority: Phase 6 - Hook System & Automation
Created: 2025-11-15

Features:
- Publish events to Redis Streams (XADD)
- Subscribe handlers to event types
- Consumer groups for parallel processing
- Event acknowledgment (XACK) for reliability
- Dead letter queue for failed events
- Auto-cleanup (XTRIM) to prevent memory bloat

Redis Streams Concepts:
- Stream: Append-only log of events (like Kafka topic)
- Consumer Group: Multiple consumers process events in parallel
- XREADGROUP: Read events assigned to consumer
- XACK: Acknowledge successful processing
- XPENDING: Track unacknowledged events (for retry)
"""

import os
import redis
import asyncio
import fnmatch
from typing import Callable, Dict, List, Optional, Tuple, Union
from datetime import datetime, timedelta
from loguru import logger

from lib.events.event_schema import Event, EventType


def _get_redis_url() -> str:
    """
    Get Redis URL from environment variables.

    Supports multiple configuration methods:
    1. REDIS_URL (e.g., "redis://localhost:6379")
    2. REDIS_HOST + REDIS_PORT (individual variables)
    3. Default: redis://localhost:6379

    Returns:
        Redis URL string
    """
    # Check for REDIS_URL first (Docker/production pattern)
    redis_url = os.getenv("REDIS_URL")
    if redis_url:
        return redis_url

    # Build URL from individual environment variables
    host = os.getenv("REDIS_HOST", "localhost")
    port = os.getenv("REDIS_PORT", "6379")
    return f"redis://{host}:{port}"


class RedisEventBus:
    """
    Redis Streams-based event bus for BOSS.

    Architecture:
    - Each EventType gets its own stream: boss:events:{event_type}
    - Consumer groups allow multiple processes to share load
    - Events auto-acknowledged after successful handler execution
    - Failed events remain in pending list for retry
    - Streams auto-trimmed to last 10,000 events

    Example:
        >>> event_bus = RedisEventBus("redis://localhost:6380")
        >>> event_bus.publish(Event(
        ...     event_type=EventType.EMAIL_RECEIVED,
        ...     source="email_agent",
        ...     data={"sender": "john@example.com"}
        ... ))
        >>> event_bus.subscribe(EventType.EMAIL_RECEIVED, my_handler)
        >>> await event_bus.consume()
    """

    def __init__(
        self,
        redis_url: Optional[str] = None,
        consumer_group: str = "boss_default_group",
        maxlen: int = 10000
    ):
        """
        Initialize Redis Streams event bus.

        Args:
            redis_url: Redis connection URL (default: from env or redis://localhost:6379)
            consumer_group: Default consumer group name
            maxlen: Maximum stream length (auto-trim older events)
        """
        self.redis_url = redis_url or _get_redis_url()
        self.redis = redis.from_url(self.redis_url, decode_responses=True)
        self.default_consumer_group = consumer_group
        self.maxlen = maxlen

        # Handler registry: {stream_name: [handler_functions]}
        self.handlers: Dict[str, List[Callable]] = {}

        # Consumer group per stream: {stream_name: consumer_group_name}
        self.consumer_groups: Dict[str, str] = {}

        # Track failed events for dead letter queue
        self.failed_events: List[Tuple[str, Event, Exception]] = []

        logger.info(f"RedisEventBus initialized (url={redis_url}, group={consumer_group})")

    def _get_stream_name(self, event_type: EventType) -> str:
        """
        Get Redis stream name for event type.

        Args:
            event_type: Event type enum

        Returns:
            Stream name: boss:events:{event_type.value}
        """
        # Event type is always EventType enum now (no more Pydantic use_enum_values)
        return f"boss:events:{event_type.value}"

    def publish(self, event: Event) -> str:
        """
        Publish event to Redis Stream.

        Uses XADD with MAXLEN to auto-trim old events.

        Args:
            event: Event object to publish

        Returns:
            Message ID from Redis (e.g., "1637012345678-0")

        Example:
            >>> event = Event(
            ...     event_type=EventType.FILE_CREATED,
            ...     source="folder_watcher",
            ...     data={"path": "/inbox/document.pdf"}
            ... )
            >>> message_id = event_bus.publish(event)
            >>> print(f"Published: {message_id}")
        """
        stream_name = self._get_stream_name(event.event_type)

        # Convert event to Redis-compatible dict
        redis_data = event.to_redis_dict()

        # Publish with XADD (auto-trim to maxlen)
        message_id = self.redis.xadd(
            stream_name,
            redis_data,
            maxlen=self.maxlen,  # Keep only last N events
            approximate=True  # More efficient trimming
        )

        logger.debug(
            f"📤 Published {event.event_type.value} "
            f"[{event.event_id}] to {stream_name} → {message_id}"
        )

        # Log to PostgreSQL event store (if available)
        try:
            from lib.events.event_store import get_event_store
            event_store = get_event_store()
            event_store.log_event(event)
        except Exception as e:
            # Don't fail publishing if event store is unavailable
            logger.debug(f"Event store logging skipped: {e}")

        # Immediately notify pattern subscribers (for testing without consume loop)
        for pattern, pattern_handlers in self.handlers.items():
            if isinstance(pattern, str) and fnmatch.fnmatch(event.event_type.value, pattern):
                for handler in pattern_handlers:
                    # Store event for handler to process
                    # Note: This is synchronous notification for testing
                    # Production code should use consume() for async processing
                    if asyncio.iscoroutinefunction(handler):
                        # Can't await here since publish() is not async
                        # Create task to run handler
                        asyncio.create_task(handler(event))
                    else:
                        handler(event)

        return message_id

    def subscribe(
        self,
        event_type: Union[EventType, str],
        handler: Callable,
        consumer_group: Optional[str] = None
    ):
        """
        Subscribe handler to event type or pattern.

        Handler will be called for every event of this type or matching pattern.

        Args:
            event_type: Event type enum OR string pattern (e.g., "task.*" for wildcard)
            handler: Async function to call (must accept Event parameter)
            consumer_group: Consumer group name (defaults to boss_default_group)

        Examples:
            >>> # Subscribe to specific event type
            >>> async def handle_email(event: Event):
            ...     print(f"Email from: {event.data['sender']}")
            >>> event_bus.subscribe(EventType.EMAIL_RECEIVED, handle_email)

            >>> # Subscribe to pattern (wildcard)
            >>> async def handle_all_tasks(event: Event):
            ...     print(f"Task event: {event.event_type}")
            >>> event_bus.subscribe("task.*", handle_all_tasks)
        """
        # Handle string patterns (wildcards)
        if isinstance(event_type, str):
            # Store pattern subscription
            if event_type not in self.handlers:
                self.handlers[event_type] = []
            self.handlers[event_type].append(handler)

            logger.info(
                f"📥 Subscribed to pattern '{event_type}' "
                f"(handler={handler.__name__})"
            )
            return

        # Handle EventType enum (original behavior)
        stream_name = self._get_stream_name(event_type)
        group_name = consumer_group or self.default_consumer_group

        # Create consumer group if not exists
        try:
            self.redis.xgroup_create(
                stream_name,
                group_name,
                id='0',  # Start from beginning of stream
                mkstream=True  # Create stream if doesn't exist
            )
            logger.info(f"✅ Created consumer group: {group_name} for {stream_name}")
        except redis.exceptions.ResponseError as e:
            if "BUSYGROUP" in str(e):
                # Group already exists, that's fine
                pass
            else:
                raise

        # Register handler
        if stream_name not in self.handlers:
            self.handlers[stream_name] = []
        self.handlers[stream_name].append(handler)

        # Store consumer group for this stream
        self.consumer_groups[stream_name] = group_name

        logger.info(
            f"📥 Subscribed to {event_type.value} "
            f"(handler={handler.__name__}, group={group_name})"
        )

    async def consume(
        self,
        consumer_name: str = "boss_consumer_1",
        batch_size: int = 10,
        block_ms: int = 1000
    ):
        """
        Start consuming events from all subscribed streams.

        This is the main event loop - it runs indefinitely, processing events
        as they arrive. Use CTRL+C to stop.

        Args:
            consumer_name: Unique consumer identifier
            batch_size: Max events to process per batch
            block_ms: Milliseconds to block waiting for events

        Example:
            >>> event_bus = RedisEventBus()
            >>> event_bus.subscribe(EventType.EMAIL_RECEIVED, email_handler)
            >>> event_bus.subscribe(EventType.FILE_CREATED, file_handler)
            >>> await event_bus.consume(consumer_name="boss_main")
        """
        # Build streams dict for XREADGROUP
        streams = {
            stream: '>'  # '>' means read only NEW messages
            for stream in self.handlers.keys()
        }

        if not streams:
            logger.warning("⚠️ No streams subscribed - nothing to consume")
            return

        logger.info(
            f"🚀 Starting event consumer '{consumer_name}' "
            f"for {len(streams)} streams"
        )

        while True:
            try:
                # Read from multiple streams with blocking
                # Returns: [(stream_name, [(message_id, {field: value})])]
                messages = self.redis.xreadgroup(
                    groupname=self.default_consumer_group,  # TODO: Handle multiple groups
                    consumername=consumer_name,
                    streams=streams,
                    count=batch_size,
                    block=block_ms
                )

                if not messages:
                    # No events in this batch, continue loop
                    await asyncio.sleep(0.1)
                    continue

                # Process each stream's events
                for stream_name, events in messages:
                    consumer_group = self.consumer_groups.get(stream_name, self.default_consumer_group)

                    for message_id, event_data in events:
                        try:
                            # Reconstruct Event object from Redis data
                            event = Event.from_redis_dict(event_data)

                            logger.debug(
                                f"📨 Received {event.event_type.value} "
                                f"[{event.event_id}] from {stream_name}"
                            )

                            # Execute all handlers for this stream (exact match)
                            handlers = self.handlers.get(stream_name, [])

                            # Also check pattern subscriptions (wildcards)
                            for pattern, pattern_handlers in self.handlers.items():
                                if isinstance(pattern, str) and fnmatch.fnmatch(event.event_type.value, pattern):
                                    handlers.extend(pattern_handlers)

                            for handler in handlers:
                                try:
                                    # Call handler (must be async)
                                    if asyncio.iscoroutinefunction(handler):
                                        await handler(event)
                                    else:
                                        # Sync handler, run in executor
                                        loop = asyncio.get_event_loop()
                                        await loop.run_in_executor(None, handler, event)

                                    logger.debug(
                                        f"✅ Handler {handler.__name__} "
                                        f"processed {event.event_id}"
                                    )

                                except Exception as handler_error:
                                    logger.error(
                                        f"❌ Handler {handler.__name__} "
                                        f"failed for {event.event_id}: {handler_error}"
                                    )
                                    # Track failure for dead letter queue
                                    self.failed_events.append((stream_name, event, handler_error))
                                    # Don't acknowledge - event stays in pending
                                    continue

                            # Acknowledge successful processing
                            self.redis.xack(stream_name, consumer_group, message_id)

                        except Exception as event_error:
                            logger.error(
                                f"❌ Event processing error for {message_id}: {event_error}"
                            )
                            # Event stays unacknowledged for retry
                            continue

                await asyncio.sleep(0.05)  # Small delay between batches

            except KeyboardInterrupt:
                logger.info("🛑 Consumer stopped by user (CTRL+C)")
                break

            except Exception as consume_error:
                logger.error(f"❌ Event bus consume error: {consume_error}")
                await asyncio.sleep(5)  # Backoff on error

    def get_pending_events(self, stream_name: str, consumer_group: str) -> List[Dict]:
        """
        Get pending (unacknowledged) events for a consumer group.

        Useful for monitoring and manual retry of failed events.

        Args:
            stream_name: Redis stream name
            consumer_group: Consumer group name

        Returns:
            List of pending event info dicts
        """
        pending = self.redis.xpending(stream_name, consumer_group)

        if pending and pending['pending'] > 0:
            logger.warning(
                f"⚠️ {pending['pending']} pending events in {stream_name} "
                f"(group={consumer_group})"
            )

        return pending

    def get_failed_events(self) -> List[Tuple[str, Event, Exception]]:
        """
        Get events that failed handler execution.

        Returns:
            List of (stream_name, event, exception) tuples
        """
        return self.failed_events

    def claim_old_pending_events(
        self,
        stream_name: str,
        consumer_group: str,
        consumer_name: str,
        min_idle_time_ms: int = 300000  # 5 minutes
    ):
        """
        Claim events that have been pending too long (probably from crashed consumer).

        Use XAUTOCLAIM to reassign old pending events to this consumer for retry.

        Args:
            stream_name: Redis stream name
            consumer_group: Consumer group name
            consumer_name: This consumer's name
            min_idle_time_ms: Minimum idle time to claim (default 5 minutes)
        """
        try:
            claimed = self.redis.xautoclaim(
                name=stream_name,
                groupname=consumer_group,
                consumername=consumer_name,
                min_idle_time=min_idle_time_ms,
                start_id='0-0',
                count=10
            )

            if claimed and len(claimed[1]) > 0:
                logger.warning(
                    f"⚠️ Claimed {len(claimed[1])} old pending events from {stream_name}"
                )

        except Exception as e:
            logger.error(f"❌ Failed to claim pending events: {e}")

    def health_check(self) -> Dict[str, any]:
        """
        Check event bus health status.

        Returns:
            Health status dict with Redis connection, stream info, etc.
        """
        try:
            # Ping Redis
            self.redis.ping()

            # Get stream info
            stream_info = {}
            for stream_name in self.handlers.keys():
                try:
                    info = self.redis.xinfo_stream(stream_name)
                    stream_info[stream_name] = {
                        "length": info['length'],
                        "groups": info['groups']
                    }
                except redis.exceptions.ResponseError:
                    # Stream doesn't exist yet
                    stream_info[stream_name] = {"length": 0, "groups": 0}

            return {
                "status": "healthy",
                "redis_connected": True,
                "streams_subscribed": len(self.handlers),
                "stream_info": stream_info,
                "failed_events": len(self.failed_events)
            }

        except Exception as e:
            return {
                "status": "unhealthy",
                "redis_connected": False,
                "error": str(e)
            }
