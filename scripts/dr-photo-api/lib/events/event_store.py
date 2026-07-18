"""
BOSS Event Store Service

Purpose: Persist all events from Redis Streams to PostgreSQL for audit trail
Authority: Phase 7 - Integration Testing & Event Store
Created: 2025-11-19
Updated: 2025-12-02 (Connection pooling integration)

Features:
- Log all events to PostgreSQL event_store schema
- Track hook execution (start, complete, duration, errors)
- Dead letter queue for failed events
- Event replay from database
- Audit trail and compliance
- Analytics and reporting

Usage:
    >>> from lib.events.event_store import EventStoreService
    >>> event_store = EventStoreService()
    >>> await event_store.log_event(event)
"""

import psycopg2
import psycopg2.extras
from datetime import datetime
from typing import Optional, List, Dict, Any
from loguru import logger
import json
import os
from dotenv import load_dotenv

load_dotenv()

# Connection pool integration
try:
    from lib.db import get_connection as get_pooled_connection
    POOL_AVAILABLE = True
except ImportError:
    POOL_AVAILABLE = False
    logger.debug("Connection pool not available, using direct connections")

from lib.events.event_schema import Event


class EventStoreService:
    """
    PostgreSQL-based event store for BOSS.

    Responsibilities:
    - Persist events to event_store.events table
    - Log hook execution to event_store.event_processing_log
    - Track failed events in event_store.failed_events
    - Provide event replay and analytics queries

    Example:
        >>> event_store = EventStoreService()
        >>> await event_store.log_event(event)
        >>> await event_store.log_hook_execution(
        ...     event_id="evt_123",
        ...     hook_name="on_email_received",
        ...     status="success",
        ...     duration_ms=150
        ... )
    """

    def __init__(self, use_pool: bool = True):
        """Initialize Event Store Service with PostgreSQL connection."""
        self.host = os.getenv("POSTGRES_HOST", "localhost")
        self.port = int(os.getenv("POSTGRES_PORT", 5432))
        self.database = os.getenv("POSTGRES_DB", "boss_production")
        self.user = os.getenv("POSTGRES_USER", "boss_admin")
        self.password = os.getenv("POSTGRES_PASSWORD")
        self.use_pool = use_pool and POOL_AVAILABLE

        if not self.password and not self.use_pool:
            raise ValueError("POSTGRES_PASSWORD not found in environment")

        self.conn = None
        self._pool_context = None

        logger.info(
            f"EventStoreService initialized "
            f"(host={self.host}, database={self.database}, pool={self.use_pool})"
        )

    def _get_connection(self):
        """
        Get PostgreSQL connection (from pool or create new).

        Returns:
            psycopg2 connection object
        """
        if self.use_pool:
            # Use connection pool
            if self._pool_context is None:
                self._pool_context = get_pooled_connection()
                self.conn = self._pool_context.__enter__()
                logger.debug("Got connection from pool")
            return self.conn
        else:
            # Direct connection (fallback)
            if self.conn is None or self.conn.closed:
                try:
                    self.conn = psycopg2.connect(
                        host=self.host,
                        port=self.port,
                        database=self.database,
                        user=self.user,
                        password=self.password
                    )
                    logger.debug("PostgreSQL connection established (direct)")
                except Exception as e:
                    logger.error(f"Failed to connect to PostgreSQL: {e}")
                    raise

            return self.conn

    def _return_connection(self):
        """Return connection to pool (if using pool)."""
        if self.use_pool and self._pool_context:
            self._pool_context.__exit__(None, None, None)
            self._pool_context = None
            self.conn = None
            logger.debug("Returned connection to pool")

    def close(self):
        """Close PostgreSQL connection."""
        if self.use_pool and self._pool_context:
            self._return_connection()
        elif self.conn and not self.conn.closed:
            self.conn.close()
            logger.debug("PostgreSQL connection closed")

    def log_event(self, event: Event) -> bool:
        """
        Log event to PostgreSQL event_store.events table.

        Args:
            event: Event object to persist

        Returns:
            True if successful, False otherwise

        Example:
            >>> event = Event(
            ...     event_type=EventType.EMAIL_RECEIVED,
            ...     source="email_agent",
            ...     data={"sender": "john@example.com"}
            ... )
            >>> event_store.log_event(event)
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # Insert event
            cursor.execute(
                """
                INSERT INTO event_store.events (
                    event_id,
                    event_type,
                    source,
                    timestamp,
                    data,
                    metadata,
                    correlation_id,
                    version
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (event_id) DO NOTHING
                """,
                (
                    event.event_id,
                    event.event_type.value,  # Convert enum to string
                    event.source,
                    event.timestamp,
                    json.dumps(event.data),  # JSONB
                    json.dumps(event.metadata or {}),  # JSONB
                    event.correlation_id,
                    event.version
                )
            )

            conn.commit()
            cursor.close()

            logger.debug(
                f"Event logged to PostgreSQL: {event.event_id} "
                f"({event.event_type.value})"
            )

            return True

        except Exception as e:
            logger.error(f"Failed to log event to PostgreSQL: {e}", exc_info=True)
            if self.conn:
                self.conn.rollback()
            return False

    def log_hook_execution(
        self,
        event_id: str,
        hook_name: str,
        handler_function: Optional[str] = None,
        status: str = "success",
        error_message: Optional[str] = None,
        error_traceback: Optional[str] = None,
        duration_ms: Optional[int] = None,
        consumer_group: Optional[str] = None,
        consumer_name: Optional[str] = None
    ) -> bool:
        """
        Log hook execution to event_store.event_processing_log.

        Args:
            event_id: Event ID that was processed
            hook_name: Hook name (e.g., "on_email_received")
            handler_function: Handler function name
            status: Execution status (success, failed, timeout)
            error_message: Error message if failed
            error_traceback: Full stack trace if failed
            duration_ms: Execution time in milliseconds
            consumer_group: Consumer group name
            consumer_name: Consumer name

        Returns:
            True if successful, False otherwise
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # Calculate completed_at if duration provided
            completed_at = None
            if duration_ms is not None:
                completed_at = datetime.now()

            cursor.execute(
                """
                INSERT INTO event_store.event_processing_log (
                    event_id,
                    hook_name,
                    handler_function,
                    status,
                    error_message,
                    error_traceback,
                    duration_ms,
                    completed_at,
                    consumer_group,
                    consumer_name
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    event_id,
                    hook_name,
                    handler_function,
                    status,
                    error_message,
                    error_traceback,
                    duration_ms,
                    completed_at,
                    consumer_group,
                    consumer_name
                )
            )

            conn.commit()
            cursor.close()

            logger.debug(
                f"Hook execution logged: {hook_name} for {event_id} "
                f"(status={status}, duration={duration_ms}ms)"
            )

            return True

        except Exception as e:
            logger.error(f"Failed to log hook execution: {e}", exc_info=True)
            if self.conn:
                self.conn.rollback()
            return False

    def log_failed_event(
        self,
        event_id: str,
        hook_name: str,
        error_message: str,
        error_traceback: Optional[str] = None,
        max_retries: int = 3
    ) -> bool:
        """
        Log failed event to dead letter queue.

        Args:
            event_id: Event ID that failed
            hook_name: Hook that failed to process
            error_message: Error message
            error_traceback: Full stack trace
            max_retries: Maximum retry attempts

        Returns:
            True if successful, False otherwise
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute(
                """
                INSERT INTO event_store.failed_events (
                    event_id,
                    hook_name,
                    error_message,
                    error_traceback,
                    max_retries
                ) VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    event_id,
                    hook_name,
                    error_message,
                    error_traceback,
                    max_retries
                )
            )

            conn.commit()
            cursor.close()

            logger.warning(
                f"Failed event logged to DLQ: {event_id} "
                f"(hook={hook_name})"
            )

            return True

        except Exception as e:
            logger.error(f"Failed to log failed event: {e}", exc_info=True)
            if self.conn:
                self.conn.rollback()
            return False

    def get_events_by_type(
        self,
        event_type: str,
        limit: int = 100,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """
        Get events by type (for analytics/reporting).

        Args:
            event_type: Event type to filter by
            limit: Maximum number of results
            offset: Offset for pagination

        Returns:
            List of event dicts
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            cursor.execute(
                """
                SELECT *
                FROM event_store.events
                WHERE event_type = %s
                ORDER BY timestamp DESC
                LIMIT %s OFFSET %s
                """,
                (event_type, limit, offset)
            )

            events = cursor.fetchall()
            cursor.close()

            return [dict(event) for event in events]

        except Exception as e:
            logger.error(f"Failed to get events by type: {e}")
            return []

    def get_workflow_events(self, correlation_id: str) -> List[Dict[str, Any]]:
        """
        Get all events for a workflow (by correlation ID).

        Args:
            correlation_id: Correlation ID to trace

        Returns:
            List of event dicts in chronological order
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            cursor.execute(
                "SELECT * FROM event_store.get_workflow_events(%s)",
                (correlation_id,)
            )

            events = cursor.fetchall()
            cursor.close()

            return [dict(event) for event in events]

        except Exception as e:
            logger.error(f"Failed to get workflow events: {e}")
            return []

    def get_event_processing_history(self, event_id: str) -> List[Dict[str, Any]]:
        """
        Get processing history for an event.

        Args:
            event_id: Event ID to look up

        Returns:
            List of processing log entries
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            cursor.execute(
                "SELECT * FROM event_store.get_event_processing_history(%s)",
                (event_id,)
            )

            history = cursor.fetchall()
            cursor.close()

            return [dict(entry) for entry in history]

        except Exception as e:
            logger.error(f"Failed to get event processing history: {e}")
            return []

    def get_retryable_failed_events(self) -> List[Dict[str, Any]]:
        """
        Get failed events ready for retry.

        Returns:
            List of failed event dicts
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            cursor.execute(
                "SELECT * FROM event_store.get_retryable_failed_events()"
            )

            failed_events = cursor.fetchall()
            cursor.close()

            return [dict(event) for event in failed_events]

        except Exception as e:
            logger.error(f"Failed to get retryable failed events: {e}")
            return []

    def mark_failed_event_resolved(
        self,
        event_id: str,
        hook_name: str,
        resolution_notes: Optional[str] = None
    ) -> bool:
        """
        Mark failed event as resolved.

        Args:
            event_id: Event ID
            hook_name: Hook name
            resolution_notes: Optional notes about resolution

        Returns:
            True if successful
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute(
                """
                UPDATE event_store.failed_events
                SET resolved = TRUE,
                    resolved_at = NOW(),
                    resolution_notes = %s
                WHERE event_id = %s AND hook_name = %s
                """,
                (resolution_notes, event_id, hook_name)
            )

            conn.commit()
            cursor.close()

            logger.info(
                f"Marked failed event as resolved: {event_id} (hook={hook_name})"
            )

            return True

        except Exception as e:
            logger.error(f"Failed to mark event as resolved: {e}")
            if self.conn:
                self.conn.rollback()
            return False

    def get_stats(self) -> Dict[str, Any]:
        """
        Get event store statistics.

        Returns:
            Stats dict with counts and metrics
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            # Total events
            cursor.execute("SELECT COUNT(*) as total FROM event_store.events")
            total_events = cursor.fetchone()["total"]

            # Events by type (top 10)
            cursor.execute(
                """
                SELECT event_type, COUNT(*) as count
                FROM event_store.events
                GROUP BY event_type
                ORDER BY count DESC
                LIMIT 10
                """
            )
            events_by_type = [dict(row) for row in cursor.fetchall()]

            # Processing stats
            cursor.execute(
                """
                SELECT
                    COUNT(*) as total_executions,
                    COUNT(*) FILTER (WHERE status = 'success') as successes,
                    COUNT(*) FILTER (WHERE status = 'failed') as failures,
                    AVG(duration_ms) as avg_duration_ms
                FROM event_store.event_processing_log
                """
            )
            processing_stats = dict(cursor.fetchone())

            # Failed events
            cursor.execute(
                "SELECT COUNT(*) as total FROM event_store.failed_events WHERE resolved = FALSE"
            )
            unresolved_failures = cursor.fetchone()["total"]

            cursor.close()

            return {
                "total_events": total_events,
                "events_by_type": events_by_type,
                "processing_stats": processing_stats,
                "unresolved_failures": unresolved_failures
            }

        except Exception as e:
            logger.error(f"Failed to get event store stats: {e}")
            return {}


# Singleton instance
_event_store_instance: Optional[EventStoreService] = None


def get_event_store() -> EventStoreService:
    """
    Get singleton Event Store instance.

    Returns:
        EventStoreService instance
    """
    global _event_store_instance

    if _event_store_instance is None:
        _event_store_instance = EventStoreService()

    return _event_store_instance
