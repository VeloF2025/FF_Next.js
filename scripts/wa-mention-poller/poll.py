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
BRIDGE_SECRET = os.environ.get('WA_BRIDGE_SECRET')
CURSOR_PATH = Path(os.environ.get('CURSOR_PATH', '/var/lib/wa-mention-poller/cursor'))
LOOKBACK_SECONDS = int(os.environ.get('LOOKBACK_SECONDS', '900'))

# Group types whose messages the Go bridge already POSTs directly. Anything
# else (pre_provision, admin, civil, ...) is re-emitted here.
SKIP_GROUP_TYPES = {'maintenance', 'dr_submission'}


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
        rows = conn.execute(
            """
            SELECT id, chat_jid, sender, content, timestamp, is_from_me,
                   media_type, filename
            FROM messages
            WHERE timestamp > ?
            ORDER BY timestamp ASC
            """,
            (since.isoformat(),),
        ).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


def load_skip_jids() -> set[str]:
    """Return JIDs whose group_type is in SKIP_GROUP_TYPES per the bridge log.

    The bridge prints '   - <name> (<jid>) [<type>]' on every reload. We
    parse the most recent such block. Falling back to an empty set means
    we'd re-emit everything (still safe, dedupe handles it).
    """
    log_path = Path('/opt/whatsapp-bridge/bridge.log')
    if not log_path.exists():
        return set()
    skip: set[str] = set()
    # Read the tail (last ~200KB is plenty for one reload block)
    with log_path.open('rb') as f:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(max(0, size - 200_000))
        tail = f.read().decode('utf-8', errors='replace')
    for line in tail.splitlines():
        line = line.strip()
        if not line.startswith('- '):
            continue
        # '- <name> (<jid>) [<type>]'
        if '@g.us)' not in line or '[' not in line:
            continue
        try:
            jid = line.split('(')[1].split(')')[0]
            gtype = line.rsplit('[', 1)[1].rstrip(']').strip()
        except (IndexError, ValueError):
            continue
        if gtype in SKIP_GROUP_TYPES:
            skip.add(jid)
    return skip


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
        headers={'Content-Type': 'application/json'},
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
