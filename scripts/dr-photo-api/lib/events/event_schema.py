"""
BOSS Event Schema & Types

Purpose: Define all event types and standardized event structure for the event bus.
Authority: Phase 6 - Hook System & Automation
Created: 2025-11-15

Event-Driven Architecture:
- Redis Streams as event bus
- Pydantic models for validation
- Standardized event structure across all agents
- Correlation IDs for workflow tracing
"""

from enum import Enum
from pydantic import BaseModel, Field
from datetime import datetime
from typing import Dict, Any, Optional
from uuid import uuid4


class EventType(Enum):
    """
    Event types in BOSS system.

    Naming Convention: {domain}.{action}
    - email.received, email.sent, email.draft_created
    - whatsapp.message.received, whatsapp.message.sent
    - file.created, file.modified, file.deleted
    - schedule.task
    - batch.ingestion.complete
    - agent.error, agent.started, agent.completed
    - cost.threshold.exceeded
    - draft.created, draft.approved, draft.rejected
    """

    # Email Events
    EMAIL_RECEIVED = "email.received"
    EMAIL_SENT = "email.sent"
    EMAIL_DRAFT_CREATED = "email.draft.created"
    EMAIL_CLASSIFIED = "email.classified"

    # WhatsApp Events
    WHATSAPP_MESSAGE_RECEIVED = "whatsapp.message.received"
    WHATSAPP_MESSAGE_SENT = "whatsapp.message.sent"
    WHATSAPP_DRAFT_CREATED = "whatsapp.draft.created"

    # File System Events
    FILE_CREATED = "file.created"
    FILE_MODIFIED = "file.modified"
    FILE_DELETED = "file.deleted"
    FILE_MOVED = "file.moved"

    # Scheduled Events
    SCHEDULED_TASK = "schedule.task"

    # Batch Processing Events
    BATCH_INGESTION_STARTED = "batch.ingestion.started"
    BATCH_INGESTION_COMPLETE = "batch.ingestion.complete"
    BATCH_INGESTION_FAILED = "batch.ingestion.failed"

    # Agent Events
    AGENT_STARTED = "agent.started"
    AGENT_COMPLETED = "agent.completed"
    AGENT_ERROR = "agent.error"
    AGENT_REGISTERED = "agent.registered"
    AGENT_UNREGISTERED = "agent.unregistered"
    AGENT_PAUSED = "agent.paused"
    AGENT_RESUMED = "agent.resumed"

    # Task Events
    TASK_DELEGATED = "task.delegated"
    TASK_COMPLETED = "task.completed"
    TASK_FAILED = "task.failed"
    TASK_RETRYING = "task.retrying"

    # Cost & Budget Events
    COST_THRESHOLD_EXCEEDED = "cost.threshold.exceeded"
    COST_DAILY_SUMMARY = "cost.daily.summary"

    # Approval Workflow Events
    DRAFT_CREATED = "draft.created"
    DRAFT_APPROVED = "draft.approved"
    DRAFT_REJECTED = "draft.rejected"

    # Memory Graph Events
    ENTITY_CREATED = "memory.entity.created"
    ENTITY_UPDATED = "memory.entity.updated"
    RELATIONSHIP_CREATED = "memory.relationship.created"

    # Application Lifecycle Events
    APPLICATION_STARTUP = "application.startup"
    APPLICATION_SHUTDOWN = "application.shutdown"

    # Scheduled Task Completion (for completion events)
    SCHEDULED_TASK_COMPLETE = "schedule.task.complete"


class Event(BaseModel):
    """
    Standard event structure for BOSS event bus.

    All events published to Redis Streams must use this format.

    Attributes:
        event_id: Unique event identifier
        event_type: Type of event (from EventType enum)
        timestamp: When event was created (ISO 8601)
        source: Agent/service that emitted the event
        data: Event payload (arbitrary JSON data)
        metadata: Optional metadata (tags, versions, etc.)
        correlation_id: For tracing multi-event workflows
        version: Event schema version (for evolution)

    Example:
        >>> event = Event(
        ...     event_type=EventType.EMAIL_RECEIVED,
        ...     source="email_agent",
        ...     data={
        ...         "sender": "john@example.com",
        ...         "subject": "Q4 Financials",
        ...         "body": "..."
        ...     }
        ... )
        >>> event.event_id
        'evt_20251115143022123456'
    """

    event_id: str = Field(
        default_factory=lambda: f"evt_{datetime.now().strftime('%Y%m%d%H%M%S')}{str(uuid4())[:8]}",
        description="Unique event identifier"
    )

    event_type: EventType = Field(
        ...,
        description="Type of event (from EventType enum)"
    )

    timestamp: datetime = Field(
        default_factory=datetime.now,
        description="Event creation timestamp (UTC)"
    )

    source: str = Field(
        ...,
        description="Agent/service that emitted this event"
    )

    data: Dict[str, Any] = Field(
        ...,
        description="Event payload (arbitrary JSON data)"
    )

    metadata: Optional[Dict[str, Any]] = Field(
        default_factory=dict,
        description="Optional metadata (tags, versions, etc.)"
    )

    correlation_id: Optional[str] = Field(
        default=None,
        description="For tracing multi-event workflows"
    )

    version: str = Field(
        default="1.0",
        description="Event schema version"
    )

    class Config:
        """Pydantic configuration."""
        # DON'T use use_enum_values - it converts enums to strings immediately
        # We want to keep the enum type internally and only serialize to string for Redis
        json_encoders = {
            datetime: lambda dt: dt.isoformat()
        }

    def to_redis_dict(self) -> Dict[str, str]:
        """
        Convert event to Redis Streams format (string key-value pairs).

        Redis Streams requires all values to be strings, so we serialize
        complex types to JSON.

        Returns:
            Dictionary with string keys and values ready for XADD
        """
        import json

        return {
            "event_id": self.event_id,
            "event_type": self.event_type.value if isinstance(self.event_type, EventType) else self.event_type,
            "timestamp": self.timestamp.isoformat(),
            "source": self.source,
            "data": json.dumps(self.data),
            "metadata": json.dumps(self.metadata or {}),
            "correlation_id": self.correlation_id or "",
            "version": self.version
        }

    @classmethod
    def from_redis_dict(cls, redis_data: Dict[str, str]) -> "Event":
        """
        Reconstruct Event from Redis Streams data.

        Args:
            redis_data: Dictionary from XREADGROUP with string values

        Returns:
            Event object
        """
        import json

        # Find EventType enum by value (event_type is stored as string in Redis)
        event_type_value = redis_data["event_type"]
        event_type = None
        for et in EventType:
            if et.value == event_type_value:
                event_type = et
                break

        if event_type is None:
            raise ValueError(f"Unknown event type: {event_type_value}")

        return cls(
            event_id=redis_data["event_id"],
            event_type=event_type,  # Pydantic will keep this as EventType enum now
            timestamp=datetime.fromisoformat(redis_data["timestamp"]),
            source=redis_data["source"],
            data=json.loads(redis_data["data"]),
            metadata=json.loads(redis_data["metadata"]) if redis_data.get("metadata") else {},
            correlation_id=redis_data.get("correlation_id") or None,
            version=redis_data.get("version", "1.0")
        )


def create_correlation_id() -> str:
    """
    Generate a unique correlation ID for workflow tracing.

    Correlation IDs link related events across a multi-step workflow.

    Returns:
        Correlation ID in format: corr_{timestamp}_{uuid}

    Example:
        >>> corr_id = create_correlation_id()
        >>> event1 = Event(..., correlation_id=corr_id)
        >>> event2 = Event(..., correlation_id=corr_id)  # Same workflow
    """
    return f"corr_{datetime.now().strftime('%Y%m%d%H%M%S')}{str(uuid4())[:8]}"
