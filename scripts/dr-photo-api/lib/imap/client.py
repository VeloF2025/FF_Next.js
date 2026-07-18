"""
IMAP/SMTP client for universal email access.

Fallback email client when MS Graph is not available.
"""

import os
import email
import logging
import smtplib
from typing import List, Optional, Tuple
from datetime import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from pathlib import Path
import imaplib

from lib.msgraph.models import Email, EmailAttachment, EmailDraft, EmailImportance


logger = logging.getLogger(__name__)


class IMAPClient:
    """
    IMAP/SMTP client for universal email access.

    Features:
    - IMAP for receiving emails
    - SMTP for sending emails
    - Basic authentication (username/password)
    - Folder support (INBOX, Sent, etc.)
    """

    def __init__(
        self,
        imap_server: Optional[str] = None,
        imap_port: int = 993,
        smtp_server: Optional[str] = None,
        smtp_port: int = 587,
        username: Optional[str] = None,
        password: Optional[str] = None,
        use_ssl: bool = True
    ):
        """
        Initialize IMAP client.

        Args:
            imap_server: IMAP server address (or from IMAP_SERVER env)
            imap_port: IMAP port (default: 993 for SSL)
            smtp_server: SMTP server address (or from SMTP_SERVER env)
            smtp_port: SMTP port (default: 587 for TLS)
            username: Email username (or from EMAIL_USER env)
            password: Email password (or from EMAIL_PASSWORD env)
            use_ssl: Use SSL for IMAP (default: True)
        """
        self.imap_server = imap_server or os.getenv("IMAP_SERVER")
        self.imap_port = int(os.getenv("IMAP_PORT", imap_port))
        self.smtp_server = smtp_server or os.getenv("SMTP_SERVER")
        self.smtp_port = int(os.getenv("SMTP_PORT", smtp_port))
        self.username = username or os.getenv("EMAIL_USER")
        self.password = password or os.getenv("EMAIL_PASSWORD")
        self.use_ssl = use_ssl

        if not all([self.imap_server, self.smtp_server, self.username, self.password]):
            raise ValueError(
                "Missing required credentials. Set IMAP_SERVER, SMTP_SERVER, "
                "EMAIL_USER, EMAIL_PASSWORD in environment or pass to constructor."
            )

        self.imap_connection: Optional[imaplib.IMAP4_SSL] = None

        logger.info(f"IMAPClient initialized for {self.username}")

    async def connect(self) -> None:
        """Connect to IMAP server and authenticate."""
        logger.info(f"Connecting to IMAP server {self.imap_server}:{self.imap_port}...")

        try:
            if self.use_ssl:
                self.imap_connection = imaplib.IMAP4_SSL(self.imap_server, self.imap_port)
            else:
                self.imap_connection = imaplib.IMAP4(self.imap_server, self.imap_port)

            # Login
            self.imap_connection.login(self.username, self.password)

            logger.info("✅ Connected to IMAP server")

        except Exception as e:
            logger.error(f"IMAP connection failed: {e}")
            raise

    async def disconnect(self) -> None:
        """Disconnect from IMAP server."""
        if self.imap_connection:
            try:
                self.imap_connection.logout()
                logger.info("Disconnected from IMAP server")
            except Exception as e:
                logger.error(f"IMAP disconnect error: {e}")
            finally:
                self.imap_connection = None

    async def get_emails(
        self,
        folder: str = "INBOX",
        limit: int = 10,
        unread_only: bool = False,
        skip: int = 0
    ) -> List[Email]:
        """
        Fetch emails from folder.

        Args:
            folder: Folder name ("INBOX", "Sent", etc.)
            limit: Maximum emails to return
            unread_only: Filter for unread emails only
            skip: Number of emails to skip (pagination)

        Returns:
            List of Email objects
        """
        if not self.imap_connection:
            raise RuntimeError("Not connected to IMAP server. Call connect() first.")

        logger.info(f"Fetching {limit} emails from {folder}...")

        # Select folder
        status, count = self.imap_connection.select(folder, readonly=True)
        if status != "OK":
            raise RuntimeError(f"Failed to select folder {folder}")

        # Build search criteria
        search_criteria = "UNSEEN" if unread_only else "ALL"

        # Search for messages using UID (not sequence numbers)
        status, message_ids_data = self.imap_connection.uid("SEARCH", None, search_criteria)
        if status != "OK":
            raise RuntimeError(f"Failed to search messages")

        message_uids = message_ids_data[0].split()

        # Reverse to get newest first
        message_uids = list(reversed(message_uids))

        # Apply pagination
        start = skip
        end = start + limit
        message_uids = message_uids[start:end]

        emails = []
        for uid in message_uids:
            try:
                # Fetch message by UID (not sequence number)
                status, msg_data = self.imap_connection.uid("FETCH", uid, "(RFC822)")
                if status != "OK" or not msg_data or msg_data[0] is None:
                    logger.warning(f"Failed to fetch message UID {uid}")
                    continue

                # Parse email
                raw_email = msg_data[0][1]
                email_message = email.message_from_bytes(raw_email)

                # Convert to Email object using UID as the ID
                email_obj = self._parse_email(email_message, uid.decode())
                emails.append(email_obj)

            except Exception as e:
                logger.error(f"Error parsing email UID {uid}: {e}")
                continue

        logger.info(f"✅ Fetched {len(emails)} emails")
        return emails

    def _parse_email(self, email_message: email.message.Message, msg_id: str) -> Email:
        """
        Parse email.message.Message to Email object.

        Args:
            email_message: Python email.message.Message object
            msg_id: Message ID

        Returns:
            Email object
        """
        # Extract sender
        sender_str = email_message.get("From", "")
        sender, sender_name = email.utils.parseaddr(sender_str)

        # Extract recipients
        to_str = email_message.get("To", "")
        recipients = [addr[1] for addr in email.utils.getaddresses([to_str])]
        recipient_names = [addr[0] for addr in email.utils.getaddresses([to_str])]

        # Extract CC
        cc_str = email_message.get("Cc", "")
        cc_recipients = [addr[1] for addr in email.utils.getaddresses([cc_str])] if cc_str else []

        # Extract subject
        subject = email_message.get("Subject", "")

        # Extract date
        date_str = email_message.get("Date", "")
        received_at = None
        if date_str:
            try:
                date_tuple = email.utils.parsedate_tz(date_str)
                if date_tuple:
                    timestamp = email.utils.mktime_tz(date_tuple)
                    received_at = datetime.fromtimestamp(timestamp)
            except Exception as e:
                logger.warning(f"Failed to parse date: {e}")

        # Extract body
        body, is_html = self._extract_body(email_message)

        # Check for attachments
        has_attachments = any(part.get_content_disposition() == "attachment" for part in email_message.walk())

        # Create Email object
        return Email(
            id=msg_id,
            message_id=email_message.get("Message-ID", ""),
            conversation_id="",  # IMAP doesn't have conversation threading
            sender=sender,
            sender_name=sender_name or sender,
            recipients=recipients,
            recipient_names=recipient_names,
            cc_recipients=cc_recipients,
            subject=subject,
            body=body,
            body_preview=body[:200] if body else "",
            is_html=is_html,
            received_at=received_at,
            sent_at=received_at,  # IMAP doesn't distinguish
            has_attachments=has_attachments,
            folder="INBOX"
        )

    def _extract_body(self, email_message: email.message.Message) -> Tuple[str, bool]:
        """
        Extract email body content.

        Args:
            email_message: Python email.message.Message object

        Returns:
            Tuple of (body_text, is_html)
        """
        body = ""
        is_html = False

        # Try to get HTML body first
        if email_message.is_multipart():
            for part in email_message.walk():
                content_type = part.get_content_type()
                content_disposition = part.get_content_disposition()

                # Skip attachments
                if content_disposition == "attachment":
                    continue

                if content_type == "text/html":
                    try:
                        body = part.get_payload(decode=True).decode()
                        is_html = True
                        break
                    except Exception as e:
                        logger.warning(f"Failed to decode HTML body: {e}")

                elif content_type == "text/plain" and not body:
                    try:
                        body = part.get_payload(decode=True).decode()
                        is_html = False
                    except Exception as e:
                        logger.warning(f"Failed to decode text body: {e}")

        else:
            # Single part message
            try:
                body = email_message.get_payload(decode=True).decode()
                is_html = email_message.get_content_type() == "text/html"
            except Exception as e:
                logger.warning(f"Failed to decode body: {e}")
                body = ""

        return body, is_html

    async def send_email(
        self,
        to: List[str],
        subject: str,
        body: str,
        cc: Optional[List[str]] = None,
        bcc: Optional[List[str]] = None,
        is_html: bool = True,
        attachments: Optional[List[Path]] = None
    ) -> None:
        """
        Send email via SMTP.

        Args:
            to: List of recipient email addresses
            subject: Email subject
            body: Email body content
            cc: CC recipients (optional)
            bcc: BCC recipients (optional)
            is_html: Whether body is HTML
            attachments: List of file paths to attach (optional)
        """
        logger.info(f"Sending email to {', '.join(to)}...")

        # Create message
        msg = MIMEMultipart()
        msg["From"] = self.username
        msg["To"] = ", ".join(to)
        msg["Subject"] = subject

        if cc:
            msg["Cc"] = ", ".join(cc)

        # Attach body
        body_type = "html" if is_html else "plain"
        msg.attach(MIMEText(body, body_type))

        # Attach files
        if attachments:
            for file_path in attachments:
                try:
                    with open(file_path, "rb") as f:
                        part = MIMEBase("application", "octet-stream")
                        part.set_payload(f.read())
                        encoders.encode_base64(part)
                        part.add_header(
                            "Content-Disposition",
                            f"attachment; filename={file_path.name}"
                        )
                        msg.attach(part)
                except Exception as e:
                    logger.error(f"Failed to attach file {file_path}: {e}")

        # Send via SMTP
        try:
            with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
                server.starttls()  # Enable TLS
                server.login(self.username, self.password)

                # Combine all recipients
                all_recipients = to + (cc or []) + (bcc or [])

                server.sendmail(self.username, all_recipients, msg.as_string())

            logger.info(f"✅ Email sent")

        except Exception as e:
            logger.error(f"Failed to send email: {e}")
            raise

    async def mark_as_read(self, uid: str, is_read: bool = True) -> None:
        """
        Mark email as read/unread using UID.

        Args:
            uid: IMAP message UID
            is_read: True to mark as read, False for unread
        """
        if not self.imap_connection:
            raise RuntimeError("Not connected to IMAP server. Call connect() first.")

        logger.info(f"Marking email UID {uid} as {'read' if is_read else 'unread'}...")

        try:
            flag = "\\Seen"
            uid_bytes = uid.encode() if isinstance(uid, str) else uid
            if is_read:
                self.imap_connection.uid("STORE", uid_bytes, "+FLAGS", flag)
            else:
                self.imap_connection.uid("STORE", uid_bytes, "-FLAGS", flag)

            logger.info(f"✅ Email marked as {'read' if is_read else 'unread'}")

        except Exception as e:
            logger.error(f"Failed to mark email: {e}")
            raise

    async def delete_email(self, uid: str) -> None:
        """
        Delete email (mark for deletion) using UID.

        Args:
            uid: IMAP message UID
        """
        if not self.imap_connection:
            raise RuntimeError("Not connected to IMAP server. Call connect() first.")

        logger.info(f"Deleting email UID {uid}...")

        try:
            uid_bytes = uid.encode() if isinstance(uid, str) else uid
            self.imap_connection.uid("STORE", uid_bytes, "+FLAGS", "\\Deleted")
            self.imap_connection.expunge()  # Permanently remove

            logger.info(f"✅ Email deleted")

        except Exception as e:
            logger.error(f"Failed to delete email: {e}")
            raise

    async def search_emails(
        self,
        query: str,
        folder: str = "INBOX",
        limit: int = 10
    ) -> List[Email]:
        """
        Search emails by subject/from.

        Note: IMAP search is limited compared to MS Graph.

        Args:
            query: Search keyword
            folder: Folder to search in
            limit: Maximum results

        Returns:
            List of matching Email objects
        """
        if not self.imap_connection:
            raise RuntimeError("Not connected to IMAP server. Call connect() first.")

        logger.info(f"Searching emails for: {query}")

        # Select folder
        status, count = self.imap_connection.select(folder, readonly=True)
        if status != "OK":
            raise RuntimeError(f"Failed to select folder {folder}")

        # Search by subject using UID (not sequence numbers)
        search_criteria = f'(OR SUBJECT "{query}" FROM "{query}")'
        status, message_ids_data = self.imap_connection.uid("SEARCH", None, search_criteria)

        if status != "OK":
            logger.warning("IMAP search failed, falling back to simple search")
            return []

        message_uids = message_ids_data[0].split()
        message_uids = list(reversed(message_uids))[:limit]  # Newest first

        emails = []
        for uid in message_uids:
            try:
                status, msg_data = self.imap_connection.uid("FETCH", uid, "(RFC822)")
                if status == "OK" and msg_data and msg_data[0] is not None:
                    raw_email = msg_data[0][1]
                    email_message = email.message_from_bytes(raw_email)
                    email_obj = self._parse_email(email_message, uid.decode())
                    emails.append(email_obj)
            except Exception as e:
                logger.error(f"Error parsing email UID {uid}: {e}")

        logger.info(f"✅ Found {len(emails)} emails")
        return emails

    async def get_email_by_uid(self, uid: str, folder: str = "INBOX") -> Optional[Email]:
        """
        Fetch a single email by its UID.

        Args:
            uid: The IMAP UID of the email to fetch
            folder: Folder name (default "INBOX")

        Returns:
            Email object or None if not found
        """
        if not self.imap_connection:
            await self.connect()

        logger.info(f"Fetching email by UID: {uid} from {folder}")

        try:
            # Select folder
            status, count = self.imap_connection.select(folder, readonly=True)
            if status != "OK":
                logger.error(f"Failed to select folder {folder}")
                return None

            # Use UID FETCH command - this fetches by UID instead of sequence number
            uid_bytes = uid.encode() if isinstance(uid, str) else uid
            status, msg_data = self.imap_connection.uid("FETCH", uid_bytes, "(RFC822)")

            if status != "OK" or not msg_data or msg_data[0] is None:
                logger.warning(f"Email UID {uid} not found or fetch failed")
                return None

            # Parse email
            raw_email = msg_data[0][1]
            email_message = email.message_from_bytes(raw_email)

            # Convert to Email object using the UID as the ID
            email_obj = self._parse_email(email_message, uid)

            logger.info(f"✅ Fetched email: {email_obj.subject[:50]}...")
            return email_obj

        except Exception as e:
            logger.error(f"Error fetching email by UID {uid}: {e}")
            return None
