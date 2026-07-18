"""
POP3 Email Client

Legacy protocol support for POP3-only email servers.
Provides the same Email model interface as MS Graph and IMAP clients.

Limitations:
- POP3 only supports inbox retrieval (no folder support)
- Messages are typically deleted from server after retrieval
- No search/filtering support
- Limited metadata compared to IMAP

Features:
- Basic email fetching
- Attachment handling
- SSL/TLS support
- Leave messages on server option
"""

import os
import poplib
import email
from email.header import decode_header
from email.utils import parsedate_to_datetime
from typing import List, Optional, Tuple
from datetime import datetime
import logging

from .models import Email, EmailAttachment, EmailImportance


logger = logging.getLogger(__name__)


class POP3Client:
    """
    POP3 email client with unified Email model interface.

    Note: POP3 is a legacy protocol with limited features.
    Use IMAP when possible for better functionality.
    """

    def __init__(
        self,
        host: Optional[str] = None,
        port: Optional[int] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
        use_ssl: bool = True,
        leave_on_server: bool = True
    ):
        """
        Initialize POP3 client.

        Args:
            host: POP3 server hostname (or POP3_HOST env var)
            port: POP3 server port (or POP3_PORT env var, default 995)
            username: Email username (or POP3_USERNAME env var)
            password: Email password (or POP3_PASSWORD env var)
            use_ssl: Use SSL/TLS connection (default True)
            leave_on_server: Don't delete messages after retrieval (default True)
        """
        self.host = host or os.getenv("POP3_HOST")
        self.port = port or int(os.getenv("POP3_PORT", "995"))
        self.username = username or os.getenv("POP3_USERNAME")
        self.password = password or os.getenv("POP3_PASSWORD")
        self.use_ssl = use_ssl
        self.leave_on_server = leave_on_server

        if not all([self.host, self.username, self.password]):
            raise ValueError(
                "POP3 credentials required: host, username, password "
                "(set via env vars POP3_HOST, POP3_USERNAME, POP3_PASSWORD)"
            )

        self.connection: Optional[poplib.POP3_SSL] = None

        logger.info(f"POP3 client initialized for {self.host}:{self.port}")

    def connect(self):
        """Establish POP3 connection."""
        if self.connection is not None:
            return  # Already connected

        try:
            if self.use_ssl:
                self.connection = poplib.POP3_SSL(self.host, self.port)
            else:
                self.connection = poplib.POP3(self.host, self.port)

            # Login
            self.connection.user(self.username)
            self.connection.pass_(self.password)

            logger.info(f"✅ Connected to POP3 server: {self.host}")

        except poplib.error_proto as e:
            logger.error(f"❌ POP3 connection failed: {e}")
            raise

    def disconnect(self):
        """Close POP3 connection."""
        if self.connection:
            try:
                self.connection.quit()
                logger.info("Disconnected from POP3 server")
            except Exception as e:
                logger.warning(f"Error during disconnect: {e}")
            finally:
                self.connection = None

    def __enter__(self):
        """Context manager entry."""
        self.connect()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.disconnect()

    def get_emails(
        self,
        limit: int = 10,
        skip: int = 0
    ) -> List[Email]:
        """
        Fetch emails from POP3 server.

        Note: POP3 only supports inbox retrieval.

        Args:
            limit: Maximum emails to return
            skip: Number of emails to skip (pagination)

        Returns:
            List of Email objects
        """
        self.connect()

        try:
            # Get mailbox status
            message_count, mailbox_size = self.connection.stat()

            logger.info(
                f"📥 POP3 mailbox: {message_count} messages "
                f"({mailbox_size / 1024 / 1024:.2f} MB)"
            )

            # Apply pagination
            start_idx = max(1, message_count - skip - limit + 1)
            end_idx = max(1, message_count - skip)

            logger.info(
                f"Fetching messages {start_idx} to {end_idx} "
                f"(skip={skip}, limit={limit})"
            )

            emails = []
            for msg_num in range(start_idx, end_idx + 1):
                try:
                    email_obj = self._fetch_email(msg_num)
                    if email_obj:
                        emails.append(email_obj)
                except Exception as e:
                    logger.warning(f"Failed to fetch message {msg_num}: {e}")
                    continue

            # Reverse to get newest first
            emails.reverse()

            return emails

        except Exception as e:
            logger.error(f"Error fetching emails: {e}")
            raise

    def _fetch_email(self, msg_num: int) -> Optional[Email]:
        """
        Fetch and parse a single email message.

        Args:
            msg_num: POP3 message number (1-indexed)

        Returns:
            Email object or None if parsing fails
        """
        try:
            # Fetch email data
            response, lines, octets = self.connection.retr(msg_num)

            # Join lines and parse
            raw_email = b"\n".join(lines)
            msg = email.message_from_bytes(raw_email)

            # Extract headers
            message_id = self._decode_header(msg.get("Message-ID", ""))
            in_reply_to = self._decode_header(msg.get("In-Reply-To", ""))
            subject = self._decode_header(msg.get("Subject", ""))

            # Extract sender
            from_header = self._decode_header(msg.get("From", ""))
            sender, sender_name = self._parse_email_address(from_header)

            # Extract recipients
            to_header = self._decode_header(msg.get("To", ""))
            recipients, recipient_names = self._parse_email_addresses(to_header)

            cc_header = self._decode_header(msg.get("Cc", ""))
            cc_recipients, _ = self._parse_email_addresses(cc_header)

            # Extract dates
            date_str = msg.get("Date")
            received_at = None
            if date_str:
                try:
                    received_at = parsedate_to_datetime(date_str)
                except Exception as e:
                    logger.warning(f"Failed to parse date '{date_str}': {e}")

            # Extract body
            body, is_html = self._extract_body(msg)
            body_preview = body[:200] if body else ""

            # Extract attachments
            attachments = self._extract_attachments(msg)

            # Determine importance
            importance = EmailImportance.NORMAL
            priority_header = msg.get("X-Priority", "")
            if priority_header in ["1", "2"]:
                importance = EmailImportance.HIGH
            elif priority_header in ["4", "5"]:
                importance = EmailImportance.LOW

            # Create Email object
            return Email(
                id=str(msg_num),
                message_id=message_id,
                conversation_id="",  # POP3 doesn't support threading
                sender=sender,
                sender_name=sender_name,
                recipients=recipients,
                recipient_names=recipient_names,
                cc_recipients=cc_recipients,
                subject=subject,
                body=body,
                body_preview=body_preview,
                is_html=is_html,
                received_at=received_at,
                sent_at=received_at,
                importance=importance,
                has_attachments=len(attachments) > 0,
                attachments=attachments,
                in_reply_to=in_reply_to,
                folder="inbox",  # POP3 only has inbox
                source="pop3",
                raw_data={"pop3_message_num": msg_num}
            )

        except Exception as e:
            logger.error(f"Error parsing email {msg_num}: {e}")
            return None

    def _decode_header(self, header_value: str) -> str:
        """Decode MIME-encoded email header."""
        if not header_value:
            return ""

        decoded_parts = []
        for part, encoding in decode_header(header_value):
            if isinstance(part, bytes):
                decoded_parts.append(part.decode(encoding or "utf-8", errors="replace"))
            else:
                decoded_parts.append(part)

        return " ".join(decoded_parts)

    def _parse_email_address(self, address_header: str) -> Tuple[str, str]:
        """Parse email address header into (email, name)."""
        if not address_header:
            return "", ""

        if "<" in address_header and ">" in address_header:
            name = address_header.split("<")[0].strip().strip('"')
            email_addr = address_header.split("<")[1].split(">")[0].strip()
            return email_addr, name
        else:
            return address_header.strip(), ""

    def _parse_email_addresses(self, addresses_header: str) -> Tuple[List[str], List[str]]:
        """Parse comma-separated email addresses."""
        if not addresses_header:
            return [], []

        addresses = []
        names = []

        for addr in addresses_header.split(","):
            email_addr, name = self._parse_email_address(addr.strip())
            if email_addr:
                addresses.append(email_addr)
                names.append(name)

        return addresses, names

    def _extract_body(self, msg: email.message.Message) -> Tuple[str, bool]:
        """Extract email body content."""
        body = ""
        is_html = False

        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                content_disposition = str(part.get("Content-Disposition"))

                if "attachment" in content_disposition:
                    continue

                if content_type == "text/plain" and not body:
                    body = part.get_payload(decode=True).decode(errors="replace")
                    is_html = False

                elif content_type == "text/html":
                    body = part.get_payload(decode=True).decode(errors="replace")
                    is_html = True

        else:
            content_type = msg.get_content_type()
            body = msg.get_payload(decode=True).decode(errors="replace")
            is_html = content_type == "text/html"

        return body, is_html

    def _extract_attachments(self, msg: email.message.Message) -> List[EmailAttachment]:
        """Extract email attachments."""
        attachments = []

        if not msg.is_multipart():
            return attachments

        for part in msg.walk():
            content_disposition = str(part.get("Content-Disposition"))

            if "attachment" in content_disposition:
                filename = part.get_filename()
                if filename:
                    filename = self._decode_header(filename)

                    attachment = EmailAttachment(
                        id=f"attachment_{len(attachments)}",
                        filename=filename,
                        content_type=part.get_content_type(),
                        size_bytes=len(part.get_payload(decode=True) or b""),
                        content=part.get_payload(decode=True)
                    )
                    attachments.append(attachment)

        return attachments


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

def get_pop3_client(
    host: Optional[str] = None,
    port: Optional[int] = None,
    username: Optional[str] = None,
    password: Optional[str] = None
) -> POP3Client:
    """Get a POP3 client instance (use as context manager)."""
    return POP3Client(host=host, port=port, username=username, password=password)
