"""
IMAP Email Client

Supports Gmail, Yahoo, Outlook.com, and custom IMAP servers.
Provides the same Email model interface as MS Graph client.

Features:
- Folder listing and navigation
- Email fetching with pagination
- Search and filtering
- Attachment handling
- SSL/TLS support
"""

import os
import imaplib
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime
import logging

# Import from standard library email module
from email import message_from_bytes
from email.header import decode_header
from email.utils import parsedate_to_datetime
from email.message import Message as EmailMessage

from .models import Email, EmailAttachment, EmailImportance


logger = logging.getLogger(__name__)


class IMAPClient:
    """
    IMAP email client with unified Email model interface.

    Supports all standard IMAP servers:
    - Gmail (imap.gmail.com:993)
    - Outlook.com (outlook.office365.com:993)
    - Yahoo (imap.mail.yahoo.com:993)
    - Custom IMAP servers
    """

    def __init__(
        self,
        host: Optional[str] = None,
        port: Optional[int] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
        use_ssl: bool = True
    ):
        """
        Initialize IMAP client.

        Args:
            host: IMAP server hostname (or IMAP_HOST env var)
            port: IMAP server port (or IMAP_PORT env var, default 993)
            username: Email username (or IMAP_USERNAME env var)
            password: Email password/app password (or IMAP_PASSWORD env var)
            use_ssl: Use SSL/TLS connection (default True)
        """
        self.host = host or os.getenv("IMAP_HOST")
        self.port = port or int(os.getenv("IMAP_PORT", "993"))
        self.username = username or os.getenv("IMAP_USERNAME")
        self.password = password or os.getenv("IMAP_PASSWORD")
        self.use_ssl = use_ssl

        if not all([self.host, self.username, self.password]):
            raise ValueError(
                "IMAP credentials required: host, username, password "
                "(set via env vars IMAP_HOST, IMAP_USERNAME, IMAP_PASSWORD)"
            )

        self.connection: Optional[imaplib.IMAP4_SSL] = None
        self.current_folder: Optional[str] = None

        logger.info(f"IMAP client initialized for {self.host}:{self.port}")

    def connect(self):
        """Establish IMAP connection."""
        if self.connection is not None:
            return  # Already connected

        try:
            if self.use_ssl:
                self.connection = imaplib.IMAP4_SSL(self.host, self.port)
            else:
                self.connection = imaplib.IMAP4(self.host, self.port)

            # Login
            self.connection.login(self.username, self.password)

            logger.info(f"✅ Connected to IMAP server: {self.host}")

        except imaplib.IMAP4.error as e:
            logger.error(f"❌ IMAP connection failed: {e}")
            raise

    def disconnect(self):
        """Close IMAP connection."""
        if self.connection:
            try:
                self.connection.logout()
                logger.info("Disconnected from IMAP server")
            except Exception as e:
                logger.warning(f"Error during disconnect: {e}")
            finally:
                self.connection = None
                self.current_folder = None

    def __enter__(self):
        """Context manager entry."""
        self.connect()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.disconnect()

    def list_folders(self) -> List[str]:
        """
        List all folders in mailbox.

        Returns:
            List of folder names
        """
        self.connect()

        try:
            status, folders = self.connection.list()

            if status != "OK":
                raise Exception(f"Failed to list folders: {status}")

            folder_names = []
            for folder_bytes in folders:
                # Parse folder line: (\\HasNoChildren) "/" "INBOX"
                folder_str = folder_bytes.decode()
                parts = folder_str.split('"')
                if len(parts) >= 3:
                    folder_names.append(parts[-2])

            logger.info(f"Found {len(folder_names)} folders")
            return folder_names

        except Exception as e:
            logger.error(f"Error listing folders: {e}")
            raise

    def select_folder(self, folder: str = "INBOX") -> int:
        """
        Select a folder for operations.

        Args:
            folder: Folder name (default "INBOX")

        Returns:
            Number of messages in folder
        """
        self.connect()

        try:
            status, response = self.connection.select(folder, readonly=True)

            if status != "OK":
                raise Exception(f"Failed to select folder '{folder}': {status}")

            message_count = int(response[0])
            self.current_folder = folder

            logger.info(f"Selected folder '{folder}' ({message_count} messages)")
            return message_count

        except Exception as e:
            logger.error(f"Error selecting folder '{folder}': {e}")
            raise

    def get_emails(
        self,
        folder: str = "INBOX",
        limit: int = 10,
        skip: int = 0,
        search_criteria: str = "ALL"
    ) -> List[Email]:
        """
        Fetch emails from folder.

        Args:
            folder: Folder name (INBOX, Sent, etc.)
            limit: Maximum emails to return
            skip: Number of emails to skip (pagination)
            search_criteria: IMAP search criteria (default "ALL")

        Returns:
            List of Email objects
        """
        self.connect()
        message_count = self.select_folder(folder)

        try:
            # Search for messages using UID SEARCH (UIDs persist across sessions)
            status, message_ids = self.connection.uid('SEARCH', None, search_criteria)

            if status != "OK":
                raise Exception(f"Search failed: {status}")

            # Get UIDs (as bytes)
            all_ids = message_ids[0].split()

            # Apply pagination
            start_idx = max(0, len(all_ids) - skip - limit)
            end_idx = max(0, len(all_ids) - skip)
            paginated_ids = all_ids[start_idx:end_idx]

            # Reverse to get newest first
            paginated_ids = list(reversed(paginated_ids))

            logger.info(
                f"Fetching {len(paginated_ids)} emails from '{folder}' "
                f"(skip={skip}, limit={limit}, total={len(all_ids)})"
            )

            emails = []
            for uid in paginated_ids:
                try:
                    email_obj = self._fetch_email_by_uid(uid, folder)
                    if email_obj:
                        emails.append(email_obj)
                except Exception as e:
                    logger.warning(f"Failed to fetch message UID {uid}: {e}")
                    continue

            return emails

        except Exception as e:
            logger.error(f"Error fetching emails: {e}")
            raise

    def _fetch_email_by_uid(self, uid: bytes, folder: str) -> Optional[Email]:
        """
        Fetch and parse a single email message by UID.

        Args:
            uid: IMAP UID (unique identifier that persists across sessions)
            folder: Current folder name

        Returns:
            Email object or None if parsing fails
        """
        try:
            # Fetch email data using UID FETCH
            status, msg_data = self.connection.uid('FETCH', uid, "(RFC822)")

            if status != "OK":
                logger.warning(f"Failed to fetch message UID {uid}")
                return None

            # Parse email message
            raw_email = msg_data[0][1]
            msg = message_from_bytes(raw_email)

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

            # Determine importance (check for X-Priority or Importance headers)
            importance = EmailImportance.NORMAL
            priority_header = msg.get("X-Priority", "")
            if priority_header in ["1", "2"]:
                importance = EmailImportance.HIGH
            elif priority_header in ["4", "5"]:
                importance = EmailImportance.LOW

            # Create Email object - using UID as id for reliable fetching
            uid_str = uid.decode() if isinstance(uid, bytes) else str(uid)
            return Email(
                id=uid_str,  # UID for reliable fetching via UID FETCH
                message_id=message_id,  # RFC Message-ID header
                conversation_id="",  # IMAP doesn't have conversation threading
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
                sent_at=received_at,  # IMAP doesn't distinguish sent vs received
                importance=importance,
                has_attachments=len(attachments) > 0,
                attachments=attachments,
                in_reply_to=in_reply_to,
                folder=folder,
                source="imap",
                raw_data={"uid": uid_str, "rfc_message_id": message_id}
            )

        except Exception as e:
            logger.error(f"Error parsing email UID {uid}: {e}")
            return None

    def get_email_by_uid(self, uid: str, folder: str = "INBOX") -> Optional[Email]:
        """
        Fetch a single email by UID.

        This is the public interface for fetching an email by its UID,
        suitable for API endpoints like get_email_by_id.

        Args:
            uid: IMAP UID as string
            folder: Folder name (default "INBOX")

        Returns:
            Email object or None if not found
        """
        self.connect()
        self.select_folder(folder)

        try:
            uid_bytes = uid.encode() if isinstance(uid, str) else uid
            return self._fetch_email_by_uid(uid_bytes, folder)
        except Exception as e:
            logger.error(f"Error fetching email by UID {uid}: {e}")
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
        """
        Parse email address header into (email, name).

        Examples:
            "John Doe <john@example.com>" → ("john@example.com", "John Doe")
            "john@example.com" → ("john@example.com", "")
        """
        if not address_header:
            return "", ""

        if "<" in address_header and ">" in address_header:
            # Format: "Name <email@domain.com>"
            name = address_header.split("<")[0].strip().strip('"')
            email_addr = address_header.split("<")[1].split(">")[0].strip()
            return email_addr, name
        else:
            # Format: "email@domain.com"
            return address_header.strip(), ""

    def _parse_email_addresses(self, addresses_header: str) -> Tuple[List[str], List[str]]:
        """
        Parse comma-separated email addresses.

        Returns:
            Tuple of (email_addresses, names)
        """
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

    def _extract_body(self, msg: EmailMessage) -> Tuple[str, bool]:
        """
        Extract email body content.

        Returns:
            Tuple of (body_text, is_html)
        """
        body = ""
        is_html = False

        if msg.is_multipart():
            # Multi-part message (HTML + plain text)
            for part in msg.walk():
                content_type = part.get_content_type()
                content_disposition = str(part.get("Content-Disposition"))

                # Skip attachments
                if "attachment" in content_disposition:
                    continue

                if content_type == "text/plain" and not body:
                    body = part.get_payload(decode=True).decode(errors="replace")
                    is_html = False

                elif content_type == "text/html":
                    body = part.get_payload(decode=True).decode(errors="replace")
                    is_html = True  # Prefer HTML if available

        else:
            # Single-part message
            content_type = msg.get_content_type()
            body = msg.get_payload(decode=True).decode(errors="replace")
            is_html = content_type == "text/html"

        return body, is_html

    def _extract_attachments(self, msg: EmailMessage) -> List[EmailAttachment]:
        """Extract email attachments."""
        attachments = []

        if not msg.is_multipart():
            return attachments

        for part in msg.walk():
            content_disposition = str(part.get("Content-Disposition"))

            if "attachment" in content_disposition:
                filename = part.get_filename()
                if filename:
                    # Decode filename if MIME-encoded
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
    # FOLDER MANAGEMENT (for email categorization)
    # ============================================================================

    def create_folder(self, folder_path: str) -> bool:
        """
        Create IMAP folder.

        Args:
            folder_path: Folder path (e.g., "INBOX/Urgent", "INBOX/Client Inquiry")

        Returns:
            True if created successfully, False if already exists
        """
        self.connect()

        try:
            status, response = self.connection.create(folder_path)

            if status == "OK":
                logger.info(f"✅ Created folder: {folder_path}")
                return True
            else:
                logger.warning(f"Failed to create folder '{folder_path}': {status}")
                return False

        except imaplib.IMAP4.error as e:
            error_msg = str(e).lower()
            if "already exists" in error_msg or "duplicate" in error_msg:
                logger.info(f"Folder '{folder_path}' already exists")
                return False
            else:
                logger.error(f"Error creating folder '{folder_path}': {e}")
                raise

    def move_email(self, email_id: bytes, target_folder: str) -> bool:
        """
        Move email to target folder (for categorization).

        Args:
            email_id: IMAP message ID (bytes)
            target_folder: Destination folder path

        Returns:
            True if moved successfully
        """
        self.connect()

        try:
            # Copy to target folder
            status, response = self.connection.copy(email_id, target_folder)

            if status != "OK":
                logger.error(f"Failed to copy message to '{target_folder}': {status}")
                return False

            # Mark original as deleted
            status, response = self.connection.store(email_id, '+FLAGS', '\\Deleted')

            if status != "OK":
                logger.error(f"Failed to mark message as deleted: {status}")
                return False

            # Expunge to actually delete
            self.connection.expunge()

            logger.info(f"✅ Moved email to: {target_folder}")
            return True

        except Exception as e:
            logger.error(f"Error moving email: {e}")
            raise

    def create_draft_in_drafts(
        self,
        to: List[str],
        subject: str,
        body: str,
        cc: Optional[List[str]] = None,
        is_html: bool = True
    ) -> str:
        """
        Create draft message in Drafts folder.

        Args:
            to: List of recipient email addresses
            subject: Email subject
            body: Email body content
            cc: CC recipients (optional)
            is_html: Whether body is HTML

        Returns:
            Draft message ID (as string)
        """
        self.connect()

        try:
            # Build email message
            from email.mime.multipart import MIMEMultipart
            from email.mime.text import MIMEText

            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            msg['From'] = self.username
            msg['To'] = ', '.join(to)

            if cc:
                msg['Cc'] = ', '.join(cc)

            # Add body
            content_type = 'html' if is_html else 'plain'
            msg.attach(MIMEText(body, content_type))

            # Convert to bytes
            msg_bytes = msg.as_bytes()

            # Append to Drafts folder
            status, response = self.connection.append(
                'Drafts',
                '\\Draft',  # Flag as draft
                None,  # Internal date (None = now)
                msg_bytes
            )

            if status != "OK":
                raise Exception(f"Failed to create draft: {status}")

            # Extract message ID from response
            # Response format: [b'[APPENDUID 1234567890 123] Append completed']
            draft_id = response[0].decode() if response else "unknown"

            logger.info(f"✅ Draft created in Drafts folder: {draft_id}")
            return draft_id

        except Exception as e:
            logger.error(f"Error creating draft: {e}")
            raise

    def send_draft(self, draft_id: bytes) -> bool:
        """
        Send draft email.

        Note: IMAP doesn't have native "send draft" functionality.
        This method:
        1. Fetches the draft
        2. Sends via SMTP
        3. Moves to Sent folder
        4. Deletes from Drafts

        Args:
            draft_id: IMAP message ID of draft (bytes)

        Returns:
            True if sent successfully
        """
        self.connect()

        try:
            # Select Drafts folder
            self.select_folder("Drafts")

            # Fetch draft
            status, msg_data = self.connection.fetch(draft_id, "(RFC822)")

            if status != "OK":
                logger.error(f"Failed to fetch draft: {status}")
                return False

            raw_email = msg_data[0][1]

            # Send via SMTP (requires SMTP configuration)
            import smtplib
            smtp_host = os.getenv("SMTP_HOST", self.host.replace("imap", "smtp"))
            smtp_port = int(os.getenv("SMTP_PORT", "587"))

            with smtplib.SMTP(smtp_host, smtp_port) as smtp:
                smtp.starttls()
                smtp.login(self.username, self.password)
                smtp.send_message(message_from_bytes(raw_email))

            # Copy to Sent folder
            self.connection.copy(draft_id, "Sent")

            # Delete from Drafts
            self.connection.store(draft_id, '+FLAGS', '\\Deleted')
            self.connection.expunge()

            logger.info(f"✅ Draft sent successfully")
            return True

        except Exception as e:
            logger.error(f"Error sending draft: {e}")
            raise

    def setup_category_folders(self, categories: List[str]) -> Dict[str, bool]:
        """
        Create category folders for email organization.

        Args:
            categories: List of category names (e.g., ["Urgent", "Client Inquiry"])

        Returns:
            Dict mapping category names to creation success status
        """
        self.connect()

        results = {}

        for category in categories:
            # Create folder under INBOX
            folder_path = f"INBOX/{category}"

            try:
                created = self.create_folder(folder_path)
                results[category] = created
            except Exception as e:
                logger.error(f"Failed to create folder for '{category}': {e}")
                results[category] = False

        created_count = sum(results.values())
        logger.info(
            f"✅ Category folder setup complete: "
            f"{created_count} created, {len(categories) - created_count} already existed"
        )

        return results


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

def get_imap_client(
    host: Optional[str] = None,
    port: Optional[int] = None,
    username: Optional[str] = None,
    password: Optional[str] = None
) -> IMAPClient:
    """Get an IMAP client instance (use as context manager)."""
    return IMAPClient(host=host, port=port, username=username, password=password)
