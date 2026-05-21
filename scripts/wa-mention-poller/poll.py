#!/usr/bin/env python3
"""WA mention poller.

Runs on the VPS host that owns the WhatsApp bridge (`72.61.197.178`).
Polls the bridge's local SQLite store and re-emits new messages from
non-maintenance monitored groups to FibreFlow's `/api/noc/wa-message`
webhook so they flow through the maintenance pipeline (DR/ONT linking,
ticket comments, dr_activity_log).

The maintenance / dr_submission groups are already POSTed directly by
the Go bridge, so we exclude them here to avoid double work. Downstream
ON CONFLICT clauses would dedupe regardless, but skipping is cheaper.

Cursor: a single-line text file holding the last processed bridge
timestamp in ISO8601 UTC. Created on first successful run.

Env vars:
  BRIDGE_DB_PATH    -- path to messages.db (default: /opt/whatsapp-bridge/store/messages.db)
  WEBHOOK_URL       -- FibreFlow endpoint (default: https://dev.fibreflow.app/api/noc/wa-message)
  WA_BRIDGE_SECRET  -- shared secret matching FibreFlow's WA_BRIDGE_SECRET
  CURSOR_PATH       -- where to persist the last processed timestamp
                       (default: /var/lib/wa-mention-poller/cursor)
  LOOKBACK_SECONDS  -- safety floor on first run (default: 900)
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
)
log = logging.getLogger('wa-mention-poller')

BRIDGE_DB_PATH = os.environ.get(
    'BRIDGE_DB_PATH', '/opt/whatsapp-bridge/store/messages.db'
)
WEBHOOK_URL = os.environ.get(
    'WEBHOOK_URL', 'https://dev.fibreflow.app/api/noc/wa-message'
)
# Source of truth for "which JIDs does the Go bridge already POST?". The
# poller hits this endpoint each run; previously we parsed bridge.log
# text, which was brittle to log format changes.
SKIP_JIDS_URL = os.environ.get(
    'SKIP_JIDS_URL',
    'https://dev.fibreflow.app/api/noc/wa-monitored-groups?types=maintenance,dr_submission',
)
BRIDGE_SECRET = os.environ.get('WA_BRIDGE_SECRET')
CURSOR_PATH = Path(os.environ.get('CURSOR_PATH', '/var/lib/wa-mention-poller/cursor'))
LOOKBACK_SECONDS = int(os.environ.get('LOOKBACK_SECONDS', '900'))

# Cloudflare 403s the default Python-urllib UA; identify ourselves explicitly.
USER_AGENT = 'wa-mention-poller/1.0'


def load_cursor() -> datetime:
    if not CURSOR_PATH.exists():
        return datetime.now(timezone.utc) - timedelta(seconds=LOOKBACK_SECONDS)
    raw = CURSOR_PATH.read_text().strip()
    return datetime.fromisoformat(raw)


def save_cursor(ts: datetime) -> None:
    CURSOR_PATH.parent.mkdir(parents=True, exist_ok=True)
    CURSOR_PATH.write_text(ts.isoformat())


def fetch_new_messages(since: datetime) -> list[dict]:
    conn = sqlite3.connect(f'file:{BRIDGE_DB_PATH}?mode=ro', uri=True)
    conn.row_factory = sqlite3.Row
    try:
        # Bridge stores timestamps with a space separator ('2026-05-21 15:01:25+00:00'),
        # not 'T'. Lexical comparison breaks if cursor uses 'T' because 'T' > ' '
        # (ASCII 84 vs 32), making every row "older" than the cursor.
        rows = conn.execute(
            """
            SELECT id, chat_jid, sender, content, timestamp, is_from_me,
                   media_type, filename
            FROM messages
            WHERE timestamp > ?
            ORDER BY timestamp ASC
            """,
            (since.isoformat().replace('T', ' '),),
        ).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


def load_skip_jids() -> set[str]:
    """Return JIDs whose group_type is one the Go bridge POSTs directly.

    Fetches the authoritative list from FibreFlow's wa-monitored-groups
    endpoint (Postgres-backed). On failure we return an empty set so the
    poller keeps working; downstream ON-CONFLICT dedupe will absorb the
    extra emits, at a small CPU cost on the FibreFlow side.
    """
    req = urllib.request.Request(
        SKIP_JIDS_URL,
        headers={'x-wa-bridge-secret': BRIDGE_SECRET or '', 'User-Agent': USER_AGENT},
        method='GET',
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            payload = json.loads(resp.read().decode('utf-8'))
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError) as e:
        log.warning('Skip-JID lookup failed (%s); continuing with empty skip set', e)
        return set()

    if not payload.get('success'):
        log.warning('Skip-JID endpoint returned non-success: %s', payload)
        return set()
    return set(payload.get('data', {}).get('group_jids', []))


def post_message(msg: dict) -> bool:
    payload = {
        'secret': BRIDGE_SECRET,
        'message_id': msg['id'],
        'group_jid': msg['chat_jid'],
        'sender_jid': msg['sender'],
        'sender_name': None,
        'text': msg['content'],
        'timestamp': msg['timestamp'],
        'has_media': bool(msg.get('media_type')),
        'media': [],
    }
    req = urllib.request.Request(
        WEBHOOK_URL,
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'User-Agent': USER_AGENT},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            if resp.status >= 400:
                log.error('Webhook %s -> HTTP %s', msg['id'], resp.status)
                return False
            return True
    except urllib.error.HTTPError as e:
        # 400 means the group is unmonitored or payload invalid -- record
        # as processed so we don't loop forever on it.
        if e.code == 400:
            log.warning('Webhook rejected %s (HTTP 400): %s', msg['id'], e.reason)
            return True
        log.error('Webhook HTTPError %s: %s', e.code, e.reason)
        return False
    except urllib.error.URLError as e:
        log.error('Webhook URLError: %s', e.reason)
        return False


def parse_ts(value: str) -> datetime:
    # Bridge writes timestamps like '2026-05-21 13:01:44.123456+00:00'
    return datetime.fromisoformat(value.replace(' ', 'T'))


def main() -> int:
    if not BRIDGE_SECRET:
        log.error('WA_BRIDGE_SECRET env var is required')
        return 1

    cursor = load_cursor()
    log.info('Poll start, cursor=%s', cursor.isoformat())

    skip_jids = load_skip_jids()
    log.info('Skipping %d JIDs (bridge handles directly)', len(skip_jids))

    new_messages = fetch_new_messages(cursor)
    log.info('Fetched %d new messages', len(new_messages))

    last_processed = cursor
    posted = 0
    for msg in new_messages:
        if msg['chat_jid'] in skip_jids:
            last_processed = parse_ts(msg['timestamp'])
            continue
        if msg['is_from_me']:
            # Outbound messages are not interesting for DR-mention linking.
            last_processed = parse_ts(msg['timestamp'])
            continue
        ok = post_message(msg)
        if ok:
            last_processed = parse_ts(msg['timestamp'])
            posted += 1
        else:
            # Stop advancing cursor on first hard failure so we retry next run.
            break

    save_cursor(last_processed)
    log.info('Posted %d, new cursor=%s', posted, last_processed.isoformat())
    return 0


if __name__ == '__main__':
    sys.exit(main())
