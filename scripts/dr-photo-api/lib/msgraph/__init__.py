"""
Microsoft Graph API Client for BOSS Email Agent.

Provides Office 365 email integration via Microsoft Graph SDK.
"""

from .client import MSGraphClient
from .auth import MSGraphAuth
from .models import Email, EmailAttachment, EmailDraft

__all__ = [
    "MSGraphClient",
    "MSGraphAuth",
    "Email",
    "EmailAttachment",
    "EmailDraft"
]
