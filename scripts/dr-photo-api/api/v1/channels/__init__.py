"""
BOSS Channels API Module

Provides endpoints for managing communication channels:
- MS Graph (Office 365)
- IMAP Email
- WhatsApp (WAHA/Evolution)
- Telegram Bot
"""

from .routes import router

__all__ = ["router"]
