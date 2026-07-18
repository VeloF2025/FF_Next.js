"""
Email Approval Queue API Routes

Provides endpoints for:
- Queuing email drafts for approval
- Listing pending approvals
- Approving/rejecting drafts
- Retrieving approval status

Author: BOSS Development Team
Created: 2025-11-17
"""

import logging
import os
from typing import List, Optional, Dict, Any
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, status, Query
from pydantic import BaseModel, Field
import psycopg2
from psycopg2.extras import RealDictCursor, Json

from api.auth import verify_api_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/approval", tags=["Email Approval Queue"])


# ============================================================================
# DATABASE CONNECTION
# ============================================================================

def get_db_connection():
    """Get PostgreSQL database connection."""
    # Try DATABASE_URL first (Docker/VPS standard)
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        return psycopg2.connect(database_url)

    # Fall back to individual environment variables
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=int(os.getenv("POSTGRES_PORT", "5432")),
        database=os.getenv("POSTGRES_DB", "boss_production"),
        user=os.getenv("POSTGRES_USER", "boss_admin"),
        password=os.getenv("POSTGRES_PASSWORD")
    )


# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================

class QueueDraftRequest(BaseModel):
    """Request to queue email draft for approval"""
    draft_id: str = Field(..., description="Unique draft identifier")

    # Email source tracking (for multi-account support)
    source: str = Field(default="unknown", description="Email source: 'ms365' | 'imap' | 'direct'")
    account_id: str = Field(default="", description="Account identifier (e.g., 'h10_hein', 'vortex_info')")

    # Original email
    original_from: str = Field(..., description="Original sender")
    original_to: List[str] = Field(..., description="Original recipients")
    original_subject: str = Field(..., description="Original subject")
    original_body: str = Field(..., description="Original body")
    original_received_at: Optional[str] = Field(default=None, description="Original received time")

    # Classification
    urgency: Optional[str] = Field(default=None, description="Urgency level")
    category: Optional[str] = Field(default=None, description="Category")
    intent: Optional[str] = Field(default=None, description="Intent")
    priority_score: Optional[float] = Field(default=None, description="Priority score")
    enriched_context: Optional[Dict[str, Any]] = Field(default=None, description="Enriched context")

    # Draft content
    draft_to: List[str] = Field(..., description="Draft recipients")
    draft_subject: str = Field(..., description="Draft subject")
    draft_body: str = Field(..., description="Draft body")
    draft_tone: Optional[str] = Field(default="professional", description="Draft tone")
    draft_confidence: Optional[float] = Field(default=None, description="Draft confidence")


class ApprovalItem(BaseModel):
    """Approval queue item"""
    id: int
    draft_id: str
    source: str
    account_id: str
    original_from: str
    original_to: List[str]
    original_subject: str
    urgency: Optional[str]
    category: Optional[str]
    priority_score: Optional[float]
    draft_to: List[str]
    draft_subject: str
    draft_body: str
    status: str
    created_at: str


class ApprovalResponse(BaseModel):
    """Response for approval/rejection"""
    draft_id: str
    status: str
    reviewed_at: str


class ApprovalStatsResponse(BaseModel):
    """Approval queue statistics"""
    total_pending: int
    total_approved: int
    total_rejected: int
    total_sent: int
    high_priority_pending: int


# ============================================================================
# API ENDPOINTS
# ============================================================================

@router.post("/queue", dependencies=[Depends(verify_api_key)])
async def queue_draft(request: QueueDraftRequest) -> Dict[str, Any]:
    """
    Queue email draft for approval.

    This endpoint stores an email draft in the approval queue
    for user review before sending.

    **Example Request:**
    ```json
    {
        "draft_id": "draft_1731847382",
        "original_from": "john@blitz.com",
        "original_to": ["hein@blitzfibre.com"],
        "original_subject": "Q4 Financial Review",
        "original_body": "Please review...",
        "urgency": "high",
        "category": "financial",
        "priority_score": 0.95,
        "draft_to": ["john@blitz.com"],
        "draft_subject": "Re: Q4 Financial Review",
        "draft_body": "Thank you for your email..."
    }
    ```
    """
    logger.info(f"Queuing draft for approval: {request.draft_id}")

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            INSERT INTO email_approval_queue (
                draft_id, source, account_id, original_from, original_to, original_subject, original_body,
                original_received_at, urgency, category, intent, priority_score,
                enriched_context, draft_to, draft_subject, draft_body, draft_tone,
                draft_confidence, status, created_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending', NOW()
            )
            RETURNING id, draft_id, source, account_id, created_at
        """, (
            request.draft_id,
            request.source,
            request.account_id,
            request.original_from,
            request.original_to,
            request.original_subject,
            request.original_body,
            request.original_received_at,
            request.urgency,
            request.category,
            request.intent,
            request.priority_score,
            Json(request.enriched_context) if request.enriched_context else None,
            request.draft_to,
            request.draft_subject,
            request.draft_body,
            request.draft_tone,
            request.draft_confidence
        ))

        result = cur.fetchone()
        conn.commit()

        logger.info(f"✅ Draft queued: {request.draft_id} (ID: {result['id']}, source: {result['source']}, account: {result['account_id']})")

        return {
            "id": result["id"],
            "draft_id": result["draft_id"],
            "source": result["source"],
            "account_id": result["account_id"],
            "status": "pending",
            "created_at": result["created_at"].isoformat(),
            "message": "Draft queued for approval"
        }

    except psycopg2.IntegrityError as e:
        if conn:
            conn.rollback()
        logger.error(f"Draft already exists: {request.draft_id}")
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Draft {request.draft_id} already exists in queue"
        )
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"Failed to queue draft: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to queue draft: {str(e)}"
        )
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@router.get("/pending", dependencies=[Depends(verify_api_key)])
async def get_pending_approvals(
    limit: int = Query(default=50, ge=1, le=200, description="Max items to return"),
    offset: int = Query(default=0, ge=0, description="Pagination offset")
) -> Dict[str, Any]:
    """
    Get pending email approvals.

    Returns drafts waiting for user approval, ordered by priority.
    """
    logger.info(f"Fetching pending approvals (limit={limit}, offset={offset})")

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            SELECT
                id, draft_id, source, account_id, original_from, original_to, original_subject,
                urgency, category, priority_score, draft_to, draft_subject,
                draft_body, status, created_at
            FROM email_approval_queue
            WHERE status = 'pending'
            ORDER BY priority_score DESC NULLS LAST, created_at DESC
            LIMIT %s OFFSET %s
        """, (limit, offset))

        results = cur.fetchall()

        items = [
            ApprovalItem(
                id=row["id"],
                draft_id=row["draft_id"],
                source=row["source"] or "unknown",
                account_id=row["account_id"] or "",
                original_from=row["original_from"],
                original_to=row["original_to"],
                original_subject=row["original_subject"],
                urgency=row["urgency"],
                category=row["category"],
                priority_score=row["priority_score"],
                draft_to=row["draft_to"],
                draft_subject=row["draft_subject"],
                draft_body=row["draft_body"],
                status=row["status"],
                created_at=row["created_at"].isoformat()
            )
            for row in results
        ]

        logger.info(f"✅ Found {len(items)} pending approvals")

        # Return in format expected by Communications Exchange pipelines
        return {
            "drafts": [
                {
                    "id": item.id,
                    "draft_id": item.draft_id,
                    "to": ", ".join(item.draft_to) if item.draft_to else "",
                    "subject": item.draft_subject,
                    "body_preview": item.draft_body[:200] if item.draft_body else "",
                    "priority": item.urgency or "normal",
                    "created_at": item.created_at,
                    "source": item.source,
                    "account_id": item.account_id
                }
                for item in items
            ],
            "total": len(items),
            "limit": limit,
            "offset": offset
        }

    except Exception as e:
        logger.error(f"Failed to fetch pending approvals: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch pending approvals: {str(e)}"
        )
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


class EditDraftRequest(BaseModel):
    """Request to edit a draft"""
    edit_instructions: str = Field(..., description="Instructions for editing the draft")
    edited_by: str = Field(default="user", description="Who edited the draft")


class RejectDraftRequest(BaseModel):
    """Request to reject a draft"""
    reason: str = Field(default="Rejected by user", description="Rejection reason")
    rejected_by: str = Field(default="user", description="Who rejected the draft")


class ApproveDraftRequest(BaseModel):
    """Request to approve a draft"""
    approved_by: str = Field(default="user", description="Who approved the draft")


@router.patch("/{item_id}", dependencies=[Depends(verify_api_key)])
async def edit_draft(item_id: int, request: EditDraftRequest) -> Dict[str, Any]:
    """
    Edit an email draft.

    Applies edit instructions to update the draft content.
    For now, stores the edit instructions as a note - full AI editing would require Claude API.
    """
    logger.info(f"Editing draft item: {item_id}")

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # First fetch the current draft
        cur.execute("""
            SELECT id, draft_id, draft_subject, draft_body, draft_to
            FROM email_approval_queue
            WHERE id = %s AND status = 'pending'
        """, (item_id,))

        draft = cur.fetchone()

        if not draft:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Draft {item_id} not found or already processed"
            )

        # For now, append edit note to body (full AI editing would require Claude API)
        updated_body = f"{draft['draft_body']}\n\n---\n[Edit requested by {request.edited_by}]: {request.edit_instructions}"

        cur.execute("""
            UPDATE email_approval_queue
            SET draft_body = %s, updated_at = NOW()
            WHERE id = %s
            RETURNING id, draft_id, draft_subject, draft_body
        """, (updated_body, item_id))

        result = cur.fetchone()
        conn.commit()

        logger.info(f"✅ Draft edited: {item_id}")

        return {
            "id": result["id"],
            "draft_id": result["draft_id"],
            "subject": result["draft_subject"],
            "body_preview": result["draft_body"][:300] if result["draft_body"] else "",
            "edit_applied": True,
            "edit_instructions": request.edit_instructions
        }

    except HTTPException:
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"Failed to edit draft: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to edit draft: {str(e)}"
        )
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@router.post("/{item_id}/approve", dependencies=[Depends(verify_api_key)])
async def approve_draft_by_id(item_id: int, request: Optional[ApproveDraftRequest] = None) -> Dict[str, Any]:
    """
    Approve email draft by queue ID.

    Marks the draft as approved, ready for sending.
    """
    approved_by = request.approved_by if request else "user"
    logger.info(f"Approving draft item: {item_id} by {approved_by}")

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            UPDATE email_approval_queue
            SET status = 'approved', reviewed_at = NOW(), reviewed_by = %s
            WHERE id = %s AND status = 'pending'
            RETURNING id, draft_id, draft_to, draft_subject, status, reviewed_at
        """, (approved_by, item_id))

        result = cur.fetchone()

        if not result:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Draft {item_id} not found or already processed"
            )

        conn.commit()

        logger.info(f"✅ Draft approved: {item_id}")

        return {
            "id": result["id"],
            "draft_id": result["draft_id"],
            "to": ", ".join(result["draft_to"]) if result["draft_to"] else "",
            "subject": result["draft_subject"],
            "status": result["status"],
            "reviewed_at": result["reviewed_at"].isoformat(),
            "message_id": f"approved_{result['id']}"  # TODO: Actual send returns real message_id
        }

    except HTTPException:
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"Failed to approve draft: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to approve draft: {str(e)}"
        )
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@router.post("/{item_id}/reject", dependencies=[Depends(verify_api_key)])
async def reject_draft_by_id(item_id: int, request: Optional[RejectDraftRequest] = None) -> Dict[str, Any]:
    """
    Reject email draft by queue ID.

    Marks the draft as rejected with optional reason.
    """
    reason = request.reason if request else "Rejected by user"
    rejected_by = request.rejected_by if request else "user"
    logger.info(f"Rejecting draft item: {item_id} by {rejected_by}")

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            UPDATE email_approval_queue
            SET status = 'rejected', reviewed_at = NOW(), reviewed_by = %s, rejection_reason = %s
            WHERE id = %s AND status = 'pending'
            RETURNING id, draft_id, status, reviewed_at
        """, (rejected_by, reason, item_id))

        result = cur.fetchone()

        if not result:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Draft {item_id} not found or already processed"
            )

        conn.commit()

        logger.info(f"✅ Draft rejected: {item_id}")

        return {
            "id": result["id"],
            "draft_id": result["draft_id"],
            "status": result["status"],
            "reviewed_at": result["reviewed_at"].isoformat(),
            "reason": reason
        }

    except HTTPException:
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"Failed to reject draft: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to reject draft: {str(e)}"
        )
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@router.post("/approve/{draft_id}", response_model=ApprovalResponse, dependencies=[Depends(verify_api_key)])
async def approve_draft(draft_id: str) -> ApprovalResponse:
    """
    Approve email draft.

    Marks the draft as approved, ready for sending.
    """
    logger.info(f"Approving draft: {draft_id}")

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            UPDATE email_approval_queue
            SET status = 'approved', reviewed_at = NOW(), reviewed_by = 'user'
            WHERE draft_id = %s AND status = 'pending'
            RETURNING draft_id, status, reviewed_at
        """, (draft_id,))

        result = cur.fetchone()

        if not result:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Draft {draft_id} not found or already processed"
            )

        conn.commit()

        logger.info(f"✅ Draft approved: {draft_id}")

        return ApprovalResponse(
            draft_id=result["draft_id"],
            status=result["status"],
            reviewed_at=result["reviewed_at"].isoformat()
        )

    except HTTPException:
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"Failed to approve draft: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to approve draft: {str(e)}"
        )
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


class ApproveAndSendResponse(BaseModel):
    """Response for approve and send operation"""
    draft_id: str
    status: str
    message_id: Optional[str] = None
    sent_at: Optional[str] = None
    error: Optional[str] = None


@router.post("/approve-and-send/{draft_id}", response_model=ApproveAndSendResponse, dependencies=[Depends(verify_api_key)])
async def approve_and_send_draft(draft_id: str) -> ApproveAndSendResponse:
    """
    Approve and send email draft in one operation.

    This endpoint:
    1. Marks the draft as approved
    2. Sends the email via the appropriate client (MS Graph or IMAP)
    3. Updates status to 'sent'

    **Multi-Account Support:**
    - For MS Graph (ms365): Uses account_id to select correct tenant/credentials
    - For IMAP: Uses account_id to select correct IMAP server/credentials

    **Example:**
    ```
    POST /api/v1/approval/approve-and-send/draft_1731847382
    ```
    """
    logger.info(f"Approving and sending draft: {draft_id}")

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # Get draft details
        cur.execute("""
            SELECT draft_id, source, account_id, draft_to, draft_subject, draft_body,
                   original_from, status, metadata
            FROM email_approval_queue
            WHERE draft_id = %s
        """, (draft_id,))

        draft = cur.fetchone()

        if not draft:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Draft {draft_id} not found"
            )

        if draft["status"] == "sent":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Draft {draft_id} already sent"
            )

        if draft["status"] == "rejected":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Draft {draft_id} was rejected and cannot be sent"
            )

        # Send email based on source type
        message_id = None
        source = draft["source"]
        account_id = draft["account_id"]

        if source == "ms365":
            # Use MS Graph to send
            message_id = await _send_via_msgraph(
                account_id=account_id,
                to=draft["draft_to"],
                subject=draft["draft_subject"],
                body=draft["draft_body"],
                in_reply_to=draft.get("metadata", {}).get("in_reply_to") if draft.get("metadata") else None
            )
        elif source == "imap":
            # Use SMTP to send (paired with IMAP account)
            message_id = await _send_via_smtp(
                account_id=account_id,
                to=draft["draft_to"],
                subject=draft["draft_subject"],
                body=draft["draft_body"],
                in_reply_to=draft.get("metadata", {}).get("in_reply_to") if draft.get("metadata") else None
            )
        else:
            # Default: try MS Graph with default account
            logger.warning(f"Unknown source '{source}', attempting MS Graph default")
            message_id = await _send_via_msgraph(
                account_id=None,
                to=draft["draft_to"],
                subject=draft["draft_subject"],
                body=draft["draft_body"],
                in_reply_to=None
            )

        # Update status to sent
        cur.execute("""
            UPDATE email_approval_queue
            SET status = 'sent', reviewed_at = NOW(), reviewed_by = 'user',
                sent_at = NOW(), message_id = %s
            WHERE draft_id = %s
            RETURNING draft_id, status, sent_at
        """, (message_id, draft_id))

        result = cur.fetchone()
        conn.commit()

        logger.info(f"✅ Draft approved and sent: {draft_id} -> {message_id}")

        return ApproveAndSendResponse(
            draft_id=result["draft_id"],
            status="sent",
            message_id=message_id,
            sent_at=result["sent_at"].isoformat() if result["sent_at"] else None
        )

    except HTTPException:
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"Failed to approve and send draft: {e}", exc_info=True)

        # Update status to indicate failure but keep as approved
        try:
            if conn and cur:
                cur.execute("""
                    UPDATE email_approval_queue
                    SET status = 'approved', reviewed_at = NOW(),
                        metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb
                    WHERE draft_id = %s
                """, (Json({"send_error": str(e)}), draft_id))
                conn.commit()
        except Exception:
            pass

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to send draft: {str(e)}"
        )
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


async def _send_via_msgraph(
    account_id: Optional[str],
    to: List[str],
    subject: str,
    body: str,
    in_reply_to: Optional[str] = None
) -> str:
    """Send email via MS Graph API."""
    from lib.msgraph.multi_account_client import MultiAccountMSGraphClient
    from lib.msgraph.client import MSGraphClient

    if account_id:
        # Use multi-account client
        multi_client = MultiAccountMSGraphClient()
        client = multi_client.get_client(account_id)
    else:
        # Use default single client
        client = MSGraphClient()

    await client.connect()

    try:
        await client.send_email(
            to=to,
            subject=subject,
            body=body,
            is_html=True,
            in_reply_to=in_reply_to
        )
        message_id = f"msgraph_{datetime.now().timestamp()}"
        return message_id
    finally:
        await client.disconnect()


async def _send_via_smtp(
    account_id: str,
    to: List[str],
    subject: str,
    body: str,
    in_reply_to: Optional[str] = None
) -> str:
    """Send email via SMTP (paired with IMAP account)."""
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    import json
    from pathlib import Path

    # Load IMAP accounts config to get SMTP settings
    config_path = Path(os.getenv("IMAP_ACCOUNTS_FILE", "data/imap_accounts.json"))
    if not config_path.exists():
        raise ValueError(f"IMAP accounts config not found: {config_path}")

    with open(config_path) as f:
        config = json.load(f)

    # Find account
    account = None
    for acc in config.get("accounts", []):
        if acc.get("account_id") == account_id:
            account = acc
            break

    if not account:
        raise ValueError(f"IMAP account not found: {account_id}")

    # Get SMTP settings (typically same host, port 587 or 465)
    smtp_host = account.get("smtp_host", account.get("host", "").replace("imap.", "smtp."))
    smtp_port = account.get("smtp_port", 587)
    username = account.get("username")
    password = account.get("password")

    # Create email
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = username
    msg["To"] = ", ".join(to)
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = in_reply_to

    # Add HTML body
    html_part = MIMEText(body, "html")
    msg.attach(html_part)

    # Send via SMTP
    try:
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.starttls()
            server.login(username, password)
            server.sendmail(username, to, msg.as_string())

        message_id = f"smtp_{datetime.now().timestamp()}"
        logger.info(f"✅ Email sent via SMTP ({account_id}): {message_id}")
        return message_id
    except Exception as e:
        logger.error(f"SMTP send failed for {account_id}: {e}")
        raise


@router.post("/reject/{draft_id}", response_model=ApprovalResponse, dependencies=[Depends(verify_api_key)])
async def reject_draft(
    draft_id: str,
    reason: Optional[str] = Query(default=None, description="Rejection reason")
) -> ApprovalResponse:
    """
    Reject email draft.

    Marks the draft as rejected with optional reason.
    """
    logger.info(f"Rejecting draft: {draft_id}")

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            UPDATE email_approval_queue
            SET status = 'rejected', reviewed_at = NOW(), reviewed_by = 'user', rejection_reason = %s
            WHERE draft_id = %s AND status = 'pending'
            RETURNING draft_id, status, reviewed_at
        """, (reason, draft_id))

        result = cur.fetchone()

        if not result:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Draft {draft_id} not found or already processed"
            )

        conn.commit()

        logger.info(f"✅ Draft rejected: {draft_id}")

        return ApprovalResponse(
            draft_id=result["draft_id"],
            status=result["status"],
            reviewed_at=result["reviewed_at"].isoformat()
        )

    except HTTPException:
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"Failed to reject draft: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to reject draft: {str(e)}"
        )
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@router.get("/stats", response_model=ApprovalStatsResponse, dependencies=[Depends(verify_api_key)])
async def get_approval_stats() -> ApprovalStatsResponse:
    """
    Get approval queue statistics.

    Returns counts of drafts by status and high-priority pending items.
    """
    logger.info("Fetching approval queue statistics")

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            SELECT
                COUNT(*) FILTER (WHERE status = 'pending') as total_pending,
                COUNT(*) FILTER (WHERE status = 'approved') as total_approved,
                COUNT(*) FILTER (WHERE status = 'rejected') as total_rejected,
                COUNT(*) FILTER (WHERE status = 'sent') as total_sent,
                COUNT(*) FILTER (WHERE status = 'pending' AND priority_score >= 0.8) as high_priority_pending
            FROM email_approval_queue
        """)

        result = cur.fetchone()

        stats = ApprovalStatsResponse(
            total_pending=result["total_pending"] or 0,
            total_approved=result["total_approved"] or 0,
            total_rejected=result["total_rejected"] or 0,
            total_sent=result["total_sent"] or 0,
            high_priority_pending=result["high_priority_pending"] or 0
        )

        logger.info(f"✅ Stats: {stats.total_pending} pending, {stats.high_priority_pending} high-priority")

        return stats

    except Exception as e:
        logger.error(f"Failed to fetch approval stats: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch approval stats: {str(e)}"
        )
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@router.post("/send-approved", dependencies=[Depends(verify_api_key)])
async def send_all_approved_drafts() -> Dict[str, Any]:
    """
    Send all approved but unsent drafts.

    This endpoint processes any drafts with status='approved' that
    haven't been sent yet (useful for batch processing or retry).

    Returns:
        Summary of sent/failed drafts
    """
    logger.info("Processing all approved drafts...")

    conn = None
    cur = None
    results = {
        "processed": 0,
        "sent": 0,
        "failed": 0,
        "errors": []
    }

    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # Get all approved but unsent drafts
        cur.execute("""
            SELECT draft_id FROM email_approval_queue
            WHERE status = 'approved'
            ORDER BY created_at ASC
        """)

        approved_drafts = cur.fetchall()
        results["processed"] = len(approved_drafts)

        for draft in approved_drafts:
            draft_id = draft["draft_id"]
            try:
                # Use the approve-and-send logic for each draft
                response = await approve_and_send_draft(draft_id)
                if response.status == "sent":
                    results["sent"] += 1
                else:
                    results["failed"] += 1
                    results["errors"].append({
                        "draft_id": draft_id,
                        "error": "Unknown status"
                    })
            except Exception as e:
                results["failed"] += 1
                results["errors"].append({
                    "draft_id": draft_id,
                    "error": str(e)
                })

        logger.info(f"✅ Processed {results['processed']} approved drafts: "
                   f"{results['sent']} sent, {results['failed']} failed")

        return results

    except Exception as e:
        logger.error(f"Failed to process approved drafts: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process approved drafts: {str(e)}"
        )
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()
