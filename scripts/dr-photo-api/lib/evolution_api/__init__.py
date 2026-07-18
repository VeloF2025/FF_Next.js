"""
Evolution API Client for BOSS WhatsApp Agent.

Provides WhatsApp Web integration via Evolution API.
"""

from .client import EvolutionClient
from .models import WhatsAppMessage, WhatsAppDraft, MessageType

__all__ = [
    "EvolutionClient",
    "WhatsAppMessage",
    "WhatsAppDraft",
    "MessageType"
]
