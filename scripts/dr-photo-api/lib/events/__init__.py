"""
BOSS Event System

Event-driven architecture for autonomous agent coordination.

Components:
- event_schema: Event types and standardized Event model
- redis_event_bus: Redis Streams pub/sub implementation

Usage:
    >>> from lib.events import Event, EventType, RedisEventBus
    >>> event_bus = RedisEventBus()
    >>> event = Event(
    ...     event_type=EventType.EMAIL_RECEIVED,
    ...     source="email_agent",
    ...     data={"sender": "john@example.com"}
    ... )
    >>> event_bus.publish(event)
"""

from lib.events.event_schema import Event, EventType, create_correlation_id
from lib.events.redis_event_bus import RedisEventBus

__all__ = [
    "Event",
    "EventType",
    "RedisEventBus",
    "create_correlation_id"
]
