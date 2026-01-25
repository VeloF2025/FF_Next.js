#!/usr/bin/env python3
"""
Log Watcher - Watches bridge logs for commands and forwards to Command Bot.

This is a workaround since we can't modify the compiled Go bridge.
It tails the bridge log and extracts command messages.
"""

import asyncio
import json
import logging
import os
import re
import sys
from datetime import datetime

import aiohttp

BRIDGE_LOG = os.getenv('BRIDGE_LOG', '/opt/whatsapp-bridge/bridge.log')
COMMAND_BOT_URL = os.getenv('COMMAND_BOT_URL', 'http://localhost:8086/webhook')
LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')

# Admin groups
ADMIN_GROUPS = [
    '120363421664266245@g.us',  # Velo Test
    '120363423864087150@g.us',  # AI Recovery alerts
]

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger('log-watcher')

# Pattern to match message events
# Example: 🔥 Message event received: ID=xxx, Chat=120363421664266245@g.us, Sender=xxx@lid
MESSAGE_PATTERN = re.compile(
    r'Message event received: ID=([^,]+), Chat=([^,]+), Sender=([^\s]+)'
)

# Pattern to match message content from subsequent log lines
# We need to capture the actual message text
TEXT_PATTERN = re.compile(r'📝 Text message: (.+)')


async def tail_log(filepath: str):
    """Async generator that tails a log file."""
    with open(filepath, 'r') as f:
        # Go to end of file
        f.seek(0, 2)

        while True:
            line = f.readline()
            if line:
                yield line.strip()
            else:
                await asyncio.sleep(0.1)


async def forward_command(session: aiohttp.ClientSession, chat_jid: str,
                          sender_jid: str, message_id: str, message_text: str):
    """Forward a command to the command bot."""
    try:
        payload = {
            'chat_jid': chat_jid,
            'sender_jid': sender_jid,
            'message_id': message_id,
            'message': message_text,
        }

        async with session.post(COMMAND_BOT_URL, json=payload) as response:
            if response.status < 400:
                data = await response.json()
                logger.info(f"Command forwarded: {message_text[:30]}... -> {data.get('action', 'processed')}")
            else:
                text = await response.text()
                logger.error(f"Failed to forward: {response.status} - {text}")

    except Exception as e:
        logger.error(f"Error forwarding command: {e}")


async def main():
    """Main entry point."""
    logger.info(f"Starting log watcher...")
    logger.info(f"Watching: {BRIDGE_LOG}")
    logger.info(f"Forwarding to: {COMMAND_BOT_URL}")

    session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10))

    # State for tracking message events
    pending_message = None

    try:
        async for line in tail_log(BRIDGE_LOG):
            # Check for message event
            match = MESSAGE_PATTERN.search(line)
            if match:
                msg_id, chat_jid, sender_jid = match.groups()

                # Only track messages from admin groups
                if chat_jid in ADMIN_GROUPS:
                    pending_message = {
                        'id': msg_id,
                        'chat_jid': chat_jid,
                        'sender_jid': sender_jid,
                    }
                    logger.debug(f"Message event from admin group: {chat_jid}")
                continue

            # Check for text content if we have a pending message
            if pending_message:
                text_match = TEXT_PATTERN.search(line)
                if text_match:
                    message_text = text_match.group(1).strip()

                    # Check if it's a command
                    if message_text.startswith('!') or message_text.startswith('/'):
                        logger.info(f"Command detected: {message_text}")
                        await forward_command(
                            session,
                            pending_message['chat_jid'],
                            pending_message['sender_jid'],
                            pending_message['id'],
                            message_text
                        )

                    pending_message = None

                # Reset after a few lines if no text found
                elif '🚀 EVENT' in line or 'Message event' in line:
                    pending_message = None

    except KeyboardInterrupt:
        logger.info("Shutting down...")
    finally:
        await session.close()


if __name__ == '__main__':
    asyncio.run(main())
