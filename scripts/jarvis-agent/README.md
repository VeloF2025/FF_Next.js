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
| `system-prompt.md` | Diagnosis / verify agent persona (read-only) |
| `settings.json` | Read-only perms: deny Write/Edit/Task + secret-file Reads; `guard.py` (Bash) + `guard-read.py` (Read/Grep/Glob) hooks |
| `guard.py` | PreToolUse Bash hook — blocks state-changing shell, secret reads, code-exec wrappers |
| `guard-read.py` | PreToolUse Read/Grep/Glob hook — blocks reading credential/secret files |
| `guard-exec.py` | Deterministic ruleset the relay runs against the EXACT approved command before executing it (catastrophic / sensitive-write / obfuscation / secret-read) |
| `jarvis-agent.service` | systemd --user unit |

Runtime copies live in `~/.jarvis-agent/`; secrets/config in
`~/.jarvis-agent/jarvis-agent.env` (not in git).

## Approval → execute (Hein-authenticated)

The diagnosis agent is **read-only** (no write tools; guards block state changes
and secret reads). For a fix that changes state it returns an `approval_request`
with an exact command; the relay stores it under a short token and DMs Hein. When
Hein replies from his DM (`HEIN_DM_JID`) with `JARVIS OK <token>` — or an exact
"ja"/"nee" when one is pending — the relay:

1. runs the exact approved command through `guard-exec.py` (deterministic check);
   if it's catastrophic / touches a sensitive path / uses obfuscation, it refuses
   and tells Hein to do it by hand;
2. otherwise **the relay itself executes the command verbatim** (no LLM latitude
   — it runs exactly what Hein saw and approved), locally on velo or over SSH for
   `host: vps`;
3. spins up a **read-only** agent to verify the fix actually worked and reports
   output + verification back (secret-scanned).

There is deliberately **no write-capable agent** — a regex guard cannot safely
constrain an LLM with a shell, so execution is deterministic and bound to the
approved command. Tokens expire after `APPROVAL_TTL` (30 min). Approvals are only
honoured from Hein's authenticated 1:1 DM — never a group (startup refuses if
`HEIN_DM_JID` is a group JID).

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
