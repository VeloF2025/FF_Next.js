"""
Unified email data models for all protocols (MS Graph, IMAP, POP3).

All email clients convert to this standard Email model.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional, Dict, Any
from enum import Enum


class EmailImportance(Enum):
    """Email importance levels."""
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"


@dataclass
class EmailAttachment:
    """Email attachment model."""
    id: str
    filename: str
    content_type: str
    size_bytes: int
    is_inline: bool = False
    content: Optional[bytes] = None


@dataclass
class Email:
    """
    Unified email message model.

    Compatible with all protocols: MS Graph, IMAP, POP3.
    """
    id: str
    message_id: str
    conversation_id: str = ""  # Not all protocols support this
    sender: str = ""
    sender_name: str = ""
    recipients: List[str] = field(default_factory=list)
    recipient_names: List[str] = field(default_factory=list)
    cc_recipients: List[str] = field(default_factory=list)
    bcc_recipients: List[str] = field(default_factory=list)
    subject: str = ""
    body: str = ""
    body_preview: str = ""
    is_html: bool = True
    received_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    importance: EmailImportance = EmailImportance.NORMAL
    is_read: bool = False
    is_flagged: bool = False
    has_attachments: bool = False
    attachments: List[EmailAttachment] = field(default_factory=list)
    in_reply_to: Optional[str] = None
    categories: List[str] = field(default_factory=list)
    folder: str = "inbox"
    source: str = "unknown"  # ms_graph, imap, pop3
    raw_data: Dict[str, Any] = field(default_factory=dict)

    def to_document_metadata(self) -> Dict[str, Any]:
        """
        Convert email to document metadata for knowledge base ingestion.

        Returns standard metadata dict compatible with memory graph.
        """
        return {
            "document_type": "email",
            "source": self.source,
            "email_id": self.id,
            "message_id": self.message_id,
            "conversation_id": self.conversation_id,
            "sender": self.sender,
            "sender_name": self.sender_name,
            "recipients": self.recipients,
            "recipient_names": self.recipient_names,
            "cc_recipients": self.cc_recipients,
            "subject": self.subject,
            "received_at": self.received_at.isoformat() if self.received_at else None,
            "sent_at": self.sent_at.isoformat() if self.sent_at else None,
            "importance": self.importance.value,
            "has_attachments": self.has_attachments,
            "categories": self.categories,
            "folder": self.folder,
        }
