"""
WAHA (WhatsApp HTTP API) client for WhatsApp operations.

Provides WhatsApp Web integration via WAHA (self-hosted HTTP API).
Documentation: https://waha.devlike.pro
"""

import os
import logging
from typing import List, Optional, Dict, Any
from pathlib import Path
import httpx
import base64
from datetime import datetime

logger = logging.getLogger(__name__)


class WAHAClient:
    """
    WAHA HTTP API client for WhatsApp operations.

    Features:
    - Create/manage WhatsApp sessions
    - QR code authentication (WhatsApp Web)
    - Send text/media messages
    - Receive messages via webhooks
    - Session status management

    WAHA API Documentation: https://waha.devlike.pro/docs/how-to/sessions/
    """

    def __init__(
        self,
        api_url: Optional[str] = None,
        api_key: Optional[str] = None,
        session_name: str = "default"
    ):
        """
        Initialize WAHA client.

        Args:
            api_url: WAHA API URL (or from WAHA_URL env)
            api_key: API key (or from WAHA_API_KEY env)
            session_name: WhatsApp session name (default: "default")
        """
        self.api_url = (api_url or os.getenv("WAHA_URL", "http://localhost:8765")).rstrip("/")
        self.api_key = api_key or os.getenv("WAHA_API_KEY")
        self.session_name = session_name

        if not self.api_key:
            raise ValueError(
                "WAHA API key required. Set WAHA_API_KEY in environment "
                "or pass to constructor."
            )

        self._http_client: Optional[httpx.AsyncClient] = None

        logger.info(f"WAHAClient initialized (session={self.session_name}, url={self.api_url})")

    async def __aenter__(self):
        """Async context manager entry."""
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.disconnect()

    async def connect(self) -> None:
        """Initialize HTTP client."""
        self._http_client = httpx.AsyncClient(
            base_url=self.api_url,
            timeout=httpx.Timeout(30.0),
            headers=self._get_headers()
        )
        logger.info(f"Connected to WAHA API: {self.api_url}")

    async def disconnect(self) -> None:
        """Close HTTP client."""
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None
        logger.info("Disconnected from WAHA API")

    def _get_headers(self) -> Dict[str, str]:
        """Get API request headers with authentication."""
        return {
            "Content-Type": "application/json",
            "X-Api-Key": self.api_key  # WAHA uses X-Api-Key header
        }

    async def _request(
        self,
        method: str,
        endpoint: str,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Make API request.

        Args:
            method: HTTP method (GET, POST, etc.)
            endpoint: API endpoint
            **kwargs: Additional arguments for httpx request

        Returns:
            API response JSON
        """
        if not self._http_client:
            raise RuntimeError("Client not connected. Use async with or call connect().")

        try:
            response = await self._http_client.request(method, endpoint, **kwargs)
            response.raise_for_status()
            return response.json()

        except httpx.HTTPStatusError as e:
            logger.error(f"WAHA API error {e.response.status_code}: {e.response.text}")
            raise
        except Exception as e:
            logger.error(f"WAHA request failed: {e}")
            raise

    # ========================================================================
    # SESSION MANAGEMENT
    # ========================================================================

    async def start_session(self, config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Start WhatsApp session.

        Args:
            config: Session configuration (optional)

        Returns:
            Session info with QR code

        WAHA API: POST /api/sessions/start
        """
        logger.info(f"Starting WAHA session: {self.session_name}")

        payload = {
            "name": self.session_name,
            "config": config or {}
        }

        result = await self._request("POST", "/api/sessions/start", json=payload)

        logger.info(f"✅ Session started: {self.session_name}")
        return result

    async def stop_session(self) -> Dict[str, Any]:
        """
        Stop WhatsApp session.

        Returns:
            Stop confirmation

        WAHA API: POST /api/sessions/stop
        """
        logger.info(f"Stopping WAHA session: {self.session_name}")

        payload = {"name": self.session_name}
        result = await self._request("POST", "/api/sessions/stop", json=payload)

        logger.info(f"✅ Session stopped: {self.session_name}")
        return result

    async def get_session_status(self) -> Dict[str, Any]:
        """
        Get session status.

        Returns:
            Session status info

        WAHA API: GET /api/sessions/{session}
        """
        result = await self._request("GET", f"/api/sessions/{self.session_name}")
        return result

    async def get_qr_code(self) -> Dict[str, str]:
        """
        Get QR code for WhatsApp Web authentication.

        Returns:
            Dict with "qr" (base64 image)

        WAHA API: GET /api/{session}/auth/qr
        """
        logger.info("Getting QR code for WhatsApp authentication")

        # WAHA provides QR via screenshot endpoint
        result = await self._request("GET", f"/api/{self.session_name}/auth/qr")

        return result

    async def get_connection_state(self) -> str:
        """
        Get WhatsApp connection state.

        Returns:
            State: "CONNECTED", "DISCONNECTED", "STARTING", "SCAN_QR_CODE"

        WAHA API: GET /api/sessions/{session}
        """
        status = await self.get_session_status()
        return status.get("status", "DISCONNECTED")

    # ========================================================================
    # MESSAGING
    # ========================================================================

    async def send_text(
        self,
        phone: str,
        message: str,
        reply_to: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Send text message.

        Args:
            phone: Recipient phone number (format: 5511999999999@c.us)
            message: Message text
            reply_to: Message ID to reply to (optional)

        Returns:
            Send result with message ID

        WAHA API: POST /api/sendText
        """
        logger.info(f"Sending WhatsApp message to {phone}")

        # Format phone number for WAHA (add @c.us if not present)
        if "@" not in phone:
            # Remove + and spaces, add @c.us
            phone_clean = phone.replace("+", "").replace(" ", "").replace("-", "")
            chat_id = f"{phone_clean}@c.us"
        else:
            chat_id = phone

        payload = {
            "session": self.session_name,
            "chatId": chat_id,
            "text": message
        }

        if reply_to:
            payload["reply_to"] = reply_to

        result = await self._request("POST", "/api/sendText", json=payload)

        logger.info(f"✅ Message sent to {phone}")
        return result

    async def send_image(
        self,
        phone: str,
        image_path: Path,
        caption: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Send image message.

        Args:
            phone: Recipient phone number
            image_path: Path to image file
            caption: Image caption (optional)

        Returns:
            Send result

        WAHA API: POST /api/sendImage
        """
        logger.info(f"Sending WhatsApp image to {phone}")

        # Format phone
        if "@" not in phone:
            phone_clean = phone.replace("+", "").replace(" ", "").replace("-", "")
            chat_id = f"{phone_clean}@c.us"
        else:
            chat_id = phone

        # Read image and encode base64
        with open(image_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode("utf-8")

        payload = {
            "session": self.session_name,
            "chatId": chat_id,
            "file": {
                "mimetype": "image/jpeg",  # TODO: Detect mimetype
                "filename": image_path.name,
                "data": image_data
            }
        }

        if caption:
            payload["caption"] = caption

        result = await self._request("POST", "/api/sendImage", json=payload)

        logger.info(f"✅ Image sent to {phone}")
        return result

    async def send_file(
        self,
        phone: str,
        file_path: Path,
        caption: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Send file/document message.

        Args:
            phone: Recipient phone number
            file_path: Path to file
            caption: File caption (optional)

        Returns:
            Send result

        WAHA API: POST /api/sendFile
        """
        logger.info(f"Sending WhatsApp file to {phone}")

        # Format phone
        if "@" not in phone:
            phone_clean = phone.replace("+", "").replace(" ", "").replace("-", "")
            chat_id = f"{phone_clean}@c.us"
        else:
            chat_id = phone

        # Read file and encode base64
        with open(file_path, "rb") as f:
            file_data = base64.b64encode(f.read()).decode("utf-8")

        payload = {
            "session": self.session_name,
            "chatId": chat_id,
            "file": {
                "mimetype": "application/octet-stream",  # TODO: Detect mimetype
                "filename": file_path.name,
                "data": file_data
            }
        }

        if caption:
            payload["caption"] = caption

        result = await self._request("POST", "/api/sendFile", json=payload)

        logger.info(f"✅ File sent to {phone}")
        return result

    # ========================================================================
    # WEBHOOKS
    # ========================================================================

    async def set_webhook(self, webhook_url: str, events: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        Configure webhook for receiving messages.

        Args:
            webhook_url: Webhook endpoint URL
            events: List of events to subscribe (default: all)

        Returns:
            Webhook configuration result

        WAHA API: POST /api/sessions/{session}/webhook
        """
        logger.info(f"Setting webhook: {webhook_url}")

        payload = {
            "url": webhook_url,
            "events": events or ["message"]  # Default to message events
        }

        result = await self._request(
            "POST",
            f"/api/sessions/{self.session_name}/webhook",
            json=payload
        )

        logger.info(f"✅ Webhook configured for session {self.session_name}")
        return result

    async def get_webhook(self) -> Dict[str, Any]:
        """
        Get current webhook configuration.

        Returns:
            Webhook config

        WAHA API: GET /api/sessions/{session}/webhook
        """
        result = await self._request("GET", f"/api/sessions/{self.session_name}/webhook")
        return result

    # ========================================================================
    # UTILITY
    # ========================================================================

    async def get_me(self) -> Dict[str, Any]:
        """
        Get current WhatsApp account info.

        Returns:
            Account information

        WAHA API: GET /api/{session}/me
        """
        result = await self._request("GET", f"/api/{self.session_name}/me")
        return result

    async def get_chats(self) -> List[Dict[str, Any]]:
        """
        Get all chats.

        Returns:
            List of chats

        WAHA API: GET /api/{session}/chats
        """
        result = await self._request("GET", f"/api/{self.session_name}/chats")
        return result

    async def get_messages(
        self,
        chat_id: str,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """
        Get messages from chat.

        Args:
            chat_id: Chat ID
            limit: Max messages to fetch

        Returns:
            List of messages

        WAHA API: GET /api/{session}/chats/{chatId}/messages
        """
        result = await self._request(
            "GET",
            f"/api/{self.session_name}/chats/{chat_id}/messages",
            params={"limit": limit}
        )
        return result
