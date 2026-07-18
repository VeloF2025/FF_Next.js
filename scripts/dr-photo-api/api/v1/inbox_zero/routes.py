"""
Inbox Zero Email Management API Routes

Provides endpoints for:
- Email AI assistant (categorization, drafting, summarization)
- Email management (clean, archive, unsubscribe)
- Rules and automation
- Analytics and insights
- Proxy to Inbox Zero backend service

Author: BOSS Development Team
Created: 2025-11-18
"""

import logging
import httpx
from typing import Dict, Any, List, Optional
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, status, Request
from pydantic import BaseModel, Field

from api.auth import verify_api_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/inbox_zero", tags=["Email Management"])

# Inbox Zero backend service URL (from environment or default)
import os
INBOX_ZERO_BACKEND_URL = os.getenv("INBOX_ZERO_BACKEND_URL", "http://localhost:3000")
INBOX_ZERO_HEALTH_API_KEY = os.getenv("INBOX_ZERO_HEALTH_API_KEY", "")
INBOX_ZERO_INTERNAL_API_KEY = os.getenv("INBOX_ZERO_INTERNAL_API_KEY", "")


# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================

class EmailSummaryRequest(BaseModel):
    """Email summarization request"""
    thread_id: str
    format: str = Field(default="bullet_points", description="Summary format: bullet_points, paragraph, structured")


class EmailCategorizeRequest(BaseModel):
    """Email categorization request"""
    thread_id: str
    categories: Optional[List[str]] = None


class DraftReplyRequest(BaseModel):
    """Draft email reply request"""
    thread_id: str
    context: Optional[str] = None
    tone: str = Field(default="professional", description="Reply tone: professional, casual, friendly")


class CleanEmailsRequest(BaseModel):
    """Clean emails request"""
    sender: Optional[str] = None
    category: Optional[str] = None
    action: str = Field(description="Action: archive, delete, unsubscribe")


class RuleRequest(BaseModel):
    """Email rule request"""
    name: str
    conditions: Dict[str, Any]
    actions: Dict[str, Any]
    enabled: bool = True


# ============================================================================
# HEALTH CHECK
# ============================================================================

@router.get("/health", dependencies=[Depends(verify_api_key)])
async def health_check():
    """
    Check Inbox Zero backend service health

    Returns:
        dict: Health status and backend information
    """
    try:
        headers = {}
        if INBOX_ZERO_HEALTH_API_KEY:
            headers["x-health-api-key"] = INBOX_ZERO_HEALTH_API_KEY

        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{INBOX_ZERO_BACKEND_URL}/api/health",
                headers=headers
            )

            if response.status_code == 200:
                backend_data = response.json()
                return {
                    "status": "healthy",
                    "backend_url": INBOX_ZERO_BACKEND_URL,
                    "backend_status": backend_data
                }
            else:
                return {
                    "status": "degraded",
                    "backend_url": INBOX_ZERO_BACKEND_URL,
                    "error": f"Backend returned status {response.status_code}"
                }

    except httpx.ConnectError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Inbox Zero backend unavailable at {INBOX_ZERO_BACKEND_URL}"
        )
    except Exception as e:
        logger.error(f"Health check error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Health check failed: {str(e)}"
        )


# ============================================================================
# AI ASSISTANT ENDPOINTS
# ============================================================================

@router.post("/ai/summarize", dependencies=[Depends(verify_api_key)])
async def summarize_email(request: EmailSummaryRequest):
    """
    Summarize email thread using AI

    Args:
        request: Email summarization request

    Returns:
        dict: Email summary
    """
    return await _proxy_request(
        "POST",
        "/api/ai/summarise",
        json_data=request.dict()
    )


@router.post("/ai/categorize", dependencies=[Depends(verify_api_key)])
async def categorize_email(request: EmailCategorizeRequest):
    """
    Categorize email using AI

    Args:
        request: Email categorization request

    Returns:
        dict: Email category and confidence
    """
    return await _proxy_request(
        "POST",
        "/api/user/categorize",
        json_data=request.dict()
    )


@router.post("/ai/draft-reply", dependencies=[Depends(verify_api_key)])
async def draft_reply(request: DraftReplyRequest):
    """
    Generate AI draft reply to email

    Args:
        request: Draft reply request

    Returns:
        dict: Draft reply text
    """
    return await _proxy_request(
        "POST",
        "/api/ai/compose-autocomplete",
        json_data=request.dict()
    )


# ============================================================================
# EMAIL MANAGEMENT ENDPOINTS
# ============================================================================

@router.post("/clean", dependencies=[Depends(verify_api_key)])
async def clean_emails(request: CleanEmailsRequest):
    """
    Clean emails (archive, delete, unsubscribe)

    Args:
        request: Clean emails request

    Returns:
        dict: Cleanup results
    """
    return await _proxy_request(
        "POST",
        "/api/clean",
        json_data=request.dict()
    )


@router.get("/threads", dependencies=[Depends(verify_api_key)])
async def get_threads(
    limit: int = 50,
    offset: int = 0,
    category: Optional[str] = None
):
    """
    Get email threads

    Args:
        limit: Number of threads to return
        offset: Pagination offset
        category: Filter by category

    Returns:
        dict: Email threads
    """
    params = {"limit": limit, "offset": offset}
    if category:
        params["category"] = category

    return await _proxy_request(
        "GET",
        "/api/threads",
        params=params
    )


@router.get("/threads/{thread_id}", dependencies=[Depends(verify_api_key)])
async def get_thread(thread_id: str):
    """
    Get specific email thread

    Args:
        thread_id: Email thread ID

    Returns:
        dict: Email thread details
    """
    return await _proxy_request(
        "GET",
        f"/api/threads/{thread_id}"
    )


# ============================================================================
# RULES & AUTOMATION
# ============================================================================

@router.get("/rules", dependencies=[Depends(verify_api_key)])
async def get_rules():
    """
    Get all email rules

    Returns:
        dict: Email rules
    """
    return await _proxy_request(
        "GET",
        "/api/user/rules"
    )


@router.post("/rules", dependencies=[Depends(verify_api_key)])
async def create_rule(request: RuleRequest):
    """
    Create email rule

    Args:
        request: Rule request

    Returns:
        dict: Created rule
    """
    return await _proxy_request(
        "POST",
        "/api/user/rules",
        json_data=request.dict()
    )


@router.put("/rules/{rule_id}", dependencies=[Depends(verify_api_key)])
async def update_rule(rule_id: str, request: RuleRequest):
    """
    Update email rule

    Args:
        rule_id: Rule ID
        request: Rule request

    Returns:
        dict: Updated rule
    """
    return await _proxy_request(
        "PUT",
        f"/api/user/rules/{rule_id}",
        json_data=request.dict()
    )


@router.delete("/rules/{rule_id}", dependencies=[Depends(verify_api_key)])
async def delete_rule(rule_id: str):
    """
    Delete email rule

    Args:
        rule_id: Rule ID

    Returns:
        dict: Deletion confirmation
    """
    return await _proxy_request(
        "DELETE",
        f"/api/user/rules/{rule_id}"
    )


# ============================================================================
# ANALYTICS & INSIGHTS
# ============================================================================

@router.get("/analytics/summary", dependencies=[Depends(verify_api_key)])
async def get_analytics_summary(
    days: int = 30
):
    """
    Get email analytics summary

    Args:
        days: Number of days to analyze

    Returns:
        dict: Email analytics
    """
    return await _proxy_request(
        "GET",
        "/api/user/analytics/summary",
        params={"days": days}
    )


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

async def _proxy_request(
    method: str,
    endpoint: str,
    json_data: Optional[Dict[str, Any]] = None,
    params: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Proxy request to Inbox Zero backend

    Args:
        method: HTTP method
        endpoint: API endpoint
        json_data: JSON request body
        params: Query parameters

    Returns:
        dict: Response from Inbox Zero backend

    Raises:
        HTTPException: If request fails
    """
    url = f"{INBOX_ZERO_BACKEND_URL}{endpoint}"

    logger.info(f"Proxying {method} request to Inbox Zero: {url}")

    try:
        headers = {}
        if INBOX_ZERO_INTERNAL_API_KEY:
            headers["x-api-key"] = INBOX_ZERO_INTERNAL_API_KEY

        async with httpx.AsyncClient(timeout=300.0) as client:
            if method == "GET":
                response = await client.get(url, params=params, headers=headers)
            elif method == "POST":
                response = await client.post(url, json=json_data, headers=headers)
            elif method == "PUT":
                response = await client.put(url, json=json_data, headers=headers)
            elif method == "DELETE":
                response = await client.delete(url, headers=headers)
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")

            # Check for errors
            if response.status_code >= 400:
                error_detail = response.text
                logger.error(f"Inbox Zero backend error ({response.status_code}): {error_detail}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Inbox Zero backend error: {error_detail}"
                )

            return response.json()

    except httpx.TimeoutException:
        logger.error(f"Timeout while proxying to Inbox Zero: {url}")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Inbox Zero backend timeout (operation may take several minutes)"
        )
    except httpx.RequestError as e:
        logger.error(f"Request error while proxying to Inbox Zero: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Inbox Zero backend unavailable: {str(e)}"
        )
    except ValueError as e:
        logger.error(f"Invalid JSON response from Inbox Zero: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Invalid response from Inbox Zero backend: {str(e)}"
        )
