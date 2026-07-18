# Jarvis Agent — WhatsApp → headless Claude Code

Jarvis answers WhatsApp messages by handing each one to a full Claude Code agent
running on **velo-server** (Hein's workstation), which has real SSH/DB/skill
access and diagnoses issues for real. Deployed 2026-07-18. Supersedes the
advice-only `scripts/jarvis-responder/` bot (disabled).

## Flow

```
@-tag in Qfields Server 2.0 / Velo Server, OR a DM to the Jarvis number
  → bridge stores it (chat must be in wa_monitored_groups — it drops all others)
  → relay.py (systemd --user on velo-server) polls the bridge sqlite over SSH
  → instant "🔍 checking…" ack, then claude -p (read-only agent) investigates
  → threaded reply via bridge /api/send
  → if a state-changing fix is needed: approval_request → token stored → DM Hein
```

## Files

| File | Role |
|---|---|
| `relay.py` | Poll loop, agent invocation, reply, approval routing + execution |
| `system-prompt.md` | Diagnosis agent persona (read-only) |
| `settings.json` | Diagnosis perms: deny Write/Edit; `guard.py` blocks state-changing Bash |
| `guard.py` | PreToolUse hook — blocks all state-changing shell for the diagnosis agent |
| `system-prompt-exec.md` | Execute-mode agent persona (write-enabled) |
| `settings-exec.json` | Execute perms: allow Write/Edit/Bash; `guard-exec.py` catastrophic-only |
| `guard-exec.py` | PreToolUse hook — blocks only catastrophic commands in execute mode |
| `jarvis-agent.service` | systemd --user unit |

Runtime copies live in `~/.jarvis-agent/`; secrets/config in
`~/.jarvis-agent/jarvis-agent.env` (not in git).

## Approval → execute (Hein-authenticated)

The diagnosis agent is **read-only**. For a fix that changes state it returns an
`approval_request` with an exact command; the relay stores it under a short token
and DMs Hein. When Hein replies from his DM (`HEIN_DM_JID`) with
`JARVIS OK <token>` — or just "ja" when one is pending — the relay spins up a
**second Claude Code agent in execute mode** (write-enabled; `guard-exec.py`
blocks only catastrophic commands) that carries out the approved action, verifies
it, and reports back. Tokens expire after `APPROVAL_TTL` (30 min). Approvals are
only honoured from Hein's authenticated DM JID — never from a group.

## Config (`~/.jarvis-agent/jarvis-agent.env`)

- `ALLOWED_GROUPS` — group JIDs Jarvis answers @-tags in
- `DM_CHATS` — DM chats where any message is a question (no tag needed)
- `HEIN_JID` — where approval requests are SENT (Hein's personal number)
- `HEIN_DM_JID` — the DM chat approvals must COME FROM (authenticated Hein)
- `JARVIS_MENTIONS` — mention tokens (LID `188674373324992` + phone)
- `POLL_INTERVAL`, `MAX_REPLIES_PER_HOUR`, `AGENT_TIMEOUT`, `EXEC_TIMEOUT`, `APPROVAL_TTL`

## Gotchas

- **Bridge only stores monitored chats** (`main.go:handleMessage`: `if !isProjectGroup { return }`). Any group OR DM must be registered in `wa_monitored_groups` first, then `curl -X POST localhost:8083/reload-groups`.
- **@-mention = LID** (`188674373324992`), not the phone number.
- Bridge does not persist its own outbound replies to sqlite — verify sends via relay logs.
- **velo-server IS the workstation**, so velo commands run locally.

## Manage

```bash
systemctl --user status jarvis-agent
journalctl --user -u jarvis-agent -f
# deploy a change: cp scripts/jarvis-agent/<file> ~/.jarvis-agent/ && systemctl --user restart jarvis-agent
```
