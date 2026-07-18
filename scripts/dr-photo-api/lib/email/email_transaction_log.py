"""
Email Transaction Log - Rollback System

Tracks all email processing changes with ability to rollback:
- Category assignments
- Folder moves
- Draft generations
- Label changes
"""

import json
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, asdict
import logging

logger = logging.getLogger(__name__)


@dataclass
class EmailTransaction:
    """Single email processing transaction."""
    transaction_id: str
    email_id: str
    timestamp: str
    action: str  # "categorize", "move_folder", "create_draft", "apply_label"
    backend: str  # "msgraph" or "imap"

    # Before state (for rollback)
    before_state: Dict[str, Any]

    # After state (current)
    after_state: Dict[str, Any]

    # Additional metadata
    metadata: Optional[Dict[str, Any]] = None


class EmailTransactionLog:
    """
    Transaction log for email processing with rollback capability.

    Records all changes made during email processing so they can be undone.
    """

    def __init__(self, log_file: Optional[Path] = None):
        """
        Initialize transaction log.

        Args:
            log_file: Path to transaction log file (default: data/email_transactions.jsonl)
        """
        self.log_file = log_file or Path("data/email_transactions.jsonl")
        self.log_file.parent.mkdir(parents=True, exist_ok=True)

        # In-memory transaction cache for current session
        self.transactions: List[EmailTransaction] = []

        # Load existing transactions from file
        self._load_from_file()

        logger.info(f"Email transaction log initialized: {self.log_file} ({len(self.transactions)} transactions loaded)")

    def _load_from_file(self) -> None:
        """Load existing transactions from log file."""
        if not self.log_file.exists():
            return

        try:
            with open(self.log_file, 'r') as f:
                for line in f:
                    if line.strip():
                        data = json.loads(line)
                        txn = EmailTransaction(**data)
                        self.transactions.append(txn)
        except Exception as e:
            logger.error(f"Error loading transactions from file: {e}")

    def log_transaction(
        self,
        transaction_id: str,
        email_id: str,
        action: str,
        backend: str,
        before_state: Dict[str, Any],
        after_state: Dict[str, Any],
        metadata: Optional[Dict[str, Any]] = None
    ) -> None:
        """
        Log an email processing transaction.

        Args:
            transaction_id: Unique transaction ID
            email_id: Email identifier
            action: Type of action performed
            backend: Email backend (msgraph/imap)
            before_state: State before change
            after_state: State after change
            metadata: Additional context
        """
        transaction = EmailTransaction(
            transaction_id=transaction_id,
            email_id=email_id,
            timestamp=datetime.now().isoformat(),
            action=action,
            backend=backend,
            before_state=before_state,
            after_state=after_state,
            metadata=metadata or {}
        )

        # Add to memory cache
        self.transactions.append(transaction)

        # Append to log file
        with open(self.log_file, 'a') as f:
            f.write(json.dumps(asdict(transaction)) + '\n')

        logger.debug(f"Logged transaction: {transaction_id} - {action} on {email_id}")

    def get_transactions_for_email(self, email_id: str) -> List[EmailTransaction]:
        """
        Get all transactions for a specific email.

        Args:
            email_id: Email identifier

        Returns:
            List of transactions for this email
        """
        return [t for t in self.transactions if t.email_id == email_id]

    def get_recent_transactions(self, limit: int = 50) -> List[EmailTransaction]:
        """
        Get recent transactions.

        Args:
            limit: Maximum number to return

        Returns:
            List of recent transactions
        """
        return self.transactions[-limit:]

    async def rollback_transaction(
        self,
        transaction_id: str,
        email_client: Any
    ) -> bool:
        """
        Rollback a specific transaction.

        Args:
            transaction_id: Transaction to rollback
            email_client: Email client (MSGraphClient or IMAPClient)

        Returns:
            True if rollback successful
        """
        # Find transaction
        transaction = None
        for t in self.transactions:
            if t.transaction_id == transaction_id:
                transaction = t
                break

        if not transaction:
            logger.error(f"Transaction not found: {transaction_id}")
            return False

        logger.info(f"Rolling back transaction: {transaction_id} ({transaction.action})")

        try:
            if transaction.action == "categorize":
                # Rollback category change
                original_categories = transaction.before_state.get("categories", [])

                if transaction.backend == "msgraph":
                    # MS Graph: Restore original categories
                    await email_client.update_message_categories(
                        transaction.email_id,
                        original_categories
                    )
                    logger.info(f"✅ Restored categories: {original_categories}")

                elif transaction.backend == "imap":
                    # IMAP: Move back to original folder
                    original_folder = transaction.before_state.get("folder", "INBOX")
                    await email_client.move_email(
                        transaction.email_id.encode(),
                        original_folder
                    )
                    logger.info(f"✅ Moved back to: {original_folder}")

            elif transaction.action == "create_draft":
                # Rollback draft creation (delete draft)
                draft_id = transaction.after_state.get("draft_id")

                if draft_id and transaction.backend == "msgraph":
                    # MS Graph: Delete draft from mailbox
                    await email_client.delete_message(draft_id)
                    logger.info(f"✅ Deleted draft: {draft_id}")

            elif transaction.action == "move_folder":
                # Rollback folder move
                original_folder = transaction.before_state.get("folder")

                if transaction.backend == "imap":
                    await email_client.move_email(
                        transaction.email_id.encode(),
                        original_folder
                    )
                    logger.info(f"✅ Moved back to: {original_folder}")

            logger.info(f"✅ Rollback successful: {transaction_id}")
            return True

        except Exception as e:
            logger.error(f"❌ Rollback failed: {e}")
            return False

    async def rollback_email(
        self,
        email_id: str,
        email_client: Any
    ) -> int:
        """
        Rollback all changes for a specific email.

        Args:
            email_id: Email to rollback
            email_client: Email client

        Returns:
            Number of transactions rolled back
        """
        transactions = self.get_transactions_for_email(email_id)

        if not transactions:
            logger.warning(f"No transactions found for email: {email_id}")
            return 0

        logger.info(f"Rolling back {len(transactions)} transactions for email: {email_id}")

        # Rollback in reverse order (most recent first)
        rollback_count = 0
        for transaction in reversed(transactions):
            success = await self.rollback_transaction(transaction.transaction_id, email_client)
            if success:
                rollback_count += 1

        logger.info(f"✅ Rolled back {rollback_count}/{len(transactions)} transactions")
        return rollback_count

    async def rollback_batch(
        self,
        transaction_ids: List[str],
        email_client: Any
    ) -> Dict[str, bool]:
        """
        Rollback multiple transactions.

        Args:
            transaction_ids: List of transaction IDs to rollback
            email_client: Email client

        Returns:
            Dict mapping transaction_id to success status
        """
        results = {}

        for transaction_id in transaction_ids:
            success = await self.rollback_transaction(transaction_id, email_client)
            results[transaction_id] = success

        successful = sum(1 for s in results.values() if s)
        logger.info(f"Batch rollback: {successful}/{len(transaction_ids)} successful")

        return results

    def get_rollback_summary(self) -> Dict[str, Any]:
        """
        Get summary of transactions available for rollback.

        Returns:
            Summary statistics
        """
        return {
            "total_transactions": len(self.transactions),
            "by_action": self._count_by_action(),
            "by_backend": self._count_by_backend(),
            "unique_emails": len(set(t.email_id for t in self.transactions)),
            "log_file": str(self.log_file)
        }

    def _count_by_action(self) -> Dict[str, int]:
        """Count transactions by action type."""
        counts = {}
        for t in self.transactions:
            counts[t.action] = counts.get(t.action, 0) + 1
        return counts

    def _count_by_backend(self) -> Dict[str, int]:
        """Count transactions by backend."""
        counts = {}
        for t in self.transactions:
            counts[t.backend] = counts.get(t.backend, 0) + 1
        return counts


# Global transaction log instance
_transaction_log = None


def get_transaction_log() -> EmailTransactionLog:
    """Get global transaction log instance."""
    global _transaction_log
    if _transaction_log is None:
        _transaction_log = EmailTransactionLog()
    return _transaction_log


if __name__ == "__main__":
    # Test transaction log
    log = EmailTransactionLog()

    log.log_transaction(
        transaction_id="test_001",
        email_id="email_123",
        action="categorize",
        backend="msgraph",
        before_state={"categories": []},
        after_state={"categories": ["Financial"]},
        metadata={"confidence": 0.95}
    )

    print("Transaction log test complete")
    print(f"Summary: {log.get_rollback_summary()}")
