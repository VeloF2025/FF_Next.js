"""
Microsoft Graph API client for email operations.

Provides Office 365 email integration with full CRUD operations.
"""

import os
import logging
from typing import List, Optional, Dict, Any
from pathlib import Path
import httpx

from .auth import MSGraphAuth, MSGraphAuthError
from .models import (
    Email, EmailAttachment, EmailDraft, EmailImportance,
    SharePointSite, SharePointDrive, SharePointItem, DeltaQueryResult
)


logger = logging.getLogger(__name__)


class MSGraphClient:
    """
    Microsoft Graph API client for email operations.

    Features:
    - Read emails from inbox/folders
    - Send emails with attachments
    - Draft management
    - Attachment handling
    - Search and filtering
    """

    BASE_URL = "https://graph.microsoft.com/v1.0"

    def __init__(
        self,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
        tenant_id: Optional[str] = None,
        user_email: Optional[str] = None
    ):
        """
        Initialize MS Graph client.

        Args:
            client_id: Azure AD app client ID (or from MS_GRAPH_CLIENT_ID env)
            client_secret: Azure AD client secret (or from MS_GRAPH_CLIENT_SECRET env)
            tenant_id: Azure AD tenant ID (or from MS_GRAPH_TENANT_ID env)
            user_email: User email address (or from MS_GRAPH_USER_EMAIL env)
        """
        self.client_id = client_id or os.getenv("MS_GRAPH_CLIENT_ID")
        self.client_secret = client_secret or os.getenv("MS_GRAPH_CLIENT_SECRET")
        self.tenant_id = tenant_id or os.getenv("MS_GRAPH_TENANT_ID")
        self.user_email = user_email or os.getenv("MS_GRAPH_USER_EMAIL")

        if not all([self.client_id, self.client_secret, self.tenant_id]):
            raise MSGraphAuthError(
                "Missing required credentials. Set MS_GRAPH_CLIENT_ID, "
                "MS_GRAPH_CLIENT_SECRET, MS_GRAPH_TENANT_ID in environment or pass to constructor."
            )

        # Initialize authentication
        self.auth = MSGraphAuth(
            client_id=self.client_id,
            client_secret=self.client_secret,
            tenant_id=self.tenant_id
        )

        self._http_client: Optional[httpx.AsyncClient] = None

        logger.info(f"MSGraphClient initialized for user: {self.user_email}")

    async def __aenter__(self):
        """Async context manager entry."""
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.disconnect()

    async def connect(self) -> None:
        """Initialize connection and authenticate."""
        logger.info("Connecting to MS Graph API...")

        # Get access token
        await self.auth.get_access_token()

        # Initialize HTTP client
        self._http_client = httpx.AsyncClient(
            base_url=self.BASE_URL,
            timeout=httpx.Timeout(30.0)
        )

        logger.info("✅ Connected to MS Graph API")

    async def disconnect(self) -> None:
        """Close HTTP client."""
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None
        logger.info("Disconnected from MS Graph API")

    async def _request(
        self,
        method: str,
        endpoint: str,
        expect_json: bool = True,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Make authenticated API request.

        Args:
            method: HTTP method (GET, POST, etc.)
            endpoint: API endpoint (e.g., "/me/messages")
            expect_json: Whether to expect JSON response (default True)
            **kwargs: Additional arguments for httpx request

        Returns:
            JSON response data or empty dict if no content

        Raises:
            httpx.HTTPError: If request fails
        """
        if not self._http_client:
            raise RuntimeError("Client not connected. Call connect() first.")

        # Ensure fresh access token
        await self.auth.get_access_token()

        # Add auth header
        headers = kwargs.get("headers", {})
        headers.update(self.auth.get_auth_header())
        kwargs["headers"] = headers

        # Make request
        response = await self._http_client.request(method, endpoint, **kwargs)
        response.raise_for_status()

        # Handle empty responses (202 Accepted, 204 No Content)
        if response.status_code in (202, 204) or not response.content:
            return {}

        if expect_json:
            return response.json()
        return {}

    async def get_emails(
        self,
        folder: str = "inbox",
        limit: int = 10,
        unread_only: bool = False,
        skip: int = 0
    ) -> List[Email]:
        """
        Fetch emails from folder.

        Args:
            folder: Folder name ("inbox", "sentitems", "drafts", etc.)
            limit: Maximum emails to return
            unread_only: Filter for unread emails only
            skip: Number of emails to skip (pagination)

        Returns:
            List of Email objects
        """
        logger.info(f"Fetching {limit} emails from {folder}...")

        # Build endpoint
        if self.user_email:
            endpoint = f"/users/{self.user_email}/mailFolders/{folder}/messages"
        else:
            endpoint = f"/me/mailFolders/{folder}/messages"

        # Build query parameters
        params = {
            "$top": limit,
            "$skip": skip,
            "$orderby": "receivedDateTime desc",
            "$select": "id,subject,from,toRecipients,ccRecipients,bccRecipients,"
                      "receivedDateTime,sentDateTime,isRead,importance,hasAttachments,"
                      "body,bodyPreview,conversationId,internetMessageId,categories"
        }

        if unread_only:
            params["$filter"] = "isRead eq false"

        # Fetch messages
        response = await self._request("GET", endpoint, params=params)
        messages = response.get("value", [])

        # Convert to Email objects
        emails = [Email.from_graph_data(msg) for msg in messages]

        # Set folder field for all emails
        for email in emails:
            email.folder = folder

        logger.info(f"✅ Fetched {len(emails)} emails from {folder}")
        return emails

    async def get_email(self, message_id: str) -> Email:
        """
        Get specific email by ID.

        Args:
            message_id: MS Graph message ID

        Returns:
            Email object
        """
        logger.info(f"Fetching email {message_id}...")

        if self.user_email:
            endpoint = f"/users/{self.user_email}/messages/{message_id}"
        else:
            endpoint = f"/me/messages/{message_id}"

        response = await self._request("GET", endpoint)
        email = Email.from_graph_data(response)

        logger.info(f"✅ Fetched email: {email.subject}")
        return email

    async def get_attachments(self, message_id: str) -> List[EmailAttachment]:
        """
        Get all attachments for an email.

        Args:
            message_id: MS Graph message ID

        Returns:
            List of EmailAttachment objects
        """
        logger.info(f"Fetching attachments for email {message_id}...")

        if self.user_email:
            endpoint = f"/users/{self.user_email}/messages/{message_id}/attachments"
        else:
            endpoint = f"/me/messages/{message_id}/attachments"

        response = await self._request("GET", endpoint)
        attachments_data = response.get("value", [])

        attachments = [EmailAttachment.from_graph_data(att) for att in attachments_data]

        logger.info(f"✅ Fetched {len(attachments)} attachments")
        return attachments

    async def download_attachment(
        self,
        message_id: str,
        attachment_id: str,
        save_path: Optional[Path] = None
    ) -> bytes:
        """
        Download attachment content.

        Args:
            message_id: MS Graph message ID
            attachment_id: Attachment ID
            save_path: Optional path to save file

        Returns:
            Attachment content bytes
        """
        logger.info(f"Downloading attachment {attachment_id}...")

        if self.user_email:
            endpoint = f"/users/{self.user_email}/messages/{message_id}/attachments/{attachment_id}"
        else:
            endpoint = f"/me/messages/{message_id}/attachments/{attachment_id}"

        response = await self._request("GET", endpoint)

        # MS Graph returns attachments with content encoded in base64
        import base64
        content_bytes = base64.b64decode(response.get("contentBytes", ""))

        if save_path:
            save_path.write_bytes(content_bytes)
            logger.info(f"✅ Saved attachment to {save_path}")

        return content_bytes

    async def create_draft(self, draft: EmailDraft) -> str:
        """
        Create email draft.

        Args:
            draft: EmailDraft object

        Returns:
            Draft message ID
        """
        logger.info(f"Creating draft: {draft.subject}")

        if self.user_email:
            endpoint = f"/users/{self.user_email}/messages"
        else:
            endpoint = f"/me/messages"

        message_data = draft.to_graph_message()

        response = await self._request("POST", endpoint, json=message_data)
        draft_id = response.get("id")

        logger.info(f"✅ Draft created: {draft_id}")
        return draft_id

    async def send_draft(self, draft_id: str) -> None:
        """
        Send existing draft.

        Args:
            draft_id: MS Graph draft message ID
        """
        logger.info(f"Sending draft {draft_id}...")

        if self.user_email:
            endpoint = f"/users/{self.user_email}/messages/{draft_id}/send"
        else:
            endpoint = f"/me/messages/{draft_id}/send"

        await self._request("POST", endpoint)

        logger.info(f"✅ Draft sent")

    async def send_email(
        self,
        to: List[str],
        subject: str,
        body: str,
        cc: Optional[List[str]] = None,
        bcc: Optional[List[str]] = None,
        is_html: bool = True,
        importance: EmailImportance = EmailImportance.NORMAL,
        in_reply_to: Optional[str] = None,
        attachments: Optional[List[Path]] = None,
        from_address: Optional[str] = None,
        from_name: Optional[str] = None,
        send_as_shared_mailbox: Optional[str] = None
    ) -> None:
        """
        Send email directly (bypasses draft creation).

        Args:
            to: List of recipient email addresses
            subject: Email subject
            body: Email body content
            cc: CC recipients (optional)
            bcc: BCC recipients (optional)
            is_html: Whether body is HTML
            importance: Email importance level
            in_reply_to: Message ID if replying
            attachments: List of file paths to attach (optional)
            from_address: Optional sender address (alias) to send from.
                         Must be configured as an alias/shared mailbox in M365.
            from_name: Optional display name for the from address (e.g., "BOSS").
            send_as_shared_mailbox: Optional shared mailbox email address to send from.
                         Uses the shared mailbox endpoint directly. Requires Send As permission.
        """
        logger.info(f"Sending email to {', '.join(to)}...")

        # Create draft object
        draft = EmailDraft(
            to_recipients=to,
            cc_recipients=cc or [],
            bcc_recipients=bcc or [],
            subject=subject,
            body=body,
            is_html=is_html,
            importance=importance,
            in_reply_to=in_reply_to
        )

        message_data = draft.to_graph_message()

        # Add custom from address if provided (for alias/shared mailbox)
        if from_address:
            from_email_data = {"address": from_address}
            if from_name:
                from_email_data["name"] = from_name
            message_data["from"] = {"emailAddress": from_email_data}
            display = f"{from_name} <{from_address}>" if from_name else from_address
            logger.info(f"  📧 Sending from alias: {display}")

        # Add attachments if provided
        if attachments:
            import base64
            attachment_list = []
            for file_path in attachments:
                if file_path and file_path.exists():
                    with open(file_path, 'rb') as f:
                        content = base64.b64encode(f.read()).decode('utf-8')

                    # Determine content type
                    suffix = file_path.suffix.lower()
                    content_type_map = {
                        '.pdf': 'application/pdf',
                        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        '.xls': 'application/vnd.ms-excel',
                        '.doc': 'application/msword',
                        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        '.png': 'image/png',
                        '.jpg': 'image/jpeg',
                        '.jpeg': 'image/jpeg',
                        '.txt': 'text/plain',
                        '.csv': 'text/csv',
                    }
                    content_type = content_type_map.get(suffix, 'application/octet-stream')

                    attachment_list.append({
                        "@odata.type": "#microsoft.graph.fileAttachment",
                        "name": file_path.name,
                        "contentType": content_type,
                        "contentBytes": content
                    })
                    logger.info(f"  📎 Attaching: {file_path.name} ({content_type})")

            if attachment_list:
                message_data["attachments"] = attachment_list

        # Determine endpoint: shared mailbox takes priority
        if send_as_shared_mailbox:
            endpoint = f"/users/{send_as_shared_mailbox}/sendMail"
            logger.info(f"  📧 Sending as shared mailbox: {send_as_shared_mailbox}")
        elif self.user_email:
            endpoint = f"/users/{self.user_email}/sendMail"
        else:
            endpoint = f"/me/sendMail"

        await self._request("POST", endpoint, json={"message": message_data})

        logger.info(f"✅ Email sent")

    async def mark_as_read(self, message_id: str, is_read: bool = True) -> None:
        """
        Mark email as read/unread.

        Args:
            message_id: MS Graph message ID
            is_read: True to mark as read, False for unread
        """
        logger.info(f"Marking email {message_id} as {'read' if is_read else 'unread'}...")

        if self.user_email:
            endpoint = f"/users/{self.user_email}/messages/{message_id}"
        else:
            endpoint = f"/me/messages/{message_id}"

        await self._request("PATCH", endpoint, json={"isRead": is_read})

        logger.info(f"✅ Email marked as {'read' if is_read else 'unread'}")

    async def delete_email(self, message_id: str) -> None:
        """
        Delete email (move to Deleted Items).

        Args:
            message_id: MS Graph message ID
        """
        logger.info(f"Deleting email {message_id}...")

        if self.user_email:
            endpoint = f"/users/{self.user_email}/messages/{message_id}"
        else:
            endpoint = f"/me/messages/{message_id}"

        await self._request("DELETE", endpoint)

        logger.info(f"✅ Email deleted")

    async def search_emails(
        self,
        query: str,
        folder: str = "inbox",
        limit: int = 10
    ) -> List[Email]:
        """
        Search emails by keyword.

        Args:
            query: Search query string
            folder: Folder to search in
            limit: Maximum results

        Returns:
            List of matching Email objects
        """
        logger.info(f"Searching emails for: {query}")

        if self.user_email:
            endpoint = f"/users/{self.user_email}/mailFolders/{folder}/messages"
        else:
            endpoint = f"/me/mailFolders/{folder}/messages"

        params = {
            "$top": limit,
            "$search": f'"{query}"',
            "$orderby": "receivedDateTime desc"
        }

        response = await self._request("GET", endpoint, params=params)
        messages = response.get("value", [])

        emails = [Email.from_graph_data(msg) for msg in messages]

        logger.info(f"✅ Found {len(emails)} emails")
        return emails

    # ============================================================================
    # CATEGORY MANAGEMENT (for email classification)
    # ============================================================================

    async def get_outlook_categories(self) -> List[Dict[str, Any]]:
        """
        Get all Outlook categories for the user.

        Returns:
            List of category objects with 'displayName' and 'color' fields
        """
        logger.info("Fetching Outlook categories...")

        if self.user_email:
            endpoint = f"/users/{self.user_email}/outlook/masterCategories"
        else:
            endpoint = f"/me/outlook/masterCategories"

        try:
            response = await self._request("GET", endpoint)
            categories = response.get("value", [])

            logger.info(f"✅ Found {len(categories)} Outlook categories")
            return categories

        except Exception as e:
            logger.warning(f"Failed to fetch categories: {e}")
            return []

    async def create_outlook_category(
        self,
        name: str,
        color: str = "preset0"
    ) -> Dict[str, Any]:
        """
        Create new Outlook category.

        Args:
            name: Category display name
            color: Outlook color preset (preset0-preset24)
                  preset0 = Red (Urgent)
                  preset1 = Blue (Client Inquiry)
                  preset2 = Green (Internal)
                  preset3 = Orange (Financial)
                  preset4 = Yellow (Action Required)
                  preset5 = Gray (FYI)
                  preset6 = Purple (Spam)

        Returns:
            Created category object
        """
        logger.info(f"Creating Outlook category: {name} ({color})")

        if self.user_email:
            endpoint = f"/users/{self.user_email}/outlook/masterCategories"
        else:
            endpoint = f"/me/outlook/masterCategories"

        category_data = {
            "displayName": name,
            "color": color
        }

        try:
            response = await self._request("POST", endpoint, json=category_data)
            logger.info(f"✅ Category created: {name}")
            return response

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 409:
                logger.info(f"Category '{name}' already exists")
                # Return existing category
                return {"displayName": name, "color": color}
            raise

    async def update_message_categories(
        self,
        message_id: str,
        categories: List[str]
    ) -> None:
        """
        Update email categories (replace existing).

        Args:
            message_id: MS Graph message ID
            categories: List of category names to apply
        """
        logger.info(f"Updating categories for message {message_id}: {categories}")

        if self.user_email:
            endpoint = f"/users/{self.user_email}/messages/{message_id}"
        else:
            endpoint = f"/me/messages/{message_id}"

        await self._request("PATCH", endpoint, json={"categories": categories})

        logger.info(f"✅ Categories updated")

    async def add_message_category(
        self,
        message_id: str,
        category: str
    ) -> None:
        """
        Add category to email (preserves existing categories).

        Args:
            message_id: MS Graph message ID
            category: Category name to add
        """
        # Fetch current categories
        email = await self.get_email(message_id)
        current_categories = email.categories or []

        # Add new category if not already present
        if category not in current_categories:
            current_categories.append(category)
            await self.update_message_categories(message_id, current_categories)
            logger.info(f"✅ Added category '{category}' to message")
        else:
            logger.info(f"Category '{category}' already applied")

    async def remove_message_category(
        self,
        message_id: str,
        category: str
    ) -> None:
        """
        Remove category from email.

        Args:
            message_id: MS Graph message ID
            category: Category name to remove
        """
        # Fetch current categories
        email = await self.get_email(message_id)
        current_categories = email.categories or []

        # Remove category if present
        if category in current_categories:
            current_categories.remove(category)
            await self.update_message_categories(message_id, current_categories)
            logger.info(f"✅ Removed category '{category}' from message")
        else:
            logger.info(f"Category '{category}' not found on message")

    async def sync_categories(
        self,
        required_categories: Dict[str, str]
    ) -> None:
        """
        Ensure all required categories exist in Outlook.

        Args:
            required_categories: Dict mapping category names to color presets
                Example: {"Urgent": "preset0", "Client Inquiry": "preset1"}
        """
        logger.info(f"Syncing {len(required_categories)} categories to Outlook...")

        # Get existing categories
        existing = await self.get_outlook_categories()
        existing_names = {cat["displayName"] for cat in existing}

        # Create missing categories
        created_count = 0
        for name, color in required_categories.items():
            if name not in existing_names:
                await self.create_outlook_category(name, color)
                created_count += 1

        logger.info(
            f"✅ Category sync complete: {created_count} created, "
            f"{len(existing_names)} already existed"
        )

    # ============================================================================
    # SHAREPOINT / ONEDRIVE OPERATIONS
    # ============================================================================

    async def get_site_by_url(
        self,
        hostname: str,
        site_path: str
    ) -> SharePointSite:
        """
        Get SharePoint site by URL components.

        Args:
            hostname: SharePoint hostname (e.g., 'blitzfibre.sharepoint.com')
            site_path: Site path (e.g., '/sites/Velocity_Manco')

        Returns:
            SharePointSite object
        """
        logger.info(f"Getting SharePoint site: {hostname}{site_path}")

        endpoint = f"/sites/{hostname}:{site_path}"
        response = await self._request("GET", endpoint)

        site = SharePointSite.from_graph_data(response)
        logger.info(f"✅ Found site: {site.display_name} (ID: {site.id})")
        return site

    async def get_site_by_id(self, site_id: str) -> SharePointSite:
        """
        Get SharePoint site by ID.

        Args:
            site_id: MS Graph site ID

        Returns:
            SharePointSite object
        """
        logger.info(f"Getting SharePoint site by ID: {site_id}")

        endpoint = f"/sites/{site_id}"
        response = await self._request("GET", endpoint)

        site = SharePointSite.from_graph_data(response)
        logger.info(f"✅ Found site: {site.display_name}")
        return site

    async def search_sites(self, query: str) -> List[SharePointSite]:
        """
        Search for SharePoint sites.

        Args:
            query: Search query string

        Returns:
            List of matching SharePointSite objects
        """
        logger.info(f"Searching SharePoint sites: {query}")

        endpoint = f"/sites?search={query}"
        response = await self._request("GET", endpoint)

        sites = [SharePointSite.from_graph_data(s) for s in response.get("value", [])]
        logger.info(f"✅ Found {len(sites)} sites")
        return sites

    async def get_site_drive(self, site_id: str) -> SharePointDrive:
        """
        Get the default document library drive for a site.

        Args:
            site_id: MS Graph site ID

        Returns:
            SharePointDrive object
        """
        logger.info(f"Getting site drive for: {site_id}")

        endpoint = f"/sites/{site_id}/drive"
        response = await self._request("GET", endpoint)

        drive = SharePointDrive.from_graph_data(response)
        logger.info(f"✅ Found drive: {drive.name} (ID: {drive.id})")
        return drive

    async def list_site_drives(self, site_id: str) -> List[SharePointDrive]:
        """
        List all drives (document libraries) in a site.

        Args:
            site_id: MS Graph site ID

        Returns:
            List of SharePointDrive objects
        """
        logger.info(f"Listing drives for site: {site_id}")

        endpoint = f"/sites/{site_id}/drives"
        response = await self._request("GET", endpoint)

        drives = [SharePointDrive.from_graph_data(d) for d in response.get("value", [])]
        logger.info(f"✅ Found {len(drives)} drives")
        return drives

    async def list_drive_children(
        self,
        site_id: str,
        item_id: str = "root",
        drive_id: Optional[str] = None
    ) -> List[SharePointItem]:
        """
        List children (files/folders) of a drive item.

        Args:
            site_id: MS Graph site ID
            item_id: Item ID or 'root' for root folder
            drive_id: Optional specific drive ID (defaults to site's default drive)

        Returns:
            List of SharePointItem objects
        """
        logger.info(f"Listing drive children: site={site_id}, item={item_id}")

        if drive_id:
            endpoint = f"/sites/{site_id}/drives/{drive_id}/items/{item_id}/children"
        else:
            endpoint = f"/sites/{site_id}/drive/items/{item_id}/children"

        items = []
        while endpoint:
            response = await self._request("GET", endpoint)
            items.extend([SharePointItem.from_graph_data(i) for i in response.get("value", [])])

            # Handle pagination
            endpoint = response.get("@odata.nextLink")
            if endpoint:
                # Strip base URL for httpx
                endpoint = endpoint.replace(self.BASE_URL, "")

        logger.info(f"✅ Found {len(items)} items")
        return items

    async def get_drive_item(
        self,
        site_id: str,
        item_id: str,
        drive_id: Optional[str] = None
    ) -> SharePointItem:
        """
        Get a specific drive item by ID.

        Args:
            site_id: MS Graph site ID
            item_id: Drive item ID
            drive_id: Optional specific drive ID

        Returns:
            SharePointItem object
        """
        logger.info(f"Getting drive item: {item_id}")

        if drive_id:
            endpoint = f"/sites/{site_id}/drives/{drive_id}/items/{item_id}"
        else:
            endpoint = f"/sites/{site_id}/drive/items/{item_id}"

        response = await self._request("GET", endpoint)
        item = SharePointItem.from_graph_data(response)

        logger.info(f"✅ Found item: {item.name}")
        return item

    async def download_file(
        self,
        site_id: str,
        item_id: str,
        drive_id: Optional[str] = None,
        save_path: Optional[Path] = None
    ) -> bytes:
        """
        Download file content from SharePoint.

        Args:
            site_id: MS Graph site ID
            item_id: Drive item ID
            drive_id: Optional specific drive ID
            save_path: Optional local path to save file

        Returns:
            File content as bytes
        """
        logger.info(f"Downloading file: {item_id}")

        if drive_id:
            endpoint = f"/sites/{site_id}/drives/{drive_id}/items/{item_id}/content"
        else:
            endpoint = f"/sites/{site_id}/drive/items/{item_id}/content"

        # Need to make raw request for binary content
        if not self._http_client:
            raise RuntimeError("Client not connected. Call connect() first.")

        await self.auth.get_access_token()
        headers = self.auth.get_auth_header()

        response = await self._http_client.get(endpoint, headers=headers, follow_redirects=True)
        response.raise_for_status()

        content = response.content

        if save_path:
            save_path.parent.mkdir(parents=True, exist_ok=True)
            save_path.write_bytes(content)
            logger.info(f"✅ Saved file to: {save_path}")

        logger.info(f"✅ Downloaded {len(content):,} bytes")
        return content

    async def get_drive_delta(
        self,
        site_id: str,
        delta_token: Optional[str] = None,
        drive_id: Optional[str] = None
    ) -> DeltaQueryResult:
        """
        Get changes to drive using delta query.

        The delta query returns all items on first call, then only changed
        items on subsequent calls when using the delta_token.

        Args:
            site_id: MS Graph site ID
            delta_token: Token from previous delta query (None for first sync)
            drive_id: Optional specific drive ID

        Returns:
            DeltaQueryResult with items and new delta_token
        """
        logger.info(f"Running delta query for site: {site_id}")

        if drive_id:
            base_endpoint = f"/sites/{site_id}/drives/{drive_id}/root/delta"
        else:
            base_endpoint = f"/sites/{site_id}/drive/root/delta"

        # Use delta token if provided
        if delta_token:
            endpoint = delta_token
            logger.info("Using existing delta token for incremental sync")
        else:
            endpoint = base_endpoint
            logger.info("First sync - fetching all items")

        items = []
        new_delta_token = None
        next_link = None

        while endpoint:
            response = await self._request("GET", endpoint)

            # Parse items
            for item_data in response.get("value", []):
                items.append(SharePointItem.from_graph_data(item_data))

            # Check for more pages
            next_link = response.get("@odata.nextLink")
            if next_link:
                endpoint = next_link.replace(self.BASE_URL, "")
            else:
                # Get delta link for next sync
                delta_link = response.get("@odata.deltaLink")
                if delta_link:
                    new_delta_token = delta_link.replace(self.BASE_URL, "")
                endpoint = None

        result = DeltaQueryResult(
            items=items,
            delta_token=new_delta_token or delta_token or "",
            next_link=next_link,
            has_more=next_link is not None
        )

        logger.info(
            f"✅ Delta query complete: {len(items)} items "
            f"({len(result.added_items)} added/modified, {len(result.deleted_items)} deleted)"
        )
        return result

    async def get_all_delta_changes(
        self,
        site_id: str,
        delta_token: Optional[str] = None,
        drive_id: Optional[str] = None,
        file_extensions: Optional[List[str]] = None
    ) -> tuple[List[SharePointItem], str]:
        """
        Convenience method to get all delta changes with filtering.

        Args:
            site_id: MS Graph site ID
            delta_token: Token from previous delta query
            drive_id: Optional specific drive ID
            file_extensions: Optional list of extensions to filter (e.g., ['pdf', 'docx'])

        Returns:
            Tuple of (filtered_items, new_delta_token)
        """
        result = await self.get_drive_delta(site_id, delta_token, drive_id)

        # Filter to files only (not folders, not deleted)
        items = result.file_items

        # Apply extension filter if provided
        if file_extensions:
            extensions = {ext.lower().lstrip('.') for ext in file_extensions}
            items = [item for item in items if item.extension in extensions]
            logger.info(f"Filtered to {len(items)} items with extensions: {extensions}")

        return items, result.delta_token

    async def search_drive(
        self,
        site_id: str,
        query: str,
        drive_id: Optional[str] = None
    ) -> List[SharePointItem]:
        """
        Search for files in a drive.

        Args:
            site_id: MS Graph site ID
            query: Search query string
            drive_id: Optional specific drive ID

        Returns:
            List of matching SharePointItem objects
        """
        logger.info(f"Searching drive for: {query}")

        if drive_id:
            endpoint = f"/sites/{site_id}/drives/{drive_id}/root/search(q='{query}')"
        else:
            endpoint = f"/sites/{site_id}/drive/root/search(q='{query}')"

        items = []
        while endpoint:
            response = await self._request("GET", endpoint)
            items.extend([SharePointItem.from_graph_data(i) for i in response.get("value", [])])

            # Handle pagination
            endpoint = response.get("@odata.nextLink")
            if endpoint:
                endpoint = endpoint.replace(self.BASE_URL, "")

        logger.info(f"✅ Found {len(items)} items matching '{query}'")
        return items

    async def get_item_by_path(
        self,
        site_id: str,
        item_path: str,
        drive_id: Optional[str] = None
    ) -> SharePointItem:
        """
        Get a drive item by its path.

        Args:
            site_id: MS Graph site ID
            item_path: Path relative to drive root (e.g., 'Documents/Report.pdf')
            drive_id: Optional specific drive ID

        Returns:
            SharePointItem object
        """
        logger.info(f"Getting item by path: {item_path}")

        # URL encode the path
        from urllib.parse import quote
        encoded_path = quote(item_path, safe='/')

        if drive_id:
            endpoint = f"/sites/{site_id}/drives/{drive_id}/root:/{encoded_path}"
        else:
            endpoint = f"/sites/{site_id}/drive/root:/{encoded_path}"

        response = await self._request("GET", endpoint)
        item = SharePointItem.from_graph_data(response)

        logger.info(f"✅ Found item: {item.name}")
        return item
