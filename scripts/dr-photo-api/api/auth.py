"""
BOSS API Authentication

Provides authentication utilities for FastAPI endpoints.

Author: BOSS Development Team
Created: 2025-11-17
"""

import os
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

# API Key from environment
API_KEY = os.getenv("BOSS_API_KEY", "boss_n8n_integration_key_2025")

# Security
security = HTTPBearer()


def verify_api_key(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    """
    Verify API key for authentication.

    Args:
        credentials: HTTP Bearer token

    Returns:
        API key if valid

    Raises:
        HTTPException: If API key is invalid
    """
    if credentials.credentials != API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return credentials.credentials
