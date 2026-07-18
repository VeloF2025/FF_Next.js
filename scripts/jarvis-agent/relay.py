#!/usr/bin/env python3
"""Jarvis relay — hands WhatsApp mentions to a headless Claude Code agent, and
executes fixes that Hein approves from his authenticated DM.

Runs on Hein's workstation (velo-server). Polls the WA bridge's sqlite store
(over SSH) for messages that @-tag the Velocity number in the allowlisted
groups, or any message in Hein's DM. Each is handed to `claude -p` (full Claude
Code, real tools/SSH/DB access) which diagnoses read-only and replies.

State-changing fixes are NEVER run by the agent (a guard hook blocks them).
Instead the agent returns an approval_request with an exact command; the relay
stores it under a short token and DMs Hein. When Hein approves that token from
his DM, the relay itself runs the pre-vetted command (as Hein) and reports back.
"""
import base64
import json
import logging
import os
import re
import secrets
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
GUARD_EXEC_FILE = os.getenv("JARVIS_GUARD_EXEC", "/home/hein/.jarvis-agent/guard-exec.py")
STATE_FILE = os.getenv("STATE_FILE", "/home/hein/.jarvis-agent/state.json")
PENDING_FILE = os.getenv("PENDING_FILE", "/home/hein/.jarvis-agent/pending.json")
JARVIS_MENTIONS = [t.strip() for t in os.getenv(
    "JARVIS_MENTIONS", "188674373324992,27638412276",
).split(",") if t.strip()]
HEIN_JID = os.getenv("HEIN_JID", "")  # where approval requests are SENT (personal number, not in git)
HEIN_DM_JID = os.getenv("HEIN_DM_JID", "")  # the DM chat approvals must COME FROM (authenticated Hein)
ALLOWED_GROUPS = [g.strip() for g in os.getenv(
    "ALLOWED_GROUPS", "120363425013095777@g.us,120363423864087150@g.us",
).split(",") if g.strip()]
DM_CHATS = [c.strip() for c in os.getenv("DM_CHATS", "").split(",") if c.strip()]
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "15"))
MAX_REPLIES_PER_HOUR = int(os.getenv("MAX_REPLIES_PER_HOUR", "10"))
CONTEXT_MESSAGES = int(os.getenv("CONTEXT_MESSAGES", "20"))
AGENT_TIMEOUT = int(os.getenv("AGENT_TIMEOUT", "420"))
EXEC_TIMEOUT = int(os.getenv("EXEC_TIMEOUT", "240"))
APPROVAL_TTL = int(os.getenv("APPROVAL_TTL", "1800"))
MODEL = os.getenv("JARVIS_MODEL", "opus")

# Bare-word approvals are accepted ONLY when the whole message equals one of these
# exactly (avoids "ek weet nie" / "ok cool" misfiring on a pending action). The
# safe path is always an explicit "JARVIS OK <token>".
APPROVE_WORDS = {"ja", "yes", "approve", "approved", "goedgekeur", "ok", "okay",
                 "do it", "doen dit", "gaan voort", "maak so", "reg so"}
DECLINE_WORDS = {"nee", "no", "cancel", "kanselleer", "stop", "moenie", "los dit", "laat staan"}

# Outgoing replies are scanned for secrets before they leave — the diagnosis agent
# can read credential files/env, so this is the enforced control against a
# prompt-injected exfiltration to a (semi-trusted) group.
SECRET_PATTERNS = [
    re.compile(r"\w+://[^\s:@/]+:[^\s:@/]+@\S+"),                       # user:pass@host URLs (incl. postgres://)
    re.compile(r"sk-ant-[A-Za-z0-9_\-]{8,}"),
    re.compile(r"npg_[A-Za-z0-9]{8,}"),
    re.compile(r"eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.?[A-Za-z0-9_\-]*"),  # JWT
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),                               # AWS access key id
    re.compile(r"(?i)\b(password|passwd|pgpassword|secret|api[_-]?key|auth[_-]?token|access[_-]?token|bearer)\b\s*[:=]\s*\S+"),
]


def _env_secret_values() -> list:
    """Exact secret values from the environment (DB URLs, tokens, passwords) so any
    that appear in output are scrubbed regardless of format — the reliable backstop
    behind blocking secret-file reads."""
    vals = set()
    for k, v in os.environ.items():
        if len(v) < 6:
            continue
        if re.search(r"(PASS|PASSWORD|TOKEN|SECRET|_KEY|APIKEY|DATABASE|PGPASSWORD|CREDENTIAL|CONN|DSN)", k, re.I):
            vals.add(v)
        # pull the password out of ANY connection-string value (regardless of the
        # env var's name) so it's scrubbed even when it appears bare in output.
        m = re.search(r"://[^:/@\s]+:([^@/\s]{4,})@", v)
        if m:
            vals.add(m.group(1))
            vals.add(v)
    # also scrub the approval-channel JIDs — leaking which JID the gate trusts is recon.
    for name in ("HEIN_JID", "HEIN_DM_JID"):
        v = os.environ.get(name, "")
        if len(v) >= 6:
            vals.add(v)
    return sorted(vals, key=len, reverse=True)


_ENV_SECRETS = _env_secret_values()


def redact(text: str) -> str:
    if not text:
        return text
    for v in _ENV_SECRETS:
        if v in text:
            text = text.replace(v, "«redacted»")
    for p in SECRET_PATTERNS:
        text = p.sub("«redacted»", text)
    return text


def sanitize_display(s: str, cap: int = 600) -> str:
    """Strip control/bidi chars and cap length so the human approval gate can't be
    fooled by a proposal whose destructive tail is hidden off-screen or reversed."""
    s = re.sub(r"[‪-‮⁦-⁩\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", s or "")
    return s if len(s) <= cap else s[:cap] + " …(afgekap/truncated)"


def _sq(s: str) -> str:
    return str(s).replace("'", "''")

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


def _json_load(path: str) -> dict:
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _json_save(path: str, obj: dict) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f)
    os.replace(tmp, path)


def new_mentions(cursor_ts: str) -> list:
    clauses = []
    if ALLOWED_GROUPS:
        groups = ",".join(f"'{_sq(g)}'" for g in ALLOWED_GROUPS)
        mention = " OR ".join(f"content LIKE '%{_sq(t)}%'" for t in JARVIS_MENTIONS)
        clauses.append(f"(chat_jid IN ({groups}) AND ({mention}))")
    if DM_CHATS:
        dms = ",".join(f"'{_sq(c)}'" for c in DM_CHATS)
        clauses.append(f"chat_jid IN ({dms})")
    if not clauses:
        return []
    # >= (not >) so a message sharing the last-seen second isn't skipped; the
    # replied-id dedup below prevents reprocessing.
    q = (
        "SELECT json_object('id',id,'chat',chat_jid,'sender',sender,"
        "'content',content,'ts',timestamp) "
        f"FROM messages WHERE is_from_me=0 AND timestamp >= '{_sq(cursor_ts)}' "
        f"AND ({' OR '.join(clauses)}) ORDER BY timestamp"
    )
    return sql_json(q)


def chat_context(chat_jid: str) -> tuple:
    rows = list(reversed(sql_json(
        "SELECT json_object('sender',sender,'content',content,'me',is_from_me) "
        f"FROM messages WHERE chat_jid='{_sq(chat_jid)}' AND content!='' "
        f"ORDER BY timestamp DESC LIMIT {CONTEXT_MESSAGES}"
    )))
    name_rows = sql_json(f"SELECT json_object('n',name) FROM chats WHERE jid='{_sq(chat_jid)}'")
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
        "--output-format", "json", "--model", MODEL,
        "--append-system-prompt", system_prompt, "--settings", SETTINGS_FILE,
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
        "recipient": msg["chat"], "message": redact(reply),
        "replyToId": msg["id"], "replyToSender": msg["sender"],
        "quotedContent": (msg.get("content") or "")[:120],
    })


def send_ack(msg: dict) -> None:
    bridge_post("/api/send", {
        "recipient": msg["chat"],
        "message": "🔍 Besig om die stelsel te kyk… / Checking the live system, one moment…",
        "replyToId": msg["id"], "replyToSender": msg["sender"],
        "quotedContent": (msg.get("content") or "")[:120],
    })


def dm(text: str) -> None:
    if HEIN_JID:
        bridge_post("/send-message", {"group_jid": HEIN_JID, "message": text})


def request_approval(origin_chat: str, group_name: str, sender: str, ar: dict) -> None:
    if not HEIN_JID:
        log.error("HEIN_JID unset — cannot request approval; dropping proposed action: %s",
                  ar.get("summary", ""))
        return
    token = secrets.token_hex(3)
    pend = load_pending()
    pend[token] = {
        "command": ar.get("proposed", ""), "host": ar.get("host", "velo"),
        "summary": ar.get("summary", ""), "chat": origin_chat,
        "requester": sender, "ts": time.time(),
    }
    _json_save(PENDING_FILE, pend)
    log.info("stored pending %s host=%s cmd=%s", token, pend[token]["host"], pend[token]["command"][:200])
    dm(
        "🔐 Jarvis wil 'n aksie uitvoer — jou goedkeuring nodig.\n\n"
        f"Van: {sender.split('@')[0]} in \"{sanitize_display(group_name, 80)}\"\n"
        f"Aksie: {sanitize_display(ar.get('summary', ''), 200)}\n"
        f"Opdrag: {sanitize_display(ar.get('proposed', ''))}\n"
        f"Host: {sanitize_display(ar.get('host', ''), 20)}  |  Risiko: {sanitize_display(ar.get('risk', ''), 10)}\n\n"
        f"Antwoord *JARVIS OK {token}* om goed te keur, of 'nee' om te kanselleer."
    )


def load_pending() -> dict:
    pend = _json_load(PENDING_FILE)
    now = time.time()
    fresh = {t: a for t, a in pend.items() if now - a.get("ts", 0) < APPROVAL_TTL}
    if len(fresh) != len(pend):
        _json_save(PENDING_FILE, fresh)
    return fresh


def match_pending(content: str) -> tuple:
    pend = load_pending()
    if not pend:
        return None, None
    text = (content or "").strip().lower()
    words = set(text.split())
    # Explicit token (hex, matched on a non-hex boundary so it can't be a fragment
    # of a longer string) — the safe path; works with any number pending.
    for t in pend:
        if re.search(rf"(?<![0-9a-f]){re.escape(t.lower())}(?![0-9a-f])", text):
            return t, ("decline" if (words & DECLINE_WORDS) else "approve")
    # Bare word: ONLY when the entire message equals one affirmative/negative and
    # exactly one action is pending (so "ek weet nie" / "ok cool" never fire).
    if len(pend) == 1:
        t = next(iter(pend))
        if text in DECLINE_WORDS:
            return t, "decline"
        if text in APPROVE_WORDS:
            return t, "approve"
    return None, None


def command_blocked(cmd: str) -> str:
    """Deterministic safety check on the EXACT approved command, reusing the
    guard-exec ruleset (catastrophic / sensitive-path / obfuscation). Returns a
    reason string if the command must not be auto-executed, else "". Fails closed."""
    try:
        r = subprocess.run(
            ["python3", GUARD_EXEC_FILE],
            input=json.dumps({"tool_name": "Bash", "tool_input": {"command": cmd}}),
            capture_output=True, text=True, timeout=10,
        )
    except Exception as e:  # noqa: BLE001 - fail closed on any check failure
        return f"safety check could not run ({e})"
    if '"deny"' in r.stdout:
        try:
            return json.loads(r.stdout)["hookSpecificOutput"]["permissionDecisionReason"]
        except Exception:
            return "blocked by the safety guard"
    return ""


def run_command(cmd: str, host: str) -> str:
    """Run the exact approved command deterministically (no LLM). velo/local runs
    here (this box is velo); host=vps runs over SSH."""
    try:
        if host == "vps":
            return ssh(cmd, timeout=EXEC_TIMEOUT)
        r = subprocess.run(["bash", "-lc", cmd], capture_output=True, text=True, timeout=EXEC_TIMEOUT)
        return (r.stdout or "") + (("\n" + r.stderr) if r.stderr else "")
    except subprocess.TimeoutExpired:
        return f"(timed out after {EXEC_TIMEOUT}s — check manually)"
    except Exception as e:  # noqa: BLE001 - surface any run failure to Hein
        return f"(execution error: {e})"


def verify_via_agent(action: dict, output: str) -> str:
    """Read-only agent re-checks that the fix actually worked. Uses the read-only
    settings/guard — it cannot change anything."""
    with open(SYSTEM_PROMPT_FILE) as f:
        system_prompt = f.read()
    prompt = (
        "An approved fix was just executed by the operator relay (NOT by you).\n"
        f"Fix: {action.get('summary', '')}\n"
        f"Command output:\n{output[:2000]}\n\n"
        "Verify READ-ONLY whether it actually worked — re-check the relevant live status "
        "(job finished, package fresh, service active, row updated). Change nothing. "
        "Output ONLY a 1-2 sentence plain-text verification in Afrikaans."
    )
    cmd = [
        "claude", "-p", prompt, "--output-format", "json", "--model", MODEL,
        "--append-system-prompt", system_prompt, "--settings", SETTINGS_FILE,
    ]
    try:
        r = subprocess.run(cmd, cwd=REPO_DIR, capture_output=True, text=True, timeout=AGENT_TIMEOUT)
        return json.loads(r.stdout)["result"].strip()
    except Exception:  # noqa: BLE001 - verification is best-effort
        return "(kon nie outomaties verifieer nie — kyk asseblief self)"


def handle_approval(token: str, verb: str) -> bool:
    pend = load_pending()
    action = pend.get(token)
    if not action:
        return False
    del pend[token]
    _json_save(PENDING_FILE, pend)
    origin = action.get("chat")
    if verb == "decline":
        dm(f"❌ OK, ek los dit — {action['summary']}")
        if origin and origin != HEIN_DM_JID:
            bridge_post("/send-message", {"group_jid": origin, "message": "Hein het die regstelling gekanselleer."})
        return True
    cmd, host = action["command"], action.get("host", "velo")
    reason = command_blocked(cmd)
    if reason:
        log.warning("refused to auto-execute %s: %s", token, reason)
        dm(f"⛔ Ek voer dit NIE outomaties uit nie: {reason}\nDoen dit self as jy seker is.")
        if origin and origin != HEIN_DM_JID:
            bridge_post("/send-message", {"group_jid": origin,
                        "message": "Kon nie die regstelling outomaties uitvoer nie — Hein moet dit self doen."})
        return True
    log.info("EXECUTING approved %s on %s: %s", token, host, cmd[:200])
    dm(f"⚙️ Goedgekeur — ek voer nou uit: {sanitize_display(action['summary'], 200)}")
    out = redact(run_command(cmd, host))
    log.info("exec output: %s", out[:300])
    verify = redact(verify_via_agent(action, out))
    dm(f"✅ Uitgevoer: {sanitize_display(action['summary'], 200)}\n\nUitset:\n{out[:500]}\n\nVerifikasie: {verify[:300]}")
    if origin and origin != HEIN_DM_JID:
        bridge_post("/send-message", {
            "group_jid": origin,
            "message": f"✅ Hein het goedgekeur en dit is gedoen: {sanitize_display(action['summary'], 200)}",
        })
    return True


def rate_limited() -> bool:
    now = time.time()
    while reply_times and now - reply_times[0] > 3600:
        reply_times.popleft()
    return len(reply_times) >= MAX_REPLIES_PER_HOUR


def load_state() -> dict:
    return _json_load(STATE_FILE)


def save_state(state: dict) -> None:
    _json_save(STATE_FILE, state)


def process_once(state: dict) -> None:
    replied = state.setdefault("replied_ids", [])
    for msg in new_mentions(state["cursor"]):
        state["cursor"] = max(state["cursor"], msg["ts"])
        if msg["id"] in replied:
            continue
        # Approval path — only from Hein's authenticated DM chat.
        if HEIN_DM_JID and msg["chat"] == HEIN_DM_JID:
            token, verb = match_pending(msg["content"])
            if token:
                log.info("approval from Hein DM: token=%s verb=%s", token, verb)
                if handle_approval(token, verb):
                    replied.append(msg["id"])
                    del replied[:-200]
                    save_state(state)
                    continue
        if rate_limited():
            log.warning("rate limit hit (%d/h); skipping %s", MAX_REPLIES_PER_HOUR, msg["id"])
            continue
        log.info("mention in %s from %s: %s", msg["chat"], msg["sender"], msg["content"][:120])
        send_ack(msg)
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
            if ar and ar.get("proposed"):
                request_approval(msg["chat"], group_name, msg["sender"], ar)
        save_state(state)


def main() -> None:
    if not ALLOWED_GROUPS and not DM_CHATS:
        log.error("no ALLOWED_GROUPS or DM_CHATS; refusing to start")
        sys.exit(1)
    # The approval channel must be Hein's 1:1 DM, never a group (a group JID ends
    # in @g.us) — otherwise a group member could approve execution.
    if HEIN_DM_JID and (HEIN_DM_JID in ALLOWED_GROUPS or HEIN_DM_JID.endswith("@g.us")):
        log.error("HEIN_DM_JID must be Hein's 1:1 DM, not a group — refusing to start")
        sys.exit(1)
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    state = load_state()
    if "cursor" not in state:
        state["cursor"] = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S+00:00")
        save_state(state)
    log.info("jarvis-relay up: groups=%d dms=%d model=%s cursor=%s",
             len(ALLOWED_GROUPS), len(DM_CHATS), MODEL, state["cursor"])
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
