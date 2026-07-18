"""
BOSS FastAPI - API Layer for n8n Integration

This module provides REST API endpoints for n8n to interact with BOSS intelligence:
- Context enrichment (RAG + Memory Graph)
- Email intelligence (classification, drafting, sending)
- WhatsApp automation (WAHA integration)
- Document processing (OCR, classification)
- Approval workflows
- System health checks

Architecture:
    n8n Workflows → FastAPI → BOSS Python Intelligence

Author: BOSS Development Team
Created: 2025-11-17
"""

__version__ = "1.0.0"
