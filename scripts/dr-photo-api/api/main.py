"""
BOSS FastAPI Main Application

FastAPI server for n8n → BOSS integration.
Provides REST API endpoints for all BOSS intelligence capabilities.

Usage:
    python -m uvicorn api.main:app --reload --port 8000

Environment Variables:
    BOSS_API_KEY: API key for authentication (from .env)
    POSTGRES_HOST: PostgreSQL host (boss-postgres)
    REDIS_HOST: Redis host (boss-redis)
    QDRANT_HOST: Qdrant host (boss-qdrant)

Author: BOSS Development Team
Created: 2025-11-17
"""

import os
import logging
from contextlib import asynccontextmanager
from typing import Optional
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
import uvicorn

# Load environment variables from infrastructure/.env
env_path = Path(__file__).parent.parent / "infrastructure" / ".env"
if env_path.exists():
    load_dotenv(env_path)
    logging.info(f"✅ Loaded environment from: {env_path}")
else:
    logging.warning(f"⚠️ .env file not found at: {env_path}")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Import authentication
from api.auth import verify_api_key

# Import rate limiting
from api.rate_limiting import limiter, rate_limit_exceeded_handler

# Import API routers (after auth to avoid circular import)
# Only import lightweight routers for VPS deployment
try:
    from api.v1.context.routes import router as context_router
    HAS_CONTEXT = True
except ImportError:
    HAS_CONTEXT = False
    context_router = None

try:
    from api.v1.email.routes import router as email_router
    HAS_EMAIL = True
except ImportError:
    HAS_EMAIL = False
    email_router = None

from api.v1.approval.routes import router as approval_router
from api.v1.meetily.routes import router as meetily_router
from api.v1.inbox_zero.routes import router as inbox_zero_router
from api.v1.webhook.routes import router as webhook_router
from api.v1.lawley.routes import router as lawley_router
from api.v1.channels.routes import router as channels_router
from api.v1.system.routes import router as system_router
from api.v1.settings.routes import router as settings_router

# DR Photo Verification API
try:
    from api.v1.dr_photos.routes import router as dr_photos_router
    HAS_DR_PHOTOS = True
except ImportError:
    HAS_DR_PHOTOS = False
    dr_photos_router = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan context manager.
    Handles startup and shutdown events.
    """
    # Startup
    logger.info("🚀 BOSS FastAPI starting up...")
    logger.info(f"📡 API available at: http://0.0.0.0:8000")
    logger.info(f"📖 Documentation at: http://0.0.0.0:8000/docs")

    # TODO: Initialize connections
    # - PostgreSQL connection pool
    # - Redis connection
    # - Qdrant client

    yield

    # Shutdown
    logger.info("🛑 BOSS FastAPI shutting down...")
    # TODO: Close connections


# Create FastAPI app
app = FastAPI(
    title="BOSS API",
    description="REST API for n8n → BOSS intelligence integration",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# Configure rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

# CORS middleware (allow n8n to call API)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # TODO: Restrict to n8n container IP
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routers
if HAS_CONTEXT and context_router:
    app.include_router(context_router, prefix="/api/v1")
if HAS_EMAIL and email_router:
    app.include_router(email_router, prefix="/api/v1")
app.include_router(approval_router, prefix="/api/v1")
app.include_router(meetily_router, prefix="/api/v1")
app.include_router(inbox_zero_router, prefix="/api/v1")
app.include_router(webhook_router, prefix="/api/v1")
app.include_router(lawley_router, prefix="/api/v1")
app.include_router(channels_router)  # Already has /api/v1/channels prefix
app.include_router(system_router)   # Already has /api/v1/system prefix
app.include_router(settings_router) # Already has /api/v1/settings prefix

# DR Photo Verification (1Map integration)
if HAS_DR_PHOTOS and dr_photos_router:
    app.include_router(dr_photos_router, prefix="/api/v1")


@app.get("/")
@limiter.limit("1000/minute")
async def root(request: Request):
    """Root endpoint - API info"""
    return {
        "service": "BOSS API",
        "version": "1.0.0",
        "status": "operational",
        "docs": "/docs"
    }


@app.get("/health")
@limiter.limit("1000/minute")
async def health_check(request: Request):
    """
    Health check endpoint (no authentication required).

    Returns:
        System health status
    """
    # TODO: Check database connections
    return {
        "status": "healthy",
        "service": "BOSS API",
        "version": "1.0.0",
        "dependencies": {
            "postgresql": "not_checked",  # TODO: Ping database
            "redis": "not_checked",        # TODO: Ping Redis
            "qdrant": "not_checked"        # TODO: Ping Qdrant
        }
    }


@app.get("/api/v1/health", dependencies=[Depends(verify_api_key)])
@limiter.limit("1000/minute")
async def authenticated_health_check(request: Request):
    """
    Authenticated health check endpoint.

    Returns:
        Detailed system health status (requires API key)
    """
    return {
        "status": "healthy",
        "authenticated": True,
        "service": "BOSS API",
        "version": "1.0.0",
        "dependencies": {
            "postgresql": "not_checked",
            "redis": "not_checked",
            "qdrant": "not_checked"
        }
    }


# Exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Global exception handler for unhandled errors"""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": "Internal server error",
            "detail": str(exc) if os.getenv("DEBUG") else "An error occurred"
        }
    )


if __name__ == "__main__":
    uvicorn.run(
        "api.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
