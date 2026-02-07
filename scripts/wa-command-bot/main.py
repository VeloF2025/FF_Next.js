#!/usr/bin/env python3
"""
WhatsApp Command Bot for FibreFlow Self-Healing

Receives commands via webhook from WA Bridge and executes infrastructure actions.

Commands:
  restart <service>  - Restart a service (vlm, qfield, production, etc.)
  status             - Get all service health status
  status <service>   - Get specific service status
  approve <token>    - Approve a pending recovery action
  help               - Show available commands

Security:
  - Only processes messages from admin group(s)
  - Logs all commands to database
  - Dangerous actions require approval
"""

import asyncio
import logging
import os
import re
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from uuid import uuid4

import aiohttp
from aiohttp import web
import asyncpg

# Configuration
DATABASE_URL = os.getenv('DATABASE_URL', 'process.env.DATABASE_URL')
SQLITE_DB_PATH = os.getenv('SQLITE_DB_PATH', '/opt/whatsapp-bridge/store/messages.db')
WA_SENDER_URL = os.getenv('WA_SENDER_URL', 'http://localhost:8081')
WEBHOOK_PORT = int(os.getenv('WEBHOOK_PORT', '8086'))
LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')

# Admin groups that can send commands
ADMIN_GROUPS = [
    '120363421664266245@g.us',  # Velo Test
    '120363423864087150@g.us',  # AI Recovery alerts group
]

# Service name mappings
SERVICE_ALIASES = {
    'vlm': 'VLM (Qwen3)',
    'qwen': 'VLM (Qwen3)',
    'qfield': 'QField Sync Webhook',
    'qfieldsync': 'QField Sync Webhook',
    'qfieldcloud': 'QFieldCloud',
    'production': 'FibreFlow Production',
    'prod': 'FibreFlow Production',
    'staging': 'FibreFlow Staging',
    'dev': 'FibreFlow Dev',
    'grafana': 'Grafana',
    'portainer': 'Portainer',
    'pdfcraft': 'PDFCraft',
    'wa-feedback': 'WA Feedback',
    'wafeedback': 'WA Feedback',
    'wa-bridge': 'WhatsApp Bridge',
    'wabridge': 'WhatsApp Bridge',
    'wa-sender': 'WhatsApp Sender',
    'wasender': 'WhatsApp Sender',
    'wa-monitor': 'WA Monitor Prod',
    'wamonitor': 'WA Monitor Prod',
}

# Configure logging
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger('wa-command-bot')


class CommandBot:
    """WhatsApp Command Bot for infrastructure management."""

    def __init__(self):
        self.db_pool: Optional[asyncpg.Pool] = None
        self._session: Optional[aiohttp.ClientSession] = None
        self.command_count = 0
        self.started_at = datetime.now(timezone.utc)
        self.last_processed_timestamp: Optional[str] = None
        self._poll_task: Optional[asyncio.Task] = None

    async def start(self):
        """Initialize database and HTTP session."""
        logger.info("Starting WhatsApp Command Bot...")

        # Create database pool
        self.db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
        logger.info("Database connection established")

        # Create HTTP session
        self._session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30))

        # Start polling for commands
        self._poll_task = asyncio.create_task(self.poll_for_commands())

        logger.info(f"Command Bot ready on port {WEBHOOK_PORT}")
        logger.info(f"Polling SQLite for commands from {len(ADMIN_GROUPS)} admin groups...")

    async def stop(self):
        """Cleanup resources."""
        if self._poll_task:
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass
        if self._session:
            await self._session.close()
        if self.db_pool:
            await self.db_pool.close()
        logger.info("Command Bot stopped")

    async def handle_webhook(self, request: web.Request) -> web.Response:
        """Handle incoming webhook from WA Bridge."""
        try:
            data = await request.json()

            chat_jid = data.get('chat_jid', '')
            sender_jid = data.get('sender_jid', '')
            message_text = data.get('message', '').strip()
            message_id = data.get('message_id', '')

            # Only process from admin groups
            if chat_jid not in ADMIN_GROUPS:
                logger.debug(f"Ignoring message from non-admin group: {chat_jid}")
                return web.json_response({'success': True, 'action': 'ignored'})

            # Check if it's a command (starts with ! or /)
            if not message_text or not (message_text.startswith('!') or message_text.startswith('/')):
                return web.json_response({'success': True, 'action': 'ignored'})

            # Parse and execute command
            command = message_text[1:].strip()  # Remove ! or /
            logger.info(f"Command received: '{command}' from {sender_jid} in {chat_jid}")

            response = await self.execute_command(command, sender_jid, chat_jid)

            # Send response back to WhatsApp
            await self.send_response(chat_jid, response)

            # Log command to database
            await self.log_command(command, sender_jid, chat_jid, response)

            self.command_count += 1

            return web.json_response({'success': True, 'response': response})

        except Exception as e:
            logger.error(f"Webhook error: {e}")
            return web.json_response({'success': False, 'error': str(e)}, status=500)

    async def execute_command(self, command: str, sender_jid: str, chat_jid: str) -> str:
        """Parse and execute a command."""
        parts = command.lower().split()
        if not parts:
            return "Empty command. Try: !help"

        cmd = parts[0]
        args = parts[1:] if len(parts) > 1 else []

        if cmd == 'help':
            return self.get_help()

        elif cmd == 'status':
            if args:
                return await self.get_service_status(args[0])
            return await self.get_all_status()

        elif cmd == 'restart':
            if not args:
                return "Usage: !restart <service>\nExample: !restart vlm"
            return await self.restart_service(args[0], sender_jid)

        elif cmd == 'approve':
            if not args:
                return "Usage: !approve <token>"
            return await self.approve_action(args[0], sender_jid)

        elif cmd == 'health':
            return await self.get_health_summary()

        elif cmd == 'pending':
            return await self.get_pending_approvals()

        else:
            return f"Unknown command: {cmd}\nTry: !help"

    def get_help(self) -> str:
        """Return help text."""
        return """*FibreFlow Command Bot* 🤖

*Commands:*
• `!status` - All service health
• `!status <service>` - Specific service
• `!restart <service>` - Restart a service
• `!approve <token>` - Approve action
• `!pending` - Show pending approvals
• `!health` - Quick health summary
• `!help` - This message

*Services:*
vlm, qfield, production, staging, dev, grafana, portainer, pdfcraft, wa-feedback, wa-bridge, wa-sender

*Examples:*
• `!restart vlm`
• `!status production`
• `!approve abc123`"""

    async def get_all_status(self) -> str:
        """Get status of all services."""
        try:
            rows = await self.db_pool.fetch('''
                SELECT name, is_critical, is_enabled
                FROM infrastructure_services
                WHERE is_enabled = true
                ORDER BY is_critical DESC, name
            ''')

            # Get latest health check
            health = await self.db_pool.fetchrow('''
                SELECT healthy_count, down_count, created_at
                FROM system_health_logs
                ORDER BY created_at DESC
                LIMIT 1
            ''')

            lines = ["*Service Status* 📊\n"]

            if health:
                ago = (datetime.now(timezone.utc) - health['created_at'].replace(tzinfo=timezone.utc)).total_seconds()
                lines.append(f"_Last check: {int(ago)}s ago_")
                lines.append(f"✅ {health['healthy_count']} healthy | ❌ {health['down_count']} down\n")

            for row in rows:
                icon = "🔴" if row['is_critical'] else "⚪"
                lines.append(f"{icon} {row['name']}")

            return "\n".join(lines)

        except Exception as e:
            logger.error(f"Error getting status: {e}")
            return f"Error: {e}"

    async def get_service_status(self, service_name: str) -> str:
        """Get status of a specific service."""
        # Resolve alias
        canonical = SERVICE_ALIASES.get(service_name.lower(), service_name)

        try:
            row = await self.db_pool.fetchrow('''
                SELECT s.name, s.is_critical, s.health_endpoint, s.recovery_enabled,
                       ra.action_name, ra.risk_level, ra.last_executed, ra.last_success
                FROM infrastructure_services s
                LEFT JOIN recovery_actions ra ON s.id = ra.service_id
                WHERE LOWER(s.name) = LOWER($1)
            ''', canonical)

            if not row:
                return f"Service not found: {service_name}\nTry: !status"

            lines = [f"*{row['name']}*\n"]
            lines.append(f"Critical: {'Yes 🔴' if row['is_critical'] else 'No'}")
            lines.append(f"Recovery: {'Enabled ✅' if row['recovery_enabled'] else 'Disabled'}")

            if row['action_name']:
                lines.append(f"Action: {row['action_name']} ({row['risk_level']})")
                if row['last_executed']:
                    lines.append(f"Last run: {row['last_executed'].strftime('%Y-%m-%d %H:%M')}")

            return "\n".join(lines)

        except Exception as e:
            logger.error(f"Error getting service status: {e}")
            return f"Error: {e}"

    async def restart_service(self, service_name: str, sender_jid: str) -> str:
        """Restart a service."""
        # Resolve alias
        canonical = SERVICE_ALIASES.get(service_name.lower(), service_name)

        try:
            # Get service and action info
            row = await self.db_pool.fetchrow('''
                SELECT s.id, s.name, ra.id as action_id, ra.action_name, ra.command,
                       ra.command_type, ra.risk_level, ra.requires_approval,
                       ra.ssh_host, ra.ssh_user
                FROM infrastructure_services s
                JOIN recovery_actions ra ON s.id = ra.service_id
                WHERE LOWER(s.name) = LOWER($1)
            ''', canonical)

            if not row:
                return f"Service not found or no restart action: {service_name}"

            # Check if requires approval
            if row['requires_approval'] or row['risk_level'] in ('moderate', 'dangerous'):
                # Create approval request
                token = str(uuid4())[:8]
                await self.db_pool.execute('''
                    INSERT INTO recovery_approval_queue (
                        id, action_id, requested_by, approval_token, status,
                        requested_at, token_expires_at
                    ) VALUES (
                        gen_random_uuid(), $1, $2, $3, 'pending',
                        NOW(), NOW() + INTERVAL '10 minutes'
                    )
                ''', row['action_id'], sender_jid, token)

                return f"⚠️ *Approval Required*\n\nService: {row['name']}\nAction: {row['action_name']}\nRisk: {row['risk_level']}\n\nReply: `!approve {token}`\n_Expires in 10 minutes_"

            # Execute safe action directly
            success, output = await self.execute_recovery_action(row)

            if success:
                return f"✅ *Restarted* {row['name']}\n\n{output[:200]}"
            else:
                return f"❌ *Failed* to restart {row['name']}\n\n{output[:200]}"

        except Exception as e:
            logger.error(f"Error restarting service: {e}")
            return f"Error: {e}"

    async def execute_recovery_action(self, action: Dict[str, Any]) -> tuple[bool, str]:
        """Execute a recovery action command."""
        try:
            command = action['command']
            command_type = action['command_type']

            if command_type == 'ssh' and action.get('ssh_host'):
                # SSH command - would need SSH key setup
                # For now, use sshpass if available
                full_cmd = f"sshpass -p "$VELO_SSH_PASSWORD" ssh -o StrictHostKeyChecking=no {action['ssh_user']}@{action['ssh_host']} \"{command}\""
            else:
                # Local bash command
                full_cmd = f"echo '$VELO_SSH_PASSWORD' | sudo -S {command}"

            logger.info(f"Executing: {command}")

            result = subprocess.run(
                full_cmd,
                shell=True,
                capture_output=True,
                text=True,
                timeout=60
            )

            success = result.returncode == 0
            output = result.stdout if success else result.stderr

            # Update action stats
            if success:
                await self.db_pool.execute('''
                    UPDATE recovery_actions
                    SET success_count = success_count + 1,
                        last_executed = NOW(),
                        last_success = NOW(),
                        consecutive_success = consecutive_success + 1,
                        consecutive_failure = 0
                    WHERE id = $1
                ''', action['action_id'])
            else:
                await self.db_pool.execute('''
                    UPDATE recovery_actions
                    SET failure_count = failure_count + 1,
                        last_executed = NOW(),
                        last_failure = NOW(),
                        consecutive_failure = consecutive_failure + 1,
                        consecutive_success = 0
                    WHERE id = $1
                ''', action['action_id'])

            return success, output.strip() or "OK"

        except subprocess.TimeoutExpired:
            return False, "Command timed out"
        except Exception as e:
            return False, str(e)

    async def approve_action(self, token: str, sender_jid: str) -> str:
        """Approve a pending action."""
        try:
            # Find pending approval
            row = await self.db_pool.fetchrow('''
                SELECT q.id, q.action_id, q.token_expires_at,
                       ra.action_name, ra.command, ra.command_type, ra.ssh_host, ra.ssh_user,
                       s.name as service_name
                FROM recovery_approval_queue q
                JOIN recovery_actions ra ON q.action_id = ra.id
                JOIN infrastructure_services s ON ra.service_id = s.id
                WHERE q.approval_token = $1 AND q.status = 'pending'
            ''', token)

            if not row:
                return f"Invalid or expired token: {token}"

            if row['token_expires_at'].replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
                await self.db_pool.execute('''
                    UPDATE recovery_approval_queue SET status = 'expired' WHERE id = $1
                ''', row['id'])
                return "Token expired. Request a new restart."

            # Mark as approved
            await self.db_pool.execute('''
                UPDATE recovery_approval_queue
                SET status = 'approved', decided_at = NOW(), decided_by = $1
                WHERE id = $2
            ''', sender_jid, row['id'])

            # Execute the action
            action = {
                'action_id': row['action_id'],
                'command': row['command'],
                'command_type': row['command_type'],
                'ssh_host': row['ssh_host'],
                'ssh_user': row['ssh_user'],
            }

            success, output = await self.execute_recovery_action(action)

            if success:
                return f"✅ *Approved & Executed*\n\n{row['service_name']}: {row['action_name']}\n\n{output[:200]}"
            else:
                return f"❌ *Approved but Failed*\n\n{row['service_name']}\n\n{output[:200]}"

        except Exception as e:
            logger.error(f"Error approving action: {e}")
            return f"Error: {e}"

    async def get_health_summary(self) -> str:
        """Get quick health summary."""
        try:
            health = await self.db_pool.fetchrow('''
                SELECT healthy_count, down_count, created_at
                FROM system_health_logs
                ORDER BY created_at DESC
                LIMIT 1
            ''')

            if not health:
                return "No health data available"

            ago = (datetime.now(timezone.utc) - health['created_at'].replace(tzinfo=timezone.utc)).total_seconds()

            if health['down_count'] == 0:
                emoji = "✅"
                status = "All systems operational"
            else:
                emoji = "⚠️"
                status = f"{health['down_count']} service(s) down"

            return f"{emoji} *Health Summary*\n\n{status}\n✅ {health['healthy_count']} healthy\n❌ {health['down_count']} down\n\n_Updated {int(ago)}s ago_"

        except Exception as e:
            return f"Error: {e}"

    async def get_pending_approvals(self) -> str:
        """Get pending approval requests."""
        try:
            rows = await self.db_pool.fetch('''
                SELECT q.approval_token, q.requested_at, q.token_expires_at,
                       ra.action_name, s.name as service_name
                FROM recovery_approval_queue q
                JOIN recovery_actions ra ON q.action_id = ra.id
                JOIN infrastructure_services s ON ra.service_id = s.id
                WHERE q.status = 'pending' AND q.token_expires_at > NOW()
                ORDER BY q.requested_at DESC
                LIMIT 10
            ''')

            if not rows:
                return "No pending approvals"

            lines = ["*Pending Approvals* ⏳\n"]
            for row in rows:
                expires = (row['token_expires_at'].replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)).total_seconds()
                lines.append(f"• {row['service_name']}: {row['action_name']}")
                lines.append(f"  `!approve {row['approval_token']}` _{int(expires/60)}m left_\n")

            return "\n".join(lines)

        except Exception as e:
            return f"Error: {e}"

    async def send_response(self, group_jid: str, message: str) -> bool:
        """Send response back to WhatsApp group."""
        try:
            payload = {
                'group_jid': group_jid,
                'recipient_jid': '0@s.whatsapp.net',
                'message': message,
            }

            async with self._session.post(
                f'{WA_SENDER_URL}/send-message',
                json=payload
            ) as response:
                if response.status < 400:
                    logger.info(f"Response sent to {group_jid}")
                    return True
                else:
                    text = await response.text()
                    logger.error(f"Failed to send response: {response.status} - {text}")
                    return False

        except Exception as e:
            logger.error(f"Error sending response: {e}")
            return False

    async def log_command(self, command: str, sender_jid: str, chat_jid: str, response: str):
        """Log command to database."""
        try:
            await self.db_pool.execute('''
                INSERT INTO wa_admin_audit_log (
                    id, action, entity_type, entity_id, old_value, new_value,
                    user_id, user_email, created_at
                ) VALUES (
                    gen_random_uuid(), 'command_bot', 'command', $1, $2, $3,
                    NULL, $4, NOW()
                )
            ''', command, chat_jid, response[:500], sender_jid)
        except Exception as e:
            logger.error(f"Error logging command: {e}")

    async def poll_for_commands(self):
        """Poll SQLite messages.db for new commands from admin groups."""
        logger.info(f"Starting command polling loop (SQLite: {SQLITE_DB_PATH})...")

        # Initialize last timestamp to now (skip existing messages)
        # Use SQLite-compatible format: YYYY-MM-DD HH:MM:SS
        self.last_processed_timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
        logger.info(f"Starting from timestamp: {self.last_processed_timestamp}")

        while True:
            try:
                await asyncio.sleep(2)  # Poll every 2 seconds

                # Query SQLite for new commands from admin groups
                # Note: SQLite uses chat_jid, sender, content, timestamp columns
                # is_from_me=0 means incoming message
                conn = sqlite3.connect(SQLITE_DB_PATH, timeout=5)
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()

                # Build placeholders for admin groups
                placeholders = ','.join('?' for _ in ADMIN_GROUPS)
                query = f'''
                    SELECT id, chat_jid, sender, content, timestamp
                    FROM messages
                    WHERE chat_jid IN ({placeholders})
                      AND is_from_me = 0
                      AND timestamp > ?
                      AND content IS NOT NULL
                      AND (content LIKE '!%' OR content LIKE '/%')
                    ORDER BY timestamp ASC
                    LIMIT 10
                '''
                params = list(ADMIN_GROUPS) + [self.last_processed_timestamp]
                cursor.execute(query, params)
                rows = cursor.fetchall()
                conn.close()

                for row in rows:
                    content = row['content'].strip()
                    chat_jid = row['chat_jid']
                    sender = row['sender'] or 'unknown'
                    timestamp = row['timestamp']

                    # Parse and execute command
                    command = content[1:].strip()  # Remove ! or /
                    logger.info(f"Command from SQLite: '{command}' from {sender} in {chat_jid}")

                    response = await self.execute_command(command, sender, chat_jid)

                    # Send response back to WhatsApp
                    await self.send_response(chat_jid, response)

                    # Log command to PostgreSQL
                    await self.log_command(command, sender, chat_jid, response)

                    self.command_count += 1
                    self.last_processed_timestamp = timestamp

            except asyncio.CancelledError:
                logger.info("Polling loop cancelled")
                break
            except Exception as e:
                logger.error(f"Polling error: {e}")
                await asyncio.sleep(5)  # Wait longer on error

    async def handle_health(self, request: web.Request) -> web.Response:
        """Health check endpoint."""
        uptime = (datetime.now(timezone.utc) - self.started_at).total_seconds()
        return web.json_response({
            'status': 'healthy',
            'uptime_seconds': int(uptime),
            'commands_processed': self.command_count,
        })


async def main():
    """Main entry point."""
    bot = CommandBot()

    try:
        await bot.start()

        # Create web app
        app = web.Application()
        app.router.add_post('/webhook', bot.handle_webhook)
        app.router.add_get('/health', bot.handle_health)

        # Start server
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, '0.0.0.0', WEBHOOK_PORT)
        await site.start()

        logger.info(f"Command Bot listening on port {WEBHOOK_PORT}")
        logger.info(f"Webhook: POST http://localhost:{WEBHOOK_PORT}/webhook")
        logger.info(f"Health:  GET  http://localhost:{WEBHOOK_PORT}/health")

        # Keep running
        while True:
            await asyncio.sleep(3600)

    except KeyboardInterrupt:
        logger.info("Shutting down...")
    finally:
        await bot.stop()


if __name__ == '__main__':
    asyncio.run(main())
