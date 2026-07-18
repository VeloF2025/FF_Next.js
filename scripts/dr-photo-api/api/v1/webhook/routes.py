"""
Webhook API Routes

Receives incoming webhooks from n8n triggers and publishes events
to the Redis Event Bus for async processing by hooks.

Endpoints:
- POST /webhook/email/received - Receive new email from n8n MS365/IMAP triggers

Architecture:
    n8n (MS365 Trigger or IMAP Poll)
        → HTTP POST /api/v1/webhook/email/received
        → Redis Event Bus (EMAIL_RECEIVED)
        → on_email_received hook
        → Classification, Enrichment, Draft Generation

Author: BOSS Development Team
Created: 2025-11-30
"""

import logging
from typing import Optional, List
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends, status, Request, BackgroundTasks
from pydantic import BaseModel, Field

from api.auth import verify_api_key
from api.rate_limiting import limiter
from lib.events.event_schema import Event, EventType, create_correlation_id
from lib.events.redis_event_bus import RedisEventBus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhook", tags=["Webhooks"])


# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================

class EmailWebhookPayload(BaseModel):
    """
    Payload structure for incoming email webhooks from n8n.

    Supports both MS365 (MS Graph) and IMAP email sources.
    """
    source: str = Field(..., description="Email source: 'ms365' or 'imap'")
    account_id: str = Field(..., description="Account identifier (e.g., 'h10_hein', 'vortex_info')")
    email_id: str = Field(..., description="Unique email identifier from source")
    sender: str = Field(..., description="Sender email address")
    sender_name: Optional[str] = Field(default=None, description="Sender display name")
    subject: str = Field(..., description="Email subject line")
    body_preview: Optional[str] = Field(default=None, description="Email body preview (first ~255 chars)")
    body_html: Optional[str] = Field(default=None, description="Full HTML body (if available)")
    received_at: str = Field(..., description="Email received timestamp (ISO 8601)")
    has_attachments: bool = Field(default=False, description="Whether email has attachments")
    importance: str = Field(default="normal", description="Email importance: 'high', 'normal', 'low'")
    to_recipients: Optional[str] = Field(default=None, description="JSON array of recipients")
    cc_recipients: Optional[str] = Field(default=None, description="JSON array of CC recipients")
    folder_id: Optional[str] = Field(default=None, description="Source folder ID")
    conversation_id: Optional[str] = Field(default=None, description="Conversation/thread ID")


class EmailWebhookResponse(BaseModel):
    """Response for successful email webhook processing."""
    status: str = Field(default="accepted", description="Processing status")
    correlation_id: str = Field(..., description="Correlation ID for tracking the event")
    message: str = Field(default="Email queued for processing", description="Status message")
    timestamp: str = Field(..., description="Timestamp of acceptance")


class WebhookErrorResponse(BaseModel):
    """Error response for webhook failures."""
    status: str = Field(default="error", description="Error status")
    error: str = Field(..., description="Error message")
    detail: Optional[str] = Field(default=None, description="Detailed error information")


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

async def publish_email_event(payload: EmailWebhookPayload, correlation_id: str) -> bool:
    """
    Publish EMAIL_RECEIVED event to Redis Event Bus.

    Args:
        payload: Email webhook payload from n8n
        correlation_id: Unique correlation ID for workflow tracing

    Returns:
        True if event published successfully, False otherwise
    """
    try:
        event_bus = RedisEventBus()

        event = Event(
            event_type=EventType.EMAIL_RECEIVED,
            source=f"n8n_{payload.source}_{payload.account_id}",
            data={
                "source": payload.source,
                "account_id": payload.account_id,
                "email_id": payload.email_id,
                "sender": payload.sender,
                "sender_name": payload.sender_name,
                "subject": payload.subject,
                "body_preview": payload.body_preview,
                "body_html": payload.body_html,
                "received_at": payload.received_at,
                "has_attachments": payload.has_attachments,
                "importance": payload.importance,
                "to_recipients": payload.to_recipients,
                "cc_recipients": payload.cc_recipients,
                "folder_id": payload.folder_id,
                "conversation_id": payload.conversation_id
            },
            correlation_id=correlation_id,
            metadata={
                "trigger": "n8n_webhook",
                "source_type": payload.source
            }
        )

        await event_bus.publish(event)
        logger.info(f"Published EMAIL_RECEIVED event: {event.event_id} (corr: {correlation_id})")
        return True

    except Exception as e:
        logger.error(f"Failed to publish EMAIL_RECEIVED event: {e}", exc_info=True)
        return False


# ============================================================================
# API ENDPOINTS
# ============================================================================

@router.post(
    "/email/received",
    response_model=EmailWebhookResponse,
    responses={
        202: {"model": EmailWebhookResponse, "description": "Email accepted for processing"},
        400: {"model": WebhookErrorResponse, "description": "Invalid payload"},
        401: {"model": WebhookErrorResponse, "description": "Unauthorized"},
        500: {"model": WebhookErrorResponse, "description": "Internal error"}
    },
    dependencies=[Depends(verify_api_key)]
)
@limiter.limit("60/minute")
async def receive_email_webhook(
    request: Request,
    payload: EmailWebhookPayload,
    background_tasks: BackgroundTasks
) -> EmailWebhookResponse:
    """
    Receive email webhook from n8n.

    This endpoint receives email notifications from n8n triggers
    (MS365 Outlook Trigger or IMAP polling) and publishes them
    to the Redis Event Bus for async processing.

    **Processing Flow:**
    1. Validate payload
    2. Generate correlation ID
    3. Publish EMAIL_RECEIVED event to Redis
    4. Return 202 Accepted immediately
    5. on_email_received hook processes event (async):
       - Classify email (FREE cascade)
       - Enrich with RAG context
       - Generate draft (priority emails only)
       - Queue for approval

    **n8n Workflow Example:**
    ```
    MS Outlook Trigger → HTTP Request (POST /api/v1/webhook/email/received)
    ```

    **Example Request (MS365):**
    ```json
    {
        "source": "ms365",
        "account_id": "h10_hein",
        "email_id": "AAMkAGI2TG93AAA=",
        "sender": "john@blitz.com",
        "sender_name": "John Smith",
        "subject": "Q4 Financial Review Required",
        "body_preview": "Please review the attached Q4 financials...",
        "received_at": "2025-11-30T10:30:00Z",
        "has_attachments": true,
        "importance": "high"
    }
    ```

    **Example Request (IMAP):**
    ```json
    {
        "source": "imap",
        "account_id": "vortex_info",
        "email_id": "12345",
        "sender": "client@example.com",
        "subject": "Support Request",
        "body_preview": "I need help with...",
        "received_at": "2025-11-30T11:00:00Z",
        "has_attachments": false,
        "importance": "normal"
    }
    ```
    """
    logger.info(f"Received email webhook: source={payload.source}, account={payload.account_id}, from={payload.sender}")

    # Validate source
    if payload.source not in ["ms365", "imap"]:
        logger.warning(f"Invalid source: {payload.source}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid source '{payload.source}'. Must be 'ms365' or 'imap'"
        )

    # Generate correlation ID for tracing
    correlation_id = create_correlation_id()

    # Publish event to Redis (async background task for faster response)
    published = await publish_email_event(payload, correlation_id)

    if not published:
        logger.error(f"Failed to publish email event for {payload.email_id}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to queue email for processing. Redis may be unavailable."
        )

    logger.info(f"Email queued for processing: {payload.email_id} (corr: {correlation_id})")

    return EmailWebhookResponse(
        status="accepted",
        correlation_id=correlation_id,
        message=f"Email from {payload.sender} queued for processing",
        timestamp=datetime.utcnow().isoformat()
    )


@router.get("/health")
@limiter.limit("100/minute")
async def webhook_health(request: Request):
    """
    Health check for webhook endpoints.

    Returns:
        Webhook service status
    """
    try:
        # Check Redis connectivity
        event_bus = RedisEventBus()
        redis_ok = await event_bus.ping() if hasattr(event_bus, 'ping') else True

        return {
            "status": "healthy",
            "service": "BOSS Webhook Handler",
            "redis": "connected" if redis_ok else "disconnected",
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        logger.error(f"Webhook health check failed: {e}")
        return {
            "status": "degraded",
            "service": "BOSS Webhook Handler",
            "redis": "error",
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat()
        }


@router.post("/test")
@limiter.limit("10/minute")
async def webhook_test(request: Request):
    """
    Test endpoint for verifying webhook connectivity.

    No authentication required - used for n8n workflow testing.

    Returns:
        Echo of received payload
    """
    try:
        body = await request.json()
        logger.info(f"Webhook test received: {body}")
        return {
            "status": "received",
            "payload": body,
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        logger.error(f"Webhook test failed: {e}")
        return {
            "status": "error",
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat()
        }
