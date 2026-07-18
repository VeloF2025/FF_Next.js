#!/usr/bin/env python3
"""Jarvis relay — hands WhatsApp mentions to a headless Claude Code agent.

Runs on Hein's workstation. Polls the WA bridge's sqlite store (over SSH) for
messages that @-tag the Velocity number in the allowlisted internal groups.
For each one it launches `claude -p` (full Claude Code, with the workstation's
real tools/SSH/DB access) to actually diagnose the issue, then posts the reply
back through the bridge as a threaded message. State-changing fixes are never
run by the agent — they come back as an approval_request that DMs Hein.
"""
import base64
import json
import logging
import os
import subprocess
import sys
import time
from collections import deque
from datetime import datetime, timezone

VPS = os.getenv("VPS_SSH", "root@72.61.197.178")
BRIDGE_DB = os.getenv("BRIDGE_DB", "/opt/whatsapp-bridge/store/messages.db")
BRIDGE_LOCAL = os.getenv("BRIDGE_LOCAL", "http://localhost:8083")
REPO_DIR = os.getenv("JARVIS_REPO", "/home/hein/Workspace/FF_Next.js")
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SYSTEM_PROMPT_FILE = os.getenv("JARVIS_SYSTEM", os.path.join(BASE_DIR, "system-prompt.md"))
SETTINGS_FILE = os.getenv("JARVIS_SETTINGS", "/home/hein/.jarvis-agent/settings.json")
STATE_FILE = os.getenv("STATE_FILE", "/home/hein/.jarvis-agent/state.json")
# WhatsApp renders an @-mention of the bridge account as its LID
# (188674373324992), not the phone number — match either.
JARVIS_MENTIONS = [t.strip() for t in os.getenv(
    "JARVIS_MENTIONS", "188674373324992,27638412276",
).split(",") if t.strip()]
HEIN_JID = os.getenv("HEIN_JID", "")  # set in jarvis-agent.env (personal number, not in git)
ALLOWED_GROUPS = [g.strip() for g in os.getenv(
    "ALLOWED_GROUPS",
    "120363425013095777@g.us,120363423864087150@g.us",
).split(",") if g.strip()]
# Direct-message chats where ANY inbound message is a question for Jarvis
# (no @-tag needed — a DM is inherently directed at Jarvis).
DM_CHATS = [c.strip() for c in os.getenv("DM_CHATS", "").split(",") if c.strip()]
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "15"))
MAX_REPLIES_PER_HOUR = int(os.getenv("MAX_REPLIES_PER_HOUR", "10"))
CONTEXT_MESSAGES = int(os.getenv("CONTEXT_MESSAGES", "20"))
AGENT_TIMEOUT = int(os.getenv("AGENT_TIMEOUT", "420"))
MODEL = os.getenv("JARVIS_MODEL", "opus")

log = logging.getLogger("jarvis-relay")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
reply_times: deque = deque()


def ssh(remote_cmd: str, timeout: int = 30) -> str:
    r = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", VPS, remote_cmd],
        capture_output=True, text=True, timeout=timeout,
    )
    if r.returncode != 0:
        log.warning("ssh rc=%s err=%s", r.returncode, r.stderr.strip()[:200])
    return r.stdout


def sql_json(query: str) -> list:
    """Run a query on the bridge sqlite and return rows as dicts (via json_object)."""
    out = ssh(f'sqlite3 "{BRIDGE_DB}" {json.dumps(query)}')
    rows = []
    for line in out.splitlines():
        line = line.strip()
        if line:
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return rows


def new_mentions(cursor_ts: str) -> list:
    clauses = []
    if ALLOWED_GROUPS:
        groups = ",".join(f"'{g}'" for g in ALLOWED_GROUPS)
        mention = " OR ".join(f"content LIKE '%{t}%'" for t in JARVIS_MENTIONS)
        clauses.append(f"(chat_jid IN ({groups}) AND ({mention}))")
    if DM_CHATS:
        dms = ",".join(f"'{c}'" for c in DM_CHATS)
        clauses.append(f"chat_jid IN ({dms})")
    if not clauses:
        return []
    q = (
        "SELECT json_object('id',id,'chat',chat_jid,'sender',sender,"
        "'content',content,'ts',timestamp) "
        f"FROM messages WHERE is_from_me=0 AND timestamp > '{cursor_ts}' "
        f"AND ({' OR '.join(clauses)}) ORDER BY timestamp"
    )
    return sql_json(q)


def chat_context(chat_jid: str) -> tuple:
    q = (
        "SELECT json_object('sender',sender,'content',content,'me',is_from_me) "
        f"FROM messages WHERE chat_jid='{chat_jid}' AND content!='' "
        f"ORDER BY timestamp DESC LIMIT {CONTEXT_MESSAGES}"
    )
    rows = list(reversed(sql_json(q)))
    name_rows = sql_json(
        "SELECT json_object('n',name) FROM chats WHERE jid="
        f"'{chat_jid}'"
    )
    group_name = name_rows[0]["n"] if name_rows else chat_jid
    lines = []
    for r in rows:
        who = "Jarvis" if r.get("me") else (str(r.get("sender", "")).split("@")[0] or "?")
        lines.append(f"{who}: {r.get('content', '')[:400]}")
    return group_name, "\n".join(lines)


def run_agent(group_name: str, sender: str, message: str, context: str) -> dict:
    with open(SYSTEM_PROMPT_FILE) as f:
        system_prompt = f.read()
    user_prompt = (
        f'A message was sent to you (Jarvis) on WhatsApp in "{group_name}".\n\n'
        f"Recent conversation (oldest first):\n{context}\n\n"
        f"The message you must answer, from {sender.split('@')[0]}:\n{message}\n\n"
        "Investigate with your tools and produce the reply. "
        "Output ONLY the JSON envelope defined in your instructions."
    )
    cmd = [
        "claude", "-p", user_prompt,
        "--output-format", "json",
        "--model", MODEL,
        "--append-system-prompt", system_prompt,
        "--settings", SETTINGS_FILE,
    ]
    r = subprocess.run(cmd, cwd=REPO_DIR, capture_output=True, text=True, timeout=AGENT_TIMEOUT)
    if r.returncode != 0:
        log.error("claude rc=%s err=%s", r.returncode, r.stderr.strip()[:300])
        return {"reply": None, "approval_request": None}
    try:
        result_text = json.loads(r.stdout)["result"]
    except (json.JSONDecodeError, KeyError):
        log.error("could not parse claude output envelope: %s", r.stdout[:300])
        return {"reply": None, "approval_request": None}
    return parse_envelope(result_text)


def parse_envelope(text: str) -> dict:
    t = text.strip()
    if t.startswith("```"):
        t = t.strip("`")
        t = t[t.find("{"):]
    i, j = t.find("{"), t.rfind("}")
    if i != -1 and j != -1:
        try:
            obj = json.loads(t[i:j + 1])
            return {"reply": obj.get("reply"), "approval_request": obj.get("approval_request")}
        except json.JSONDecodeError:
            pass
    log.warning("agent did not return JSON envelope; using raw text as reply")
    return {"reply": text.strip(), "approval_request": None}


def bridge_post(path: str, payload: dict) -> bool:
    b64 = base64.b64encode(json.dumps(payload).encode()).decode()
    out = ssh(
        f"echo {b64} | base64 -d | curl -s -X POST {BRIDGE_LOCAL}{path} "
        "-H 'Content-Type: application/json' -d @-",
        timeout=40,
    )
    ok = '"success":true' in out
    log.info("bridge POST %s ok=%s resp=%s", path, ok, out.strip()[:150])
    return ok


def send_group_reply(msg: dict, reply: str) -> bool:
    return bridge_post("/api/send", {
        "recipient": msg["chat"],
        "message": reply,
        "replyToId": msg["id"],
        "replyToSender": msg["sender"],
        "quotedContent": (msg.get("content") or "")[:120],
    })


def dm_hein(group_name: str, sender: str, ar: dict) -> None:
    if not HEIN_JID:
        log.warning("HEIN_JID unset; cannot send approval DM for: %s", ar.get("summary", ""))
        return
    text = (
        "🔐 Jarvis needs approval before acting.\n\n"
        f"From: {sender.split('@')[0]} in \"{group_name}\"\n"
        f"Action: {ar.get('summary', '')}\n"
        f"Proposed: {ar.get('proposed', '')}\n"
        f"Host: {ar.get('host', '')}  |  Risk: {ar.get('risk', '')}\n\n"
        "Reply here to approve/decline. Jarvis has NOT run it."
    )
    bridge_post("/send-message", {"group_jid": HEIN_JID, "message": text})


def rate_limited() -> bool:
    now = time.time()
    while reply_times and now - reply_times[0] > 3600:
        reply_times.popleft()
    return len(reply_times) >= MAX_REPLIES_PER_HOUR


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


def process_once(state: dict) -> None:
    replied = state.setdefault("replied_ids", [])
    for msg in new_mentions(state["cursor"]):
        state["cursor"] = max(state["cursor"], msg["ts"])
        if msg["id"] in replied:
            continue
        if rate_limited():
            log.warning("rate limit hit (%d/h); skipping %s", MAX_REPLIES_PER_HOUR, msg["id"])
            continue
        log.info("mention in %s from %s: %s", msg["chat"], msg["sender"], msg["content"][:120])
        group_name, context = chat_context(msg["chat"])
        try:
            result = run_agent(group_name, msg["sender"], msg["content"], context)
        except subprocess.TimeoutExpired:
            log.error("agent timed out on %s", msg["id"])
            result = {"reply": "Ek kry nie betyds klaar met die kontrole nie — Hein sal moet kyk.",
                      "approval_request": None}
        reply = result.get("reply")
        ar = result.get("approval_request")
        log.info("agent reply: %s", (reply or "<none>")[:300])
        if ar:
            log.info("agent approval_request: %s | %s", ar.get("summary", ""), ar.get("proposed", "")[:200])
        if reply and send_group_reply(msg, reply):
            reply_times.append(time.time())
            replied.append(msg["id"])
            del replied[:-200]
            if ar:
                dm_hein(group_name, msg["sender"], ar)
        save_state(state)


def main() -> None:
    if not ALLOWED_GROUPS:
        log.error("ALLOWED_GROUPS empty; refusing to start")
        sys.exit(1)
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    state = load_state()
    if "cursor" not in state:
        state["cursor"] = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S+00:00")
        save_state(state)
    log.info("jarvis-relay up: groups=%d model=%s cursor=%s", len(ALLOWED_GROUPS), MODEL, state["cursor"])
    while True:
        try:
            process_once(state)
        except subprocess.TimeoutExpired as e:
            log.warning("ssh timeout: %s", e)
        except Exception:
            log.exception("error in poll loop")
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
