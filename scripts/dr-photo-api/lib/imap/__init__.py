"""
IMAP/SMTP Client for BOSS Email Agent.

Provides universal email fallback for non-Office 365 accounts.
"""

from .client import IMAPClient

__all__ = ["IMAPClient"]
