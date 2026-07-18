"""
BOSS Settings API Routes

Provides REST endpoints for user preferences and notification settings.
Settings are persisted to data/user_settings.json.
"""

import os
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])

# Settings file location
DATA_DIR = Path(__file__).parent.parent.parent.parent / "data"
SETTINGS_FILE = DATA_DIR / "user_settings.json"


class NotificationPreference(BaseModel):
    """A single notification preference."""
    id: str
    label: str
    description: str
    enabled: bool


class NotificationSettings(BaseModel):
    """Notification settings model."""
    preferences: list[NotificationPreference]


class AppearanceSettings(BaseModel):
    """Appearance settings model."""
    theme: str  # dark, light, system
    accent_color: str  # cyan, purple, green, orange


class SecuritySettings(BaseModel):
    """Security settings model."""
    two_factor_enabled: bool
    api_keys_count: int


class UserSettings(BaseModel):
    """Complete user settings model."""
    notifications: NotificationSettings
    appearance: AppearanceSettings
    security: SecuritySettings
    updated_at: str


def get_default_settings() -> dict:
    """Return default settings."""
    return {
        "notifications": {
            "preferences": [
                {
                    "id": "new_approvals",
                    "label": "New approval requests",
                    "description": "Get notified when new messages need approval",
                    "enabled": True
                },
                {
                    "id": "urgent_messages",
                    "label": "Urgent messages",
                    "description": "Instant notification for urgent priority items",
                    "enabled": True
                },
                {
                    "id": "cost_alerts",
                    "label": "Cost alerts",
                    "description": "Alert when spending exceeds thresholds",
                    "enabled": True
                },
                {
                    "id": "system_status",
                    "label": "System status",
                    "description": "Notifications about API connections and health",
                    "enabled": False
                },
                {
                    "id": "daily_digest",
                    "label": "Daily digest",
                    "description": "Summary of daily activity each morning",
                    "enabled": False
                }
            ]
        },
        "appearance": {
            "theme": "dark",
            "accent_color": "cyan"
        },
        "security": {
            "two_factor_enabled": False,
            "api_keys_count": 1
        },
        "updated_at": datetime.now().isoformat()
    }


def load_settings() -> dict:
    """Load settings from file or return defaults."""
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, "r") as f:
                settings = json.load(f)
                # Merge with defaults to ensure all keys exist
                defaults = get_default_settings()
                for key in defaults:
                    if key not in settings:
                        settings[key] = defaults[key]
                return settings
        except Exception as e:
            logger.error(f"Error loading settings: {e}")
            return get_default_settings()
    return get_default_settings()


def save_settings(settings: dict) -> bool:
    """Save settings to file."""
    try:
        # Ensure data directory exists
        DATA_DIR.mkdir(parents=True, exist_ok=True)

        settings["updated_at"] = datetime.now().isoformat()
        with open(SETTINGS_FILE, "w") as f:
            json.dump(settings, f, indent=2)
        return True
    except Exception as e:
        logger.error(f"Error saving settings: {e}")
        return False


@router.get("", response_model=UserSettings)
async def get_settings():
    """
    Get all user settings.

    Returns notification preferences, appearance settings, and security status.
    """
    settings = load_settings()
    return UserSettings(**settings)


@router.get("/notifications", response_model=NotificationSettings)
async def get_notification_settings():
    """Get notification preferences."""
    settings = load_settings()
    return NotificationSettings(**settings.get("notifications", get_default_settings()["notifications"]))


@router.put("/notifications")
async def update_notification_settings(notifications: NotificationSettings):
    """
    Update notification preferences.

    Args:
        notifications: Updated notification settings
    """
    settings = load_settings()
    settings["notifications"] = notifications.model_dump()

    if save_settings(settings):
        return {"success": True, "message": "Notification settings updated"}
    else:
        raise HTTPException(status_code=500, detail="Failed to save settings")


@router.put("/notifications/{notification_id}")
async def toggle_notification(notification_id: str, enabled: bool):
    """
    Toggle a specific notification preference.

    Args:
        notification_id: The ID of the notification to toggle
        enabled: Whether the notification should be enabled
    """
    settings = load_settings()

    # Find and update the specific notification
    found = False
    for pref in settings.get("notifications", {}).get("preferences", []):
        if pref["id"] == notification_id:
            pref["enabled"] = enabled
            found = True
            break

    if not found:
        raise HTTPException(status_code=404, detail=f"Notification '{notification_id}' not found")

    if save_settings(settings):
        return {"success": True, "message": f"Notification '{notification_id}' updated", "enabled": enabled}
    else:
        raise HTTPException(status_code=500, detail="Failed to save settings")


@router.get("/appearance", response_model=AppearanceSettings)
async def get_appearance_settings():
    """Get appearance settings."""
    settings = load_settings()
    return AppearanceSettings(**settings.get("appearance", get_default_settings()["appearance"]))


@router.put("/appearance")
async def update_appearance_settings(appearance: AppearanceSettings):
    """
    Update appearance settings.

    Args:
        appearance: Updated appearance settings (theme, accent_color)
    """
    # Validate values
    valid_themes = ["dark", "light", "system"]
    valid_colors = ["cyan", "purple", "green", "orange"]

    if appearance.theme not in valid_themes:
        raise HTTPException(status_code=400, detail=f"Invalid theme. Must be one of: {valid_themes}")

    if appearance.accent_color not in valid_colors:
        raise HTTPException(status_code=400, detail=f"Invalid accent color. Must be one of: {valid_colors}")

    settings = load_settings()
    settings["appearance"] = appearance.model_dump()

    if save_settings(settings):
        return {"success": True, "message": "Appearance settings updated"}
    else:
        raise HTTPException(status_code=500, detail="Failed to save settings")


@router.get("/security", response_model=SecuritySettings)
async def get_security_settings():
    """Get security settings status."""
    settings = load_settings()
    return SecuritySettings(**settings.get("security", get_default_settings()["security"]))


@router.put("/security/2fa")
async def toggle_two_factor(enabled: bool):
    """
    Enable or disable two-factor authentication.

    Note: This is a placeholder - actual 2FA implementation would require
    additional setup flow.
    """
    settings = load_settings()
    settings["security"]["two_factor_enabled"] = enabled

    if save_settings(settings):
        return {
            "success": True,
            "message": f"Two-factor authentication {'enabled' if enabled else 'disabled'}",
            "enabled": enabled
        }
    else:
        raise HTTPException(status_code=500, detail="Failed to save settings")
