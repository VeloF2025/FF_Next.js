"""
Evolution API client for WhatsApp operations.

Provides WhatsApp Web integration via Evolution API (self-hosted).
"""

import os
import logging
from typing import List, Optional, Dict, Any
from pathlib import Path
import httpx
import base64

from .models import WhatsAppMessage, WhatsAppDraft, EvolutionInstance, MessageType


logger = logging.getLogger(__name__)


class EvolutionClient:
    """
    Evolution API client for WhatsApp operations.

    Features:
    - Create/manage WhatsApp instances
    - QR code authentication (WhatsApp Web)
    - Send text/media messages
    - Receive messages via webhooks
    - Instance status management
    """

    def __init__(
        self,
        api_url: Optional[str] = None,
        api_key: Optional[str] = None,
        instance_name: Optional[str] = None
    ):
        """
        Initialize Evolution client.

        Args:
            api_url: Evolution API URL (or from EVOLUTION_API_URL env)
            api_key: API key (or from EVOLUTION_API_KEY env)
            instance_name: WhatsApp instance name (or from EVOLUTION_INSTANCE_NAME env)
        """
        self.api_url = (api_url or os.getenv("EVOLUTION_API_URL", "http://localhost:8081")).rstrip("/")
        self.api_key = api_key or os.getenv("EVOLUTION_API_KEY")
        self.instance_name = instance_name or os.getenv("EVOLUTION_INSTANCE_NAME", "boss_whatsapp")

        if not self.api_key:
            raise ValueError(
                "Evolution API key required. Set EVOLUTION_API_KEY in environment "
                "or pass to constructor."
            )

        self._http_client: Optional[httpx.AsyncClient] = None

        logger.info(f"EvolutionClient initialized (instance={self.instance_name})")

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
            timeout=httpx.Timeout(30.0)
        )
        logger.info(f"Connected to Evolution API: {self.api_url}")

    async def disconnect(self) -> None:
        """Close HTTP client."""
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None
        logger.info("Disconnected from Evolution API")

    def _get_headers(self) -> Dict[str, str]:
        """Get API request headers."""
        return {
            "Content-Type": "application/json",
            "apikey": self.api_key
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
            method: HTTP method
            endpoint: API endpoint
            **kwargs: Additional request arguments

        Returns:
            JSON response data
        """
        if not self._http_client:
            raise RuntimeError("Client not connected. Call connect() first.")

        headers = kwargs.pop("headers", {})
        headers.update(self._get_headers())

        response = await self._http_client.request(
            method,
            endpoint,
            headers=headers,
            **kwargs
        )

        response.raise_for_status()
        return response.json()

    async def create_instance(self, instance_name: Optional[str] = None) -> EvolutionInstance:
        """
        Create new WhatsApp instance.

        Args:
            instance_name: Instance name (uses self.instance_name if None)

        Returns:
            EvolutionInstance object
        """
        name = instance_name or self.instance_name

        logger.info(f"Creating Evolution instance: {name}")

        payload = {
            "instanceName": name,
            "qrcode": True,
            "integration": "WHATSAPP-BAILEYS"
        }

        response = await self._request("POST", "/instance/create", json=payload)

        instance = EvolutionInstance.from_api_data(response)
        logger.info(f"✅ Instance created: {name}")

        return instance

    async def get_qr_code(self, instance_name: Optional[str] = None) -> Dict[str, str]:
        """
        Get QR code for WhatsApp Web authentication.

        Args:
            instance_name: Instance name (uses self.instance_name if None)

        Returns:
            Dict with "qrcode" (base64 image) and "code" (text)
        """
        name = instance_name or self.instance_name

        logger.info(f"Getting QR code for instance: {name}")

        response = await self._request("GET", f"/instance/connect/{name}")

        qr_data = response.get("qrcode", {})

        logger.info(f"✅ QR code retrieved for {name}")
        return {
            "qrcode": qr_data.get("base64"),  # Base64 image
            "code": qr_data.get("code")        # Text code
        }

    async def get_connection_state(self, instance_name: Optional[str] = None) -> Dict[str, str]:
        """
        Get instance connection state.

        Args:
            instance_name: Instance name (uses self.instance_name if None)

        Returns:
            Dict with "state" ("open", "connecting", "close")
        """
        name = instance_name or self.instance_name

        response = await self._request("GET", f"/instance/connectionState/{name}")

        state = response.get("instance", {}).get("state", "close")

        logger.info(f"Instance {name} state: {state}")
        return {"state": state}

    async def send_text(
        self,
        phone: str,
        message: str,
        instance_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Send text message.

        Args:
            phone: Recipient phone number (with country code, e.g., "5511999999999")
            message: Text message content
            instance_name: Instance name (uses self.instance_name if None)

        Returns:
            Send result
        """
        name = instance_name or self.instance_name

        # Ensure phone has WhatsApp suffix
        if "@" not in phone:
            phone = f"{phone}@s.whatsapp.net"

        logger.info(f"Sending text message to {phone} via {name}")

        payload = {
            "number": phone,
            "textMessage": {
                "text": message
            }
        }

        response = await self._request("POST", f"/message/sendText/{name}", json=payload)

        logger.info(f"✅ Message sent to {phone}")
        return response

    async def send_media(
        self,
        phone: str,
        media_url: str,
        media_type: str = "image",
        caption: Optional[str] = None,
        filename: Optional[str] = None,
        instance_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Send media message (image, document, audio, video).

        Args:
            phone: Recipient phone number
            media_url: Media file URL or base64
            media_type: "image", "document", "audio", "video"
            caption: Optional caption
            filename: Filename (for documents)
            instance_name: Instance name

        Returns:
            Send result
        """
        name = instance_name or self.instance_name

        # Ensure phone has WhatsApp suffix
        if "@" not in phone:
            phone = f"{phone}@s.whatsapp.net"

        logger.info(f"Sending {media_type} to {phone} via {name}")

        payload = {
            "number": phone,
            "mediaMessage": {
                "mediatype": media_type,
                "media": media_url
            }
        }

        if caption:
            payload["mediaMessage"]["caption"] = caption

        if filename:
            payload["mediaMessage"]["fileName"] = filename

        response = await self._request("POST", f"/message/sendMedia/{name}", json=payload)

        logger.info(f"✅ {media_type.capitalize()} sent to {phone}")
        return response

    async def download_media(
        self,
        message_id: str,
        instance_name: Optional[str] = None
    ) -> bytes:
        """
        Download media from message.

        Args:
            message_id: Message ID
            instance_name: Instance name

        Returns:
            Media content bytes
        """
        name = instance_name or self.instance_name

        logger.info(f"Downloading media for message {message_id}")

        # Get message details
        response = await self._request("GET", f"/message/messageById/{name}/{message_id}")

        # Extract media URL
        message_data = response.get("message", {})

        # Try different media message types
        media_url = None
        for media_type in ["imageMessage", "documentMessage", "audioMessage", "videoMessage"]:
            if media_type in message_data:
                media_url = message_data[media_type].get("url")
                break

        if not media_url:
            raise ValueError(f"No media found in message {message_id}")

        # Download media (Evolution API may provide direct URL or base64)
        if media_url.startswith("http"):
            # Direct URL - download
            async with httpx.AsyncClient() as client:
                media_response = await client.get(media_url)
                media_response.raise_for_status()
                media_bytes = media_response.content
        else:
            # Base64 encoded
            media_bytes = base64.b64decode(media_url)

        logger.info(f"✅ Media downloaded ({len(media_bytes)} bytes)")
        return media_bytes

    async def set_webhook(
        self,
        webhook_url: str,
        webhook_events: Optional[List[str]] = None,
        instance_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Configure webhook for receiving messages.

        Args:
            webhook_url: Webhook endpoint URL
            webhook_events: Events to subscribe (default: all)
            instance_name: Instance name

        Returns:
            Webhook configuration result
        """
        name = instance_name or self.instance_name

        if not webhook_events:
            webhook_events = [
                "messages.upsert",
                "messages.update",
                "send.message"
            ]

        logger.info(f"Setting webhook for {name}: {webhook_url}")

        payload = {
            "url": webhook_url,
            "webhookByEvents": True,
            "events": webhook_events
        }

        response = await self._request("POST", f"/webhook/set/{name}", json=payload)

        logger.info(f"✅ Webhook configured for {name}")
        return response

    async def get_webhook(self, instance_name: Optional[str] = None) -> Dict[str, Any]:
        """
        Get webhook configuration.

        Args:
            instance_name: Instance name

        Returns:
            Webhook configuration
        """
        name = instance_name or self.instance_name

        response = await self._request("GET", f"/webhook/find/{name}")

        return response

    async def list_instances(self) -> List[EvolutionInstance]:
        """
        List all WhatsApp instances.

        Returns:
            List of EvolutionInstance objects
        """
        logger.info("Fetching all instances")

        response = await self._request("GET", "/instance/fetchInstances")

        instances = []
        for instance_data in response:
            instances.append(EvolutionInstance.from_api_data({"instance": instance_data}))

        logger.info(f"✅ Found {len(instances)} instances")
        return instances

    async def delete_instance(self, instance_name: Optional[str] = None) -> Dict[str, Any]:
        """
        Delete WhatsApp instance.

        Args:
            instance_name: Instance name

        Returns:
            Deletion result
        """
        name = instance_name or self.instance_name

        logger.info(f"Deleting instance: {name}")

        response = await self._request("DELETE", f"/instance/delete/{name}")

        logger.info(f"✅ Instance deleted: {name}")
        return response

    async def logout_instance(self, instance_name: Optional[str] = None) -> Dict[str, Any]:
        """
        Logout WhatsApp instance (disconnect but keep instance).

        Args:
            instance_name: Instance name

        Returns:
            Logout result
        """
        name = instance_name or self.instance_name

        logger.info(f"Logging out instance: {name}")

        response = await self._request("DELETE", f"/instance/logout/{name}")

        logger.info(f"✅ Instance logged out: {name}")
        return response
