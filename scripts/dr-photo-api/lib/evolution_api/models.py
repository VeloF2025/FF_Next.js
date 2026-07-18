"""
Data models for Evolution API WhatsApp operations.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional, Dict, Any
from enum import Enum


class MessageType(Enum):
    """WhatsApp message types."""
    TEXT = "text"
    IMAGE = "image"
    DOCUMENT = "document"
    AUDIO = "audio"
    VIDEO = "video"
    STICKER = "sticker"
    CONTACT = "contact"
    LOCATION = "location"


class DraftStatus(Enum):
    """Draft approval status."""
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    REJECTED = "rejected"
    SENT = "sent"


@dataclass
class WhatsAppMessage:
    """WhatsApp message model."""
    id: str
    phone: str  # Remote JID (e.g., "5511999999999@s.whatsapp.net")
    sender_name: str
    message_type: MessageType
    text: Optional[str] = None
    media_id: Optional[str] = None
    media_url: Optional[str] = None
    media_mimetype: Optional[str] = None
    caption: Optional[str] = None
    timestamp: datetime = field(default_factory=datetime.now)
    is_from_me: bool = False
    raw_data: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_webhook(cls, webhook_data: Dict[str, Any]) -> "WhatsAppMessage":
        """
        Create from Evolution API webhook data.

        Args:
            webhook_data: Webhook event data from Evolution API

        Returns:
            WhatsAppMessage object
        """
        data = webhook_data.get("data", {})
        key = data.get("key", {})
        message = data.get("message", {})

        # Extract phone (remote JID)
        phone = key.get("remoteJid", "")

        # Extract sender name
        sender_name = data.get("pushName", phone.split("@")[0])

        # Extract message ID
        message_id = key.get("id", "")

        # Determine message type and extract content
        message_type = MessageType.TEXT
        text = None
        media_id = None
        media_url = None
        media_mimetype = None
        caption = None

        if "conversation" in message:
            # Simple text message
            message_type = MessageType.TEXT
            text = message["conversation"]

        elif "extendedTextMessage" in message:
            # Extended text (with formatting, links, etc.)
            message_type = MessageType.TEXT
            text = message["extendedTextMessage"].get("text", "")

        elif "imageMessage" in message:
            # Image message
            message_type = MessageType.IMAGE
            img_data = message["imageMessage"]
            media_url = img_data.get("url")
            media_mimetype = img_data.get("mimetype", "image/jpeg")
            caption = img_data.get("caption")

        elif "documentMessage" in message:
            # Document message (PDF, etc.)
            message_type = MessageType.DOCUMENT
            doc_data = message["documentMessage"]
            media_url = doc_data.get("url")
            media_mimetype = doc_data.get("mimetype", "application/octet-stream")
            caption = doc_data.get("caption")

        elif "audioMessage" in message:
            # Voice note
            message_type = MessageType.AUDIO
            audio_data = message["audioMessage"]
            media_url = audio_data.get("url")
            media_mimetype = audio_data.get("mimetype", "audio/ogg")

        elif "videoMessage" in message:
            # Video message
            message_type = MessageType.VIDEO
            video_data = message["videoMessage"]
            media_url = video_data.get("url")
            media_mimetype = video_data.get("mimetype", "video/mp4")
            caption = video_data.get("caption")

        elif "stickerMessage" in message:
            # Sticker
            message_type = MessageType.STICKER
            sticker_data = message["stickerMessage"]
            media_url = sticker_data.get("url")

        # Parse timestamp
        timestamp_str = data.get("messageTimestamp")
        if timestamp_str:
            timestamp = datetime.fromtimestamp(int(timestamp_str))
        else:
            timestamp = datetime.now()

        # Check if from me
        is_from_me = key.get("fromMe", False)

        return cls(
            id=message_id,
            phone=phone,
            sender_name=sender_name,
            message_type=message_type,
            text=text,
            media_id=media_id,
            media_url=media_url,
            media_mimetype=media_mimetype,
            caption=caption,
            timestamp=timestamp,
            is_from_me=is_from_me,
            raw_data=webhook_data
        )

    def get_phone_number(self) -> str:
        """Extract phone number from JID (remove @s.whatsapp.net)."""
        return self.phone.split("@")[0]


@dataclass
class WhatsAppDraft:
    """WhatsApp draft reply model."""
    to_phone: str  # Phone number or JID
    message: str
    media: Optional[bytes] = None
    media_filename: Optional[str] = None
    media_type: Optional[str] = None  # "image", "document", "audio"
    confidence: Optional[float] = None
    context: Dict[str, Any] = field(default_factory=dict)
    status: DraftStatus = DraftStatus.PENDING_APPROVAL
    generated_at: Optional[datetime] = None
    approved_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None

    def to_api_payload(self) -> Dict[str, Any]:
        """Convert to Evolution API message format."""
        # Ensure phone has WhatsApp suffix
        phone = self.to_phone
        if "@" not in phone:
            phone = f"{phone}@s.whatsapp.net"

        payload = {
            "number": phone,
            "textMessage": {
                "text": self.message
            }
        }

        return payload


@dataclass
class EvolutionInstance:
    """Evolution API instance model."""
    name: str
    status: str  # "open", "connecting", "close"
    qr_code: Optional[str] = None
    phone_number: Optional[str] = None
    profile_name: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.now)

    @classmethod
    def from_api_data(cls, data: Dict[str, Any]) -> "EvolutionInstance":
        """Create from Evolution API response."""
        instance_data = data.get("instance", {})

        return cls(
            name=instance_data.get("instanceName", ""),
            status=instance_data.get("state", "close"),
            phone_number=instance_data.get("owner"),
            profile_name=instance_data.get("profileName")
        )
