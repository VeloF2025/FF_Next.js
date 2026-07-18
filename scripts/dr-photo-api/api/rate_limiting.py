"""
Rate Limiting Configuration for BOSS API

Implements per-endpoint rate limiting to prevent abuse and ensure fair usage.
Uses slowapi for FastAPI-compatible rate limiting.

Security Requirements:
- SEC-001: API Rate Limiting (HIGH PRIORITY) - PRODUCTION BLOCKER
- Prevents API abuse and DDoS attacks
- Enforces fair usage across endpoints

Rate Limits by Endpoint:
- Draft Email: 10 requests/minute (AI-intensive)
- Send Email: 5 requests/minute (external API calls)
- Context Enrichment: 30 requests/minute (database queries)
- OCR Extraction: 20 requests/minute (processing intensive)
- WhatsApp Send: 10 requests/minute (external API)
- Approval Actions: 100 requests/minute (lightweight operations)

Author: BOSS Development Team
Created: 2025-11-20
"""

from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi import Request
from fastapi.responses import JSONResponse
from loguru import logger


# Initialize limiter with remote address as key
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["100/minute"]  # Global default for all endpoints
)


async def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):
    """
    Custom handler for rate limit violations.

    Logs rate limit violations and returns user-friendly error response
    with Retry-After header.

    Args:
        request: The FastAPI request object
        exc: The RateLimitExceeded exception

    Returns:
        JSONResponse with 429 status code and retry information
    """
    logger.warning(
        f"Rate limit exceeded for {request.client.host} on {request.url.path}",
        extra={
            "ip": request.client.host,
            "path": request.url.path,
            "method": request.method,
            "limit": str(exc.detail) if hasattr(exc, 'detail') else "unknown"
        }
    )

    return JSONResponse(
        status_code=429,
        content={
            "detail": "Rate limit exceeded. Please try again later.",
            "retry_after": 60,  # seconds
            "error_code": "RATE_LIMIT_EXCEEDED"
        },
        headers={"Retry-After": "60"}
    )


# Endpoint-specific rate limits
# These are applied via decorators on individual endpoints
ENDPOINT_LIMITS = {
    # Email endpoints (AI-intensive operations)
    "/api/v1/email/classify": "30/minute",  # Classification is lightweight
    "/api/v1/email/draft": "10/minute",     # AI draft generation is expensive
    "/api/v1/email/send": "5/minute",       # External API calls, strict limit

    # Context enrichment (database queries)
    "/api/v1/context/context": "30/minute",
    "/api/v1/context/enrich": "30/minute",

    # OCR processing (CPU-intensive)
    "/api/v1/ocr/extract": "20/minute",

    # WhatsApp (external API)
    "/api/v1/whatsapp/send": "10/minute",

    # Approval actions (lightweight operations, higher limit)
    "/api/v1/approval/approve": "100/minute",
    "/api/v1/approval/reject": "100/minute",
    "/api/v1/approval/pending": "100/minute",

    # Meetily proxy (external API)
    "/api/v1/meetily/available-slots": "20/minute",
    "/api/v1/meetily/book-slot": "10/minute",

    # Inbox Zero proxy (external API)
    "/api/v1/inbox-zero/inbox": "30/minute",
    "/api/v1/inbox-zero/plan": "20/minute",
    "/api/v1/inbox-zero/execute": "10/minute",

    # Health checks (no limit needed, but included for completeness)
    "/health": "1000/minute",
    "/api/v1/health": "1000/minute"
}


def get_rate_limit(endpoint_path: str) -> str:
    """
    Get the rate limit for a specific endpoint.

    Args:
        endpoint_path: The full path of the endpoint (e.g., "/api/v1/email/draft")

    Returns:
        Rate limit string (e.g., "10/minute")
    """
    return ENDPOINT_LIMITS.get(endpoint_path, "100/minute")
