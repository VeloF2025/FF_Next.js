# Jarvis WhatsApp Mention Responder

Answers when someone @-tags the Velocity WA number (+27 63 841 2276) in an
allowlisted WhatsApp group. Polls the bridge's sqlite store (read-only), builds
context from recent group messages, asks Claude, and posts a threaded reply via
the bridge's `/api/send` endpoint. Deployed 2026-07-18.

## Deployment (VPS 72.61.197.178)

| Piece | Location |
|---|---|
| Script | `/opt/jarvis-responder/poll.py` |
| Venv | `/opt/jarvis-responder/venv` (`anthropic`, `requests`) |
| Env (secrets) | `/etc/jarvis-responder.env` (chmod 600, NOT in git) |
| Unit | `jarvis-responder.service` (systemd, `Restart=always`) |
| State | `/opt/jarvis-responder/state.json` (cursor + replied ids) |

```bash
systemctl status jarvis-responder
journalctl -u jarvis-responder -f
```

## Env vars (`/etc/jarvis-responder.env`)

- `ANTHROPIC_API_KEY` — required
- `ALLOWED_GROUPS` — comma-separated group JIDs (empty = refuses to start)
- `JARVIS_TAG` (default `@27638412276`), `JARVIS_MODEL` (default `claude-opus-4-8`)
- `POLL_INTERVAL` (20s), `MAX_REPLIES_PER_HOUR` (12), `CONTEXT_MESSAGES` (25)

## Design constraints

- **Read-only on the bridge DB** (`mode=ro` URI); never restarts the bridge
  (pairing-abuse block — see `wa-bridge-ops` skill).
- Tag detection is textual (`content LIKE '%@27638412276%'`) because WhatsApp
  renders mentions as literal `@<number>` in the stored text — no bridge code
  change needed.
- First boot sets the cursor to *now* so it never answers backlog.
- Rate-limited, dedupes by message id, skips own messages (`is_from_me=1`).
- Answer-only persona: explains and advises; never claims to have performed
  server actions; never shares credentials or internal endpoints.

## Deploy changes

```bash
scp scripts/jarvis-responder/poll.py root@72.61.197.178:/opt/jarvis-responder/poll.py
ssh root@72.61.197.178 systemctl restart jarvis-responder
```

## Adding a group

Find the JID (`curl -s localhost:8083/all-groups` on the VPS), append it to
`ALLOWED_GROUPS` in `/etc/jarvis-responder.env`, restart the service.
