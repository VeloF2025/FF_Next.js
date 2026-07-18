"""
Multi-Account Email Manager

Coordinates multiple email accounts (MS Graph + IMAP) with unified processing.
"""

import os
import json
import asyncio
from pathlib import Path
from typing import List, Dict, Any, Optional
from dataclasses import dataclass

from agents.communication.email_agent import EmailAgent
from orchestration.approval_manager import ApprovalManager


class MultiAccountEmailManager:
    """Manages multiple email accounts with Fyxer-style processing."""
    
    def __init__(self, config_dir: Optional[Path] = None):
        self.config_dir = config_dir or Path("data")
        self.approval_manager = ApprovalManager()
        self.accounts: Dict[str, dict] = {}
        self.agents: Dict[str, EmailAgent] = {}
        
    async def load_accounts(self) -> int:
        """Load account configurations from JSON files."""
        loaded = 0

        # Load MS Graph accounts
        msgraph_file = self.config_dir / "msgraph_accounts.json"
        if msgraph_file.exists():
            with open(msgraph_file) as f:
                data = json.load(f)
                for account in data.get("accounts", []):
                    if account.get("enabled", True):
                        account["backend"] = "msgraph"
                        self.accounts[account["account_id"]] = account
                        loaded += 1

        # Load IMAP accounts
        imap_file = self.config_dir / "imap_accounts.json"
        if imap_file.exists():
            with open(imap_file) as f:
                data = json.load(f)
                for account in data.get("accounts", []):
                    if account.get("enabled", True):
                        account["backend"] = "imap"
                        self.accounts[account["account_id"]] = account
                        loaded += 1

        return loaded
    
    async def process_all_accounts(self, limit: int = 10) -> dict:
        """Process emails from all enabled accounts."""
        results = {
            "accounts_processed": 0,
            "total_emails": 0,
            "total_drafts": 0,
            "accounts": []
        }

        for account_id, account_config in self.accounts.items():
            if not account_config.get("enabled", True):
                continue

            # Get email based on backend type
            if account_config["backend"] == "msgraph":
                email = account_config.get("user_email", "unknown")
            else:  # imap
                email = account_config.get("username", "unknown")

            display_name = account_config.get("display_name", account_id)

            print(f"\nProcessing: {display_name} ({email})")
            print(f"  Backend: {account_config['backend']}")

            account_result = {
                "account_id": account_id,
                "email": email,
                "backend": account_config["backend"],
                "emails_processed": 0,
                "drafts_created": 0
            }

            # TODO: Implement actual email processing with EmailAgent
            # This will be done in the next step

            results["accounts_processed"] += 1
            results["accounts"].append(account_result)

        return results
    
    def get_account_list(self) -> List[dict]:
        """Get list of all configured accounts."""
        return list(self.accounts.values())


if __name__ == "__main__":
    manager = MultiAccountEmailManager()
    print("Multi-Account Email Manager initialized")
