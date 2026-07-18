"""
Multi-Account MS Graph Client

Manages multiple Office 365 accounts for email ingestion.
Each account has its own credentials and dedicated ingestion pipeline.

Features:
- Multiple MS365 accounts support
- Per-account credential management
- Separate checkpoints for each account
- Unified ingestion to single knowledge base
- Account-specific Obsidian organization
"""

import os
import json
from typing import List, Dict, Any, Optional
from pathlib import Path
from dataclasses import dataclass
import logging

from .client import MSGraphClient


logger = logging.getLogger(__name__)


@dataclass
class MSGraphAccount:
    """
    Configuration for a single MS Graph account.

    Attributes:
        account_id: Unique identifier (e.g., "hein", "marco", "admin")
        client_id: Azure AD app client ID
        client_secret: Azure AD client secret
        tenant_id: Azure AD tenant ID
        user_email: User's email address
        display_name: Friendly name for display
        enabled: Whether this account is actively synced
    """
    account_id: str
    client_id: str
    client_secret: str
    tenant_id: str
    user_email: str
    display_name: str = ""
    enabled: bool = True

    def __post_init__(self):
        if not self.display_name:
            self.display_name = self.user_email


class MultiAccountMSGraphClient:
    """
    Multi-account MS Graph client manager.

    Manages multiple Office 365 accounts for email ingestion.
    Each account maintains separate:
    - MS Graph client instance
    - Ingestion checkpoint
    - Obsidian folder organization
    """

    def __init__(self, config_file: Optional[str] = None):
        """
        Initialize multi-account MS Graph client.

        Args:
            config_file: Path to accounts configuration file
                        (default: data/msgraph_accounts.json)
        """
        self.config_file = Path(config_file or "data/msgraph_accounts.json")
        self.accounts: Dict[str, MSGraphAccount] = {}
        self.clients: Dict[str, MSGraphClient] = {}

        # Load accounts from config file
        self._load_accounts()

        logger.info(f"Multi-account MS Graph client initialized with {len(self.accounts)} accounts")

    def _load_accounts(self):
        """Load account configurations from file or environment."""

        # First, try loading from config file
        if self.config_file.exists():
            with open(self.config_file, "r") as f:
                config = json.load(f)

            for account_data in config.get("accounts", []):
                account = MSGraphAccount(**account_data)
                self.accounts[account.account_id] = account

            logger.info(f"Loaded {len(self.accounts)} accounts from {self.config_file}")

        # If no config file, try loading primary account from environment
        elif os.getenv("MS_GRAPH_CLIENT_ID"):
            primary_account = MSGraphAccount(
                account_id="primary",
                client_id=os.getenv("MS_GRAPH_CLIENT_ID"),
                client_secret=os.getenv("MS_GRAPH_CLIENT_SECRET"),
                tenant_id=os.getenv("MS_GRAPH_TENANT_ID"),
                user_email=os.getenv("MS_GRAPH_USER_EMAIL"),
                display_name="Primary Account"
            )
            self.accounts["primary"] = primary_account

            # Save to config file for future use
            self._save_accounts()

            logger.info("Created primary account from environment variables")

        else:
            logger.warning("No MS Graph accounts configured")

    def _save_accounts(self):
        """Save account configurations to file."""
        self.config_file.parent.mkdir(parents=True, exist_ok=True)

        config = {
            "accounts": [
                {
                    "account_id": account.account_id,
                    "client_id": account.client_id,
                    "client_secret": account.client_secret,
                    "tenant_id": account.tenant_id,
                    "user_email": account.user_email,
                    "display_name": account.display_name,
                    "enabled": account.enabled
                }
                for account in self.accounts.values()
            ]
        }

        with open(self.config_file, "w") as f:
            json.dump(config, f, indent=2)

        logger.info(f"Saved {len(self.accounts)} accounts to {self.config_file}")

    def add_account(
        self,
        account_id: str,
        client_id: str,
        client_secret: str,
        tenant_id: str,
        user_email: str,
        display_name: str = "",
        enabled: bool = True
    ) -> MSGraphAccount:
        """
        Add a new MS Graph account.

        Args:
            account_id: Unique identifier (e.g., "hein", "marco")
            client_id: Azure AD app client ID
            client_secret: Azure AD client secret
            tenant_id: Azure AD tenant ID
            user_email: User's email address
            display_name: Friendly name (default: email address)
            enabled: Whether to sync this account (default: True)

        Returns:
            Created MSGraphAccount instance
        """
        account = MSGraphAccount(
            account_id=account_id,
            client_id=client_id,
            client_secret=client_secret,
            tenant_id=tenant_id,
            user_email=user_email,
            display_name=display_name or user_email,
            enabled=enabled
        )

        self.accounts[account_id] = account
        self._save_accounts()

        logger.info(f"Added account: {account_id} ({user_email})")

        return account

    def remove_account(self, account_id: str) -> bool:
        """
        Remove an MS Graph account.

        Args:
            account_id: Account identifier to remove

        Returns:
            True if account was removed, False if not found
        """
        if account_id in self.accounts:
            del self.accounts[account_id]

            # Close client if exists
            if account_id in self.clients:
                del self.clients[account_id]

            self._save_accounts()

            logger.info(f"Removed account: {account_id}")
            return True

        return False

    def enable_account(self, account_id: str):
        """Enable an account for syncing."""
        if account_id in self.accounts:
            self.accounts[account_id].enabled = True
            self._save_accounts()
            logger.info(f"Enabled account: {account_id}")

    def disable_account(self, account_id: str):
        """Disable an account (stop syncing)."""
        if account_id in self.accounts:
            self.accounts[account_id].enabled = False
            self._save_accounts()
            logger.info(f"Disabled account: {account_id}")

    def get_client(self, account_id: str) -> MSGraphClient:
        """
        Get MS Graph client for a specific account.

        Args:
            account_id: Account identifier

        Returns:
            MSGraphClient instance for the account

        Raises:
            KeyError: If account not found
        """
        if account_id not in self.accounts:
            raise KeyError(f"Account not found: {account_id}")

        # Create client if doesn't exist
        if account_id not in self.clients:
            account = self.accounts[account_id]

            self.clients[account_id] = MSGraphClient(
                client_id=account.client_id,
                client_secret=account.client_secret,
                tenant_id=account.tenant_id,
                user_email=account.user_email
            )

        return self.clients[account_id]

    def get_enabled_accounts(self) -> List[MSGraphAccount]:
        """Get list of enabled accounts."""
        return [
            account for account in self.accounts.values()
            if account.enabled
        ]

    def get_all_accounts(self) -> List[MSGraphAccount]:
        """Get list of all accounts."""
        return list(self.accounts.values())

    def list_accounts(self) -> List[Dict[str, Any]]:
        """
        List all accounts with status information.

        Returns:
            List of account info dicts
        """
        accounts_info = []

        for account_id, account in self.accounts.items():
            info = {
                "account_id": account_id,
                "user_email": account.user_email,
                "display_name": account.display_name,
                "enabled": account.enabled,
                "tenant_id": account.tenant_id,
                "has_client": account_id in self.clients
            }
            accounts_info.append(info)

        return accounts_info

    async def test_connection(self, account_id: str) -> bool:
        """
        Test MS Graph connection for an account.

        Args:
            account_id: Account identifier

        Returns:
            True if connection successful, False otherwise
        """
        try:
            client = self.get_client(account_id)

            # Try to fetch one email to test connection
            emails = await client.get_emails(folder="inbox", limit=1)

            logger.info(f"✅ Connection test successful for {account_id}")
            return True

        except Exception as e:
            logger.error(f"❌ Connection test failed for {account_id}: {e}")
            return False

    def get_checkpoint_file(self, account_id: str) -> Path:
        """Get checkpoint file path for a specific account."""
        return Path(f"data/msgraph_checkpoint_{account_id}.json")

    def get_obsidian_folder(self, account_id: str) -> str:
        """
        Get Obsidian folder name for an account.

        Emails are organized as:
        - Documents/Emails/{account_id}/Inbox/
        - Documents/Emails/{account_id}/Sent/

        Args:
            account_id: Account identifier

        Returns:
            Folder name for this account
        """
        account = self.accounts.get(account_id)
        if account:
            # Use display name if set, otherwise account_id
            return account.display_name.replace("@", "_").replace(".", "_")
        return account_id


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

def get_multi_account_client(config_file: Optional[str] = None) -> MultiAccountMSGraphClient:
    """Get a multi-account MS Graph client instance."""
    return MultiAccountMSGraphClient(config_file=config_file)


def create_account_config_from_env() -> Dict[str, Any]:
    """
    Create accounts configuration from environment variables.

    Supports multiple accounts via indexed env vars:
    - MS_GRAPH_CLIENT_ID (primary)
    - MS_GRAPH_2_CLIENT_ID (second account)
    - MS_GRAPH_3_CLIENT_ID (third account)
    etc.
    """
    accounts = []

    # Primary account
    if os.getenv("MS_GRAPH_CLIENT_ID"):
        accounts.append({
            "account_id": "primary",
            "client_id": os.getenv("MS_GRAPH_CLIENT_ID"),
            "client_secret": os.getenv("MS_GRAPH_CLIENT_SECRET"),
            "tenant_id": os.getenv("MS_GRAPH_TENANT_ID"),
            "user_email": os.getenv("MS_GRAPH_USER_EMAIL"),
            "display_name": "Primary Account",
            "enabled": True
        })

    # Additional numbered accounts
    i = 2
    while os.getenv(f"MS_GRAPH_{i}_CLIENT_ID"):
        accounts.append({
            "account_id": f"account_{i}",
            "client_id": os.getenv(f"MS_GRAPH_{i}_CLIENT_ID"),
            "client_secret": os.getenv(f"MS_GRAPH_{i}_CLIENT_SECRET"),
            "tenant_id": os.getenv(f"MS_GRAPH_{i}_TENANT_ID"),
            "user_email": os.getenv(f"MS_GRAPH_{i}_USER_EMAIL"),
            "display_name": os.getenv(f"MS_GRAPH_{i}_DISPLAY_NAME", f"Account {i}"),
            "enabled": os.getenv(f"MS_GRAPH_{i}_ENABLED", "true").lower() == "true"
        })
        i += 1

    return {"accounts": accounts}
