#!/usr/bin/env python3
"""Jarvis WhatsApp mention responder.

Polls the WhatsApp bridge sqlite store for group messages that @-tag the
Velocity WA number, asks Claude for an answer with recent chat context, and
posts a threaded reply via the bridge's /api/send endpoint.

Read-only against the bridge DB; never restarts or touches the bridge itself.
"""
import json
import logging
import os
import sqlite3
import sys
import time
from collections import deque
from datetime import datetime, timezone

import anthropic
import requests

BRIDGE_DB = os.getenv("BRIDGE_DB", "/opt/whatsapp-bridge/store/messages.db")
BRIDGE_URL = os.getenv("BRIDGE_URL", "http://localhost:8083")
STATE_FILE = os.getenv("STATE_FILE", "/opt/jarvis-responder/state.json")
TAG = os.getenv("JARVIS_TAG", "@27638412276")
ALLOWED_GROUPS = [g.strip() for g in os.getenv("ALLOWED_GROUPS", "").split(",") if g.strip()]
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "20"))
MAX_REPLIES_PER_HOUR = int(os.getenv("MAX_REPLIES_PER_HOUR", "12"))
CONTEXT_MESSAGES = int(os.getenv("CONTEXT_MESSAGES", "25"))
MODEL = os.getenv("JARVIS_MODEL", "claude-opus-4-8")

SYSTEM_PROMPT = """You are Jarvis, Velocity Fibre's AI field assistant, replying inside a \
WhatsApp group when someone tags the Velocity number.

Context: Velocity Fibre builds fibre networks in South Africa. Field teams use QField \
(mobile GIS) syncing to a self-hosted QFieldCloud at qfield.fibreflow.app, and FibreFlow \
(app.fibreflow.app) for project management, QA and reporting.

Rules:
- Reply in the language the person used (Afrikaans or English).
- Be brief: 1-5 short sentences. This is WhatsApp, not email.
- You can explain, troubleshoot and advise, but you CANNOT directly restart servers, \
change permissions or fix data from here. For actions like that, say the request has \
been noted for the team - never claim an action was performed.
- Never share credentials, internal IPs, connection strings or server details.
- If you genuinely don't know, say so and suggest they contact Hein or the support team.
- Do not sign your messages; the sender name already identifies you."""

log = logging.getLogger("jarvis-responder")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

client = anthropic.Anthropic()  # ANTHROPIC_API_KEY from env
reply_times: deque = deque()


def load_state() -> dict:
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_state(state: dict) -> None:
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f)
    os.replace(tmp, STATE_FILE)


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{BRIDGE_DB}?mode=ro", uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def new_mentions(conn: sqlite3.Connection, cursor_ts: str) -> list:
    ph = ",".join("?" * len(ALLOWED_GROUPS))
    rows = conn.execute(
        f"""SELECT id, chat_jid, sender, content, timestamp
            FROM messages
            WHERE timestamp > ? AND is_from_me = 0
              AND chat_jid IN ({ph})
              AND content LIKE ?
            ORDER BY timestamp""",
        [cursor_ts, *ALLOWED_GROUPS, f"%{TAG}%"],
    ).fetchall()
    return rows


def chat_context(conn: sqlite3.Connection, chat_jid: str) -> str:
    rows = conn.execute(
        """SELECT sender, content, is_from_me, timestamp FROM messages
           WHERE chat_jid = ? AND content != ''
           ORDER BY timestamp DESC LIMIT ?""",
        [chat_jid, CONTEXT_MESSAGES],
    ).fetchall()
    name = conn.execute("SELECT name FROM chats WHERE jid = ?", [chat_jid]).fetchone()
    lines = [f"WhatsApp group: {name['name'] if name else chat_jid}"]
    for r in reversed(rows):
        who = "Jarvis" if r["is_from_me"] else (r["sender"].split("@")[0] or "unknown")
        lines.append(f"[{r['timestamp'][:16]}] {who}: {r['content'][:500]}")
    return "\n".join(lines)


def ask_claude(context: str, question: str) -> str | None:
    response = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        thinking={"type": "adaptive"},
        system=SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": (
                f"Recent group messages for context:\n\n{context}\n\n"
                f"The last message above tags you. Reply to it now:\n{question}"
            ),
        }],
    )
    if response.stop_reason == "refusal":
        log.warning("Claude refused to answer; skipping reply")
        return None
    return next((b.text for b in response.content if b.type == "text"), None)


def send_reply(msg: sqlite3.Row, text: str) -> bool:
    payload = {
        "recipient": msg["chat_jid"],
        "message": text,
        "replyToId": msg["id"],
        "replyToSender": msg["sender"],
        "quotedContent": (msg["content"] or "")[:120],
    }
    r = requests.post(f"{BRIDGE_URL}/api/send", json=payload, timeout=30)
    ok = r.ok and r.json().get("success", False)
    log.info("send_reply chat=%s ok=%s resp=%s", msg["chat_jid"], ok, r.text[:150])
    return ok


def rate_limited() -> bool:
    now = time.time()
    while reply_times and now - reply_times[0] > 3600:
        reply_times.popleft()
    return len(reply_times) >= MAX_REPLIES_PER_HOUR


def process_once(state: dict) -> None:
    conn = db()
    try:
        cursor_ts = state["cursor"]
        replied = state.setdefault("replied_ids", [])
        for msg in new_mentions(conn, cursor_ts):
            state["cursor"] = max(state["cursor"], msg["timestamp"])
            if msg["id"] in replied:
                continue
            if rate_limited():
                log.warning("rate limit hit (%d/h); skipping %s", MAX_REPLIES_PER_HOUR, msg["id"])
                continue
            log.info("mention in %s from %s: %s", msg["chat_jid"], msg["sender"], msg["content"][:100])
            try:
                answer = ask_claude(chat_context(conn, msg["chat_jid"]), msg["content"])
            except anthropic.APIError as e:
                log.error("Claude API error: %s", e)
                continue
            if answer and send_reply(msg, answer):
                reply_times.append(time.time())
                replied.append(msg["id"])
                del replied[:-200]
        save_state(state)
    finally:
        conn.close()


def main() -> None:
    if not ALLOWED_GROUPS:
        log.error("ALLOWED_GROUPS is empty; refusing to start")
        sys.exit(1)
    state = load_state()
    if "cursor" not in state:
        # Start from now — never answer backlog on first boot
        state["cursor"] = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S+00:00")
        save_state(state)
    log.info("jarvis-responder up: %d group(s), tag=%s, model=%s, cursor=%s",
             len(ALLOWED_GROUPS), TAG, MODEL, state["cursor"])
    while True:
        try:
            process_once(state)
        except sqlite3.OperationalError as e:
            log.warning("sqlite busy/unavailable: %s", e)
        except Exception:
            log.exception("unexpected error in poll loop")
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
