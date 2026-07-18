"""
Data models for Microsoft Graph API operations.

Includes models for:
- Email operations (Email, EmailDraft, EmailAttachment)
- SharePoint/OneDrive operations (SharePointSite, SharePointDrive, SharePointItem)
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional, Dict, Any
from enum import Enum


# =============================================================================
# SHAREPOINT / ONEDRIVE MODELS
# =============================================================================

@dataclass
class SharePointSite:
    """SharePoint site model."""
    id: str
    name: str
    display_name: str
    web_url: str
    description: str = ""
    created_at: Optional[datetime] = None
    modified_at: Optional[datetime] = None
    root_drive_id: Optional[str] = None
    raw_data: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_graph_data(cls, data: Dict[str, Any]) -> "SharePointSite":
        """Create from MS Graph API response."""
        created_at = None
        if data.get("createdDateTime"):
            created_at = datetime.fromisoformat(data["createdDateTime"].replace("Z", "+00:00"))

        modified_at = None
        if data.get("lastModifiedDateTime"):
            modified_at = datetime.fromisoformat(data["lastModifiedDateTime"].replace("Z", "+00:00"))

        return cls(
            id=data.get("id", ""),
            name=data.get("name", ""),
            display_name=data.get("displayName", data.get("name", "")),
            web_url=data.get("webUrl", ""),
            description=data.get("description", ""),
            created_at=created_at,
            modified_at=modified_at,
            root_drive_id=data.get("drive", {}).get("id"),
            raw_data=data
        )


@dataclass
class SharePointDrive:
    """SharePoint/OneDrive drive model."""
    id: str
    name: str
    drive_type: str
    web_url: str
    owner_name: Optional[str] = None
    quota_total: Optional[int] = None
    quota_used: Optional[int] = None
    raw_data: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_graph_data(cls, data: Dict[str, Any]) -> "SharePointDrive":
        """Create from MS Graph API response."""
        owner = data.get("owner", {})
        owner_name = None
        if owner.get("user"):
            owner_name = owner["user"].get("displayName")
        elif owner.get("group"):
            owner_name = owner["group"].get("displayName")

        quota = data.get("quota", {})

        return cls(
            id=data.get("id", ""),
            name=data.get("name", ""),
            drive_type=data.get("driveType", ""),
            web_url=data.get("webUrl", ""),
            owner_name=owner_name,
            quota_total=quota.get("total"),
            quota_used=quota.get("used"),
            raw_data=data
        )


@dataclass
class SharePointItem:
    """SharePoint drive item (file or folder) model."""
    id: str
    name: str
    web_url: str
    size: int = 0
    mime_type: str = ""
    is_folder: bool = False
    is_deleted: bool = False
    created_at: Optional[datetime] = None
    modified_at: Optional[datetime] = None
    created_by: str = ""
    modified_by: str = ""
    parent_path: str = ""
    download_url: Optional[str] = None
    etag: Optional[str] = None
    c_tag: Optional[str] = None
    raw_data: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_graph_data(cls, data: Dict[str, Any]) -> "SharePointItem":
        """Create from MS Graph API response."""
        created_at = None
        if data.get("createdDateTime"):
            created_at = datetime.fromisoformat(data["createdDateTime"].replace("Z", "+00:00"))

        modified_at = None
        if data.get("lastModifiedDateTime"):
            modified_at = datetime.fromisoformat(data["lastModifiedDateTime"].replace("Z", "+00:00"))

        created_by = ""
        if data.get("createdBy", {}).get("user"):
            created_by = data["createdBy"]["user"].get("displayName", "")

        modified_by = ""
        if data.get("lastModifiedBy", {}).get("user"):
            modified_by = data["lastModifiedBy"]["user"].get("displayName", "")

        parent_path = ""
        if data.get("parentReference", {}).get("path"):
            parent_path = data["parentReference"]["path"]

        # Check if item is deleted (from delta queries)
        is_deleted = data.get("deleted") is not None

        return cls(
            id=data.get("id", ""),
            name=data.get("name", ""),
            web_url=data.get("webUrl", ""),
            size=data.get("size", 0),
            mime_type=data.get("file", {}).get("mimeType", "") if data.get("file") else "",
            is_folder="folder" in data,
            is_deleted=is_deleted,
            created_at=created_at,
            modified_at=modified_at,
            created_by=created_by,
            modified_by=modified_by,
            parent_path=parent_path,
            download_url=data.get("@microsoft.graph.downloadUrl"),
            etag=data.get("eTag"),
            c_tag=data.get("cTag"),
            raw_data=data
        )

    @property
    def extension(self) -> str:
        """Get file extension (lowercase, without dot)."""
        if self.is_folder:
            return ""
        if "." in self.name:
            return self.name.rsplit(".", 1)[-1].lower()
        return ""

    def to_document_metadata(self) -> Dict[str, Any]:
        """Convert to document metadata for knowledge base ingestion."""
        return {
            "document_type": "sharepoint_file",
            "source": "sharepoint",
            "item_id": self.id,
            "name": self.name,
            "web_url": self.web_url,
            "size": self.size,
            "mime_type": self.mime_type,
            "extension": self.extension,
            "parent_path": self.parent_path,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "modified_at": self.modified_at.isoformat() if self.modified_at else None,
            "created_by": self.created_by,
            "modified_by": self.modified_by,
        }


@dataclass
class DeltaQueryResult:
    """Result from a delta query operation."""
    items: List[SharePointItem]
    delta_token: str
    next_link: Optional[str] = None
    has_more: bool = False

    @property
    def added_items(self) -> List[SharePointItem]:
        """Get items that were added or modified."""
        return [item for item in self.items if not item.is_deleted]

    @property
    def deleted_items(self) -> List[SharePointItem]:
        """Get items that were deleted."""
        return [item for item in self.items if item.is_deleted]

    @property
    def file_items(self) -> List[SharePointItem]:
        """Get only file items (not folders, not deleted)."""
        return [item for item in self.items if not item.is_folder and not item.is_deleted]


# =============================================================================
# EMAIL MODELS
# =============================================================================

class EmailImportance(Enum):
    """Email importance levels."""
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"


class DraftStatus(Enum):
    """Draft approval status."""
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    REJECTED = "rejected"
    SENT = "sent"


@dataclass
class EmailAttachment:
    """Email attachment model."""
    id: str
    filename: str
    content_type: str
    size_bytes: int
    is_inline: bool = False
    content: Optional[bytes] = None

    @classmethod
    def from_graph_data(cls, data: Dict[str, Any]) -> "EmailAttachment":
        """Create from MS Graph API response."""
        return cls(
            id=data.get("id", ""),
            filename=data.get("name", "unknown"),
            content_type=data.get("contentType", "application/octet-stream"),
            size_bytes=data.get("size", 0),
            is_inline=data.get("isInline", False),
            content=None  # Loaded separately
        )


@dataclass
class Email:
    """Email message model."""
    id: str
    message_id: str
    conversation_id: str
    sender: str
    sender_name: str
    recipients: List[str]
    recipient_names: List[str]
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
    raw_data: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_graph_data(cls, data: Dict[str, Any]) -> "Email":
        """Create from MS Graph API response."""
        sender_data = data.get("from", {}).get("emailAddress", {})
        to_recipients = data.get("toRecipients", [])
        cc_recipients = data.get("ccRecipients", [])
        bcc_recipients = data.get("bccRecipients", [])

        # Parse recipients
        recipients = [r.get("emailAddress", {}).get("address", "") for r in to_recipients]
        recipient_names = [r.get("emailAddress", {}).get("name", "") for r in to_recipients]
        cc_list = [r.get("emailAddress", {}).get("address", "") for r in cc_recipients]
        bcc_list = [r.get("emailAddress", {}).get("address", "") for r in bcc_recipients]

        # Parse dates
        received_at = None
        if data.get("receivedDateTime"):
            received_at = datetime.fromisoformat(data["receivedDateTime"].replace("Z", "+00:00"))

        sent_at = None
        if data.get("sentDateTime"):
            sent_at = datetime.fromisoformat(data["sentDateTime"].replace("Z", "+00:00"))

        # Parse body
        body_data = data.get("body", {})
        body_content = body_data.get("content", "")
        is_html = body_data.get("contentType", "text") == "html"

        # Parse importance
        importance_str = data.get("importance", "normal").lower()
        importance = EmailImportance.NORMAL
        try:
            importance = EmailImportance(importance_str)
        except ValueError:
            pass

        return cls(
            id=data.get("id", ""),
            message_id=data.get("internetMessageId", ""),
            conversation_id=data.get("conversationId", ""),
            sender=sender_data.get("address", ""),
            sender_name=sender_data.get("name", ""),
            recipients=recipients,
            recipient_names=recipient_names,
            cc_recipients=cc_list,
            bcc_recipients=bcc_list,
            subject=data.get("subject", ""),
            body=body_content,
            body_preview=data.get("bodyPreview", ""),
            is_html=is_html,
            received_at=received_at,
            sent_at=sent_at,
            importance=importance,
            is_read=data.get("isRead", False),
            is_flagged=data.get("flag", {}).get("flagStatus", "notFlagged") == "flagged",
            has_attachments=data.get("hasAttachments", False),
            in_reply_to=data.get("inReplyTo"),
            categories=data.get("categories", []),
            raw_data=data
        )

    @classmethod
    def from_pst_data(
        cls,
        id: str,
        message_id: str,
        sender: str,
        sender_name: str,
        recipients: List[str],
        recipient_names: List[str],
        subject: str,
        body: str,
        folder: str,
        pst_file_path: str,
        received_at: Optional[datetime] = None,
        sent_at: Optional[datetime] = None,
        is_html: bool = False,
        has_attachments: bool = False,
        attachment_count: int = 0,
        cc_recipients: Optional[List[str]] = None,
        bcc_recipients: Optional[List[str]] = None,
    ) -> "Email":
        """
        Create Email from PST/OST file data.

        Args:
            id: Generated UUID for BOSS
            message_id: Internet Message-ID (or generated synthetic ID)
            sender: Sender email address
            sender_name: Sender display name
            recipients: List of recipient email addresses
            recipient_names: List of recipient display names
            subject: Email subject
            body: Email body content
            folder: Folder name in PST file
            pst_file_path: Path to source PST file
            received_at: Delivery timestamp
            sent_at: Send timestamp
            is_html: Whether body is HTML
            has_attachments: Whether email has attachments
            attachment_count: Number of attachments
            cc_recipients: CC recipient email addresses
            bcc_recipients: BCC recipient email addresses

        Returns:
            Email object configured for PST source
        """
        # Generate body preview
        body_preview = body[:200] if body else ""

        return cls(
            id=id,
            message_id=message_id,
            conversation_id=message_id,  # Use message_id as conversation_id
            sender=sender,
            sender_name=sender_name or sender,
            recipients=recipients,
            recipient_names=recipient_names,
            cc_recipients=cc_recipients or [],
            bcc_recipients=bcc_recipients or [],
            subject=subject,
            body=body,
            body_preview=body_preview,
            is_html=is_html,
            received_at=received_at,
            sent_at=sent_at,
            importance=EmailImportance.NORMAL,
            is_read=True,  # Assume archived emails are read
            is_flagged=False,
            has_attachments=has_attachments,
            attachments=[],  # Attachment bodies not extracted (too large)
            categories=[],
            folder=folder,
            raw_data={
                "source": "pst_file",
                "pst_file": pst_file_path,
                "folder": folder,
                "attachment_count": attachment_count
            }
        )

    def to_document_metadata(self) -> Dict[str, Any]:
        """
        Convert email to document metadata for knowledge base ingestion.

        Returns standard metadata dict compatible with memory graph.
        """
        return {
            "document_type": "email",
            "source": "ms_graph",
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


@dataclass
class EmailDraft:
    """Email draft model."""
    id: Optional[str] = None
    to_recipients: List[str] = field(default_factory=list)
    cc_recipients: List[str] = field(default_factory=list)
    bcc_recipients: List[str] = field(default_factory=list)
    subject: str = ""
    body: str = ""
    is_html: bool = True
    importance: EmailImportance = EmailImportance.NORMAL
    in_reply_to: Optional[str] = None
    attachments: List[EmailAttachment] = field(default_factory=list)
    status: DraftStatus = DraftStatus.PENDING_APPROVAL
    confidence: Optional[float] = None
    context: Dict[str, Any] = field(default_factory=dict)
    generated_at: Optional[datetime] = None
    approved_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None

    def to_graph_message(self) -> Dict[str, Any]:
        """Convert to MS Graph API message format."""
        message = {
            "subject": self.subject,
            "body": {
                "contentType": "html" if self.is_html else "text",
                "content": self.body
            },
            "toRecipients": [
                {"emailAddress": {"address": addr}} for addr in self.to_recipients
            ]
        }

        if self.cc_recipients:
            message["ccRecipients"] = [
                {"emailAddress": {"address": addr}} for addr in self.cc_recipients
            ]

        if self.bcc_recipients:
            message["bccRecipients"] = [
                {"emailAddress": {"address": addr}} for addr in self.bcc_recipients
            ]

        if self.importance != EmailImportance.NORMAL:
            message["importance"] = self.importance.value

        if self.in_reply_to:
            message["inReplyTo"] = self.in_reply_to

        return message
