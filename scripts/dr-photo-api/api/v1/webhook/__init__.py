"""
BOSS Webhook API Module

Receives incoming webhooks from n8n and other external sources,
publishes events to the Redis Event Bus for processing.

Author: BOSS Development Team
Created: 2025-11-30
"""

from api.v1.webhook.routes import router

__all__ = ["router"]
