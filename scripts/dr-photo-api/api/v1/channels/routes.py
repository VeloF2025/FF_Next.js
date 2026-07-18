"""
BOSS Channels API Routes

Provides REST endpoints for managing communication channels.
Loads channels from JSON config files in data/ directory.
"""

import os
import json
import logging
from pathlib import Path
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/channels", tags=["channels"])

# Data directory path
DATA_DIR = Path(__file__).parent.parent.parent.parent / "data"


class ChannelConfig(BaseModel):
    """Channel configuration model."""
    id: str
    type: str  # msgraph, imap, whatsapp_waha, whatsapp_evolution, telegram
    name: str
    enabled: bool = True
    status: str = "disconnected"  # connected, error, disconnected, pending
    last_sync: Optional[str] = None
    config: dict = Field(default_factory=dict)


class ChannelListResponse(BaseModel):
    """Response model for channel list."""
    channels: List[ChannelConfig]
    total: int


class ChannelTestRequest(BaseModel):
    """Request model for testing a channel connection."""
    type: str
    config: dict


class ChannelTestResponse(BaseModel):
    """Response model for channel test."""
    success: bool
    message: str
    details: Optional[dict] = None


def mask_secret(value: str, show_chars: int = 4) -> str:
    """Mask a secret value, showing only first few chars."""
    if not value or len(value) <= show_chars:
        return "••••••••"
    return value[:show_chars] + "••••••••"


def load_msgraph_channels() -> List[ChannelConfig]:
    """Load MS Graph accounts from config file."""
    channels = []
    config_file = DATA_DIR / "msgraph_accounts.json"

    if config_file.exists():
        try:
            with open(config_file, "r") as f:
                data = json.load(f)

            for account in data.get("accounts", []):
                channels.append(ChannelConfig(
                    id=f"msgraph-{account.get('account_id', 'unknown')}",
                    type="msgraph",
                    name=account.get("display_name", account.get("user_email", "MS Graph Account")),
                    enabled=account.get("enabled", True),
                    status="connected" if account.get("enabled", True) else "disconnected",
                    last_sync="Unknown",
                    config={
                        "client_id": mask_secret(account.get("client_id", "")),
                        "client_secret": "••••••••",
                        "tenant_id": mask_secret(account.get("tenant_id", "")),
                        "user_email": account.get("user_email", ""),
                    }
                ))
        except Exception as e:
            logger.error(f"Error loading MS Graph accounts: {e}")

    return channels


def load_imap_channels() -> List[ChannelConfig]:
    """Load IMAP accounts from config file."""
    channels = []
    config_file = DATA_DIR / "imap_accounts.json"

    if config_file.exists():
        try:
            with open(config_file, "r") as f:
                data = json.load(f)

            for account in data.get("accounts", []):
                channels.append(ChannelConfig(
                    id=f"imap-{account.get('account_id', 'unknown')}",
                    type="imap",
                    name=account.get("display_name", account.get("username", "IMAP Account")),
                    enabled=account.get("enabled", True),
                    status="connected" if account.get("enabled", True) else "disconnected",
                    last_sync="Unknown",
                    config={
                        "host": account.get("host", ""),
                        "port": str(account.get("port", 993)),
                        "username": account.get("username", ""),
                        "password": "••••••••",
                    }
                ))
        except Exception as e:
            logger.error(f"Error loading IMAP accounts: {e}")

    return channels


def load_whatsapp_channels() -> List[ChannelConfig]:
    """Load WhatsApp channels from environment variables."""
    channels = []

    # Check for WAHA configuration
    waha_url = os.getenv("WAHA_URL")
    waha_api_key = os.getenv("WAHA_API_KEY")

    if waha_url and waha_api_key:
        channels.append(ChannelConfig(
            id="whatsapp-waha-default",
            type="whatsapp_waha",
            name="BOSS WhatsApp (WAHA)",
            enabled=True,
            status="connected",
            last_sync="From environment",
            config={
                "api_url": waha_url,
                "api_key": mask_secret(waha_api_key),
                "session_name": "default",
            }
        ))

    # Check for Evolution API configuration
    evolution_url = os.getenv("EVOLUTION_API_URL")
    evolution_key = os.getenv("EVOLUTION_API_KEY")
    evolution_instance = os.getenv("EVOLUTION_INSTANCE_NAME")

    if evolution_url and evolution_key:
        channels.append(ChannelConfig(
            id="whatsapp-evolution-default",
            type="whatsapp_evolution",
            name="BOSS WhatsApp (Evolution)",
            enabled=True,
            status="connected",
            last_sync="From environment",
            config={
                "api_url": evolution_url,
                "api_key": mask_secret(evolution_key),
                "instance_name": evolution_instance or "boss_whatsapp",
            }
        ))

    return channels


def load_telegram_channels() -> List[ChannelConfig]:
    """Load Telegram bot from environment variables."""
    channels = []

    bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
    # Support both TELEGRAM_USER_ID and TELEGRAM_CHAT_ID
    user_id = os.getenv("TELEGRAM_USER_ID") or os.getenv("TELEGRAM_CHAT_ID")

    if bot_token and user_id:
        channels.append(ChannelConfig(
            id="telegram-bot-default",
            type="telegram",
            name="BOSS Remote Gateway (Telegram)",
            enabled=True,
            status="connected",
            last_sync="From environment",
            config={
                "bot_token": mask_secret(bot_token, 8),
                "user_id": user_id,
            }
        ))

    return channels


@router.get("", response_model=ChannelListResponse)
async def list_channels():
    """
    List all configured communication channels.

    Returns channels from:
    - data/msgraph_accounts.json (MS Graph)
    - data/imap_accounts.json (IMAP)
    - Environment variables (WhatsApp, Telegram)
    """
    channels = []

    # Load from all sources
    channels.extend(load_msgraph_channels())
    channels.extend(load_imap_channels())
    channels.extend(load_whatsapp_channels())
    channels.extend(load_telegram_channels())

    return ChannelListResponse(
        channels=channels,
        total=len(channels)
    )


@router.get("/{channel_id}", response_model=ChannelConfig)
async def get_channel(channel_id: str):
    """Get a specific channel by ID."""
    all_channels = (
        load_msgraph_channels() +
        load_imap_channels() +
        load_whatsapp_channels() +
        load_telegram_channels()
    )

    for channel in all_channels:
        if channel.id == channel_id:
            return channel

    raise HTTPException(status_code=404, detail=f"Channel {channel_id} not found")


@router.post("/{channel_id}/test", response_model=ChannelTestResponse)
async def test_channel_by_id(channel_id: str):
    """
    Test an existing channel connection by its ID.

    Loads real credentials from config files and tests connectivity.
    """
    # Load the real (unmasked) config for this channel
    config_file = None
    config_data = None

    if channel_id.startswith("msgraph-"):
        config_file = DATA_DIR / "msgraph_accounts.json"
        account_id = channel_id.replace("msgraph-", "")
        if config_file.exists():
            with open(config_file, "r") as f:
                data = json.load(f)
            for account in data.get("accounts", []):
                if account.get("account_id") == account_id:
                    config_data = {
                        "type": "msgraph",
                        "config": {
                            "client_id": account.get("client_id"),
                            "client_secret": account.get("client_secret"),
                            "tenant_id": account.get("tenant_id"),
                            "user_email": account.get("user_email"),
                        }
                    }
                    break

    elif channel_id.startswith("imap-"):
        config_file = DATA_DIR / "imap_accounts.json"
        account_id = channel_id.replace("imap-", "")
        if config_file.exists():
            with open(config_file, "r") as f:
                data = json.load(f)
            for account in data.get("accounts", []):
                if account.get("account_id") == account_id:
                    config_data = {
                        "type": "imap",
                        "config": {
                            "host": account.get("host"),
                            "port": account.get("port", 993),
                            "username": account.get("username"),
                            "password": account.get("password"),
                        }
                    }
                    break

    elif channel_id.startswith("whatsapp-waha"):
        waha_url = os.getenv("WAHA_URL")
        waha_api_key = os.getenv("WAHA_API_KEY")
        if waha_url and waha_api_key:
            config_data = {
                "type": "whatsapp_waha",
                "config": {
                    "api_url": waha_url,
                    "api_key": waha_api_key,
                    "session_name": "default",
                }
            }

    elif channel_id.startswith("whatsapp-evolution"):
        evolution_url = os.getenv("EVOLUTION_API_URL")
        evolution_key = os.getenv("EVOLUTION_API_KEY")
        evolution_instance = os.getenv("EVOLUTION_INSTANCE_NAME")
        if evolution_url and evolution_key:
            config_data = {
                "type": "whatsapp_evolution",
                "config": {
                    "api_url": evolution_url,
                    "api_key": evolution_key,
                    "instance_name": evolution_instance or "boss_whatsapp",
                }
            }

    elif channel_id.startswith("telegram"):
        bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
        user_id = os.getenv("TELEGRAM_USER_ID")
        if bot_token:
            config_data = {
                "type": "telegram",
                "config": {
                    "bot_token": bot_token,
                    "user_id": user_id,
                }
            }

    if not config_data:
        return ChannelTestResponse(
            success=False,
            message=f"Channel {channel_id} not found or has no configuration"
        )

    # Use the existing test logic
    request = ChannelTestRequest(type=config_data["type"], config=config_data["config"])
    return await test_channel(request)


@router.post("/test", response_model=ChannelTestResponse)
async def test_channel(request: ChannelTestRequest):
    """
    Test a channel connection with provided credentials.

    Note: This tests connectivity only, does not persist.
    """
    channel_type = request.type
    config = request.config

    try:
        if channel_type == "msgraph":
            # Test MS Graph connection
            from lib.msgraph.client import MSGraphClient
            client = MSGraphClient(
                client_id=config.get("client_id"),
                client_secret=config.get("client_secret"),
                tenant_id=config.get("tenant_id"),
                user_email=config.get("user_email"),
            )
            # Try to connect (authenticates with MS Graph)
            await client.connect()
            await client.disconnect()
            return ChannelTestResponse(
                success=True,
                message=f"Connected to MS Graph for {config.get('user_email', 'Unknown')}",
                details={"user": config.get("user_email")}
            )

        elif channel_type == "imap":
            # Test IMAP connection
            from lib.email.imap_client import IMAPClient
            client = IMAPClient(
                host=config.get("host"),
                port=int(config.get("port", 993)),
                username=config.get("username"),
                password=config.get("password"),
            )
            # Try to connect (synchronous)
            try:
                client.connect()
                folder_count = len(client.list_folders())
                client.disconnect()
                return ChannelTestResponse(
                    success=True,
                    message=f"Connected to IMAP server {config.get('host')} ({folder_count} folders)",
                    details={"host": config.get("host"), "folders": folder_count}
                )
            except Exception as imap_error:
                return ChannelTestResponse(
                    success=False,
                    message=f"IMAP connection failed: {str(imap_error)}"
                )

        elif channel_type == "whatsapp_waha":
            # Test WAHA connection using httpx directly
            import httpx
            api_url = config.get("api_url", "").rstrip("/")
            api_key = config.get("api_key")
            session_name = config.get("session_name", "default")

            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{api_url}/api/sessions/{session_name}",
                    headers={"X-Api-Key": api_key}
                )
                if response.status_code == 200:
                    data = response.json()
                    status = data.get("status", "Unknown")
                    me = data.get("me", {})
                    return ChannelTestResponse(
                        success=status == "WORKING",
                        message=f"WAHA session '{session_name}': {status} ({me.get('pushName', 'Unknown')})",
                        details={"status": status, "session": session_name, "me": me}
                    )
                elif response.status_code == 404:
                    return ChannelTestResponse(
                        success=False,
                        message=f"WAHA session '{session_name}' not found"
                    )
                else:
                    return ChannelTestResponse(
                        success=False,
                        message=f"WAHA API error: {response.status_code}"
                    )

        elif channel_type == "whatsapp_evolution":
            # Test Evolution API connection using httpx directly
            import httpx
            api_url = config.get("api_url", "").rstrip("/")
            api_key = config.get("api_key")
            instance_name = config.get("instance_name")

            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{api_url}/instance/connectionState/{instance_name}",
                    headers={"apikey": api_key}
                )
                if response.status_code == 200:
                    data = response.json()
                    state = data.get("state", "Unknown")
                    connected = state == "open"
                    return ChannelTestResponse(
                        success=connected,
                        message=f"Evolution instance '{instance_name}': {state}",
                        details={"state": state, "instance": instance_name, "connected": connected}
                    )
                else:
                    return ChannelTestResponse(
                        success=False,
                        message=f"Evolution API error: {response.status_code}"
                    )

        elif channel_type == "telegram":
            # Test Telegram bot
            import httpx
            bot_token = config.get("bot_token")
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"https://api.telegram.org/bot{bot_token}/getMe"
                )
                data = response.json()
                if data.get("ok"):
                    bot = data.get("result", {})
                    return ChannelTestResponse(
                        success=True,
                        message=f"Connected to Telegram bot @{bot.get('username', 'Unknown')}",
                        details={"username": bot.get("username"), "id": bot.get("id")}
                    )
                else:
                    return ChannelTestResponse(
                        success=False,
                        message=f"Telegram API error: {data.get('description', 'Unknown error')}"
                    )

        else:
            return ChannelTestResponse(
                success=False,
                message=f"Unknown channel type: {channel_type}"
            )

    except Exception as e:
        logger.error(f"Error testing channel {channel_type}: {e}")
        return ChannelTestResponse(
            success=False,
            message=f"Connection failed: {str(e)}"
        )


@router.post("", response_model=ChannelConfig)
async def create_channel(channel: ChannelConfig):
    """
    Create a new channel configuration.

    Note: For security, this saves to the appropriate config file
    but credentials should be verified first via /test endpoint.
    """
    # TODO: Implement channel creation (save to JSON config)
    raise HTTPException(
        status_code=501,
        detail="Channel creation not yet implemented. Edit data/*.json files directly."
    )


@router.put("/{channel_id}", response_model=ChannelConfig)
async def update_channel(channel_id: str, channel: ChannelConfig):
    """Update an existing channel configuration."""
    # TODO: Implement channel update
    raise HTTPException(
        status_code=501,
        detail="Channel update not yet implemented. Edit data/*.json files directly."
    )


@router.delete("/{channel_id}")
async def delete_channel(channel_id: str):
    """Delete a channel configuration."""
    # TODO: Implement channel deletion
    raise HTTPException(
        status_code=501,
        detail="Channel deletion not yet implemented. Edit data/*.json files directly."
    )
