# FibreFlow Remote MCP connector

Lets a FibreFlow user add FibreFlow to claude.ai as a **custom connector** and read it
**as themselves** — same RBAC, read-only, nothing more.

Connector URL: `https://app.fibreflow.app/api/ff-remote-mcp/mcp`
(dev: `https://dev.fibreflow.app/api/ff-remote-mcp/mcp`)

## Shape

```
claude.ai ──► app.fibreflow.app/api/ff-remote-mcp/*   (edge proxy, unauthenticated)
                        │
                        ▼
              127.0.0.1:7416  ff_mcp        (OAuth 2.1 AS + 3 tools, localhost only)
                        │  authorize() redirects to ↓
                        ▼
              app.fibreflow.app/mcp/authorize?state_id=…   (consent page, user's session)
                        │  Allow ⇒ POST /api/mcp/consent
                        ▼
     /api/mcp/consent: mintFfMcpToken() mints the token locally
                (no network), then POSTs it to
                127.0.0.1:7416/authorize/complete
                        │  (X-FF-MCP-Secret)
                        ▼
              redirectUrl back to claude.ai — connected
```

The service is **not** a privileged actor: it holds a per-user token and the callback
secret, and nothing else. No `JWT_SECRET`, no DB connection, no service credential.

## Files

| Path | Role |
|---|---|
| `apps/ff_mcp/config.py` | Settings + the startup secret guard |
| `apps/ff_mcp/oauth.py` | OAuth 2.1 provider (copied from Cortex's `cortex_mcp`) |
| `apps/ff_mcp/server.py` | HTTP surface: `/authorize/complete`, metadata, `/help` |
| `apps/ff_mcp/catalogue.py` | `list_endpoints`, `describe_endpoint` |
| `apps/ff_mcp/tools.py` | `fibreflow_get` + the path/denylist guards |
| `apps/ff_mcp/endpoints.json` | Generated catalogue (`npm run mcp:catalogue`) |
| `pages/api/ff-remote-mcp/[...path].ts` | Edge proxy — the only public path |
| `pages/api/mcp/consent.ts` | Mints the token, calls the service back |
| `pages/mcp/authorize.tsx` | The consent screen |
| `deployment/systemd/ff-remote-mcp.service` | The unit |

## Ports and env

| Var | Meaning |
|---|---|
| `FF_REMOTE_MCP_PORT` | 7416 (localhost only) |
| `FF_APP_BASE` | `https://dev.fibreflow.app` or `https://app.fibreflow.app` |
| `FF_REMOTE_MCP_PUBLIC_BASE` | `<FF_APP_BASE>/api/ff-remote-mcp` |
| `FF_REMOTE_MCP_STORE` | `~/.local/state/ff-remote-mcp/oauth.json` — systemd's `StateDirectory` creates it 0700 |
| `FF_MCP_CALLBACK_SECRET` | Shared with `/api/mcp/consent`. **Never in a tracked file** |
| `FF_REMOTE_MCP_URL` | Read by the *edge proxy*: upstream, default `http://127.0.0.1:7416` |

Secrets live in `~/.ff-remote-mcp.env` (chmod 600, untracked) and
`.claude/credentials.local.md`.

**One instance per host.** dev and production run under the same OS user, so the port
(7416) and the OAuth store are shared state. Running a second environment means
overriding `FF_REMOTE_MCP_PORT`, `StateDirectory`, and `EnvironmentFile` in a drop-in —
and repointing that environment's `FF_REMOTE_MCP_URL` — not just `WorkingDirectory`.
Two processes doing write-tmp-then-rename against one `oauth.json` destroy each other's
grants.

## Operating it

```bash
systemctl --user status ff-remote-mcp
systemctl --user restart ff-remote-mcp
journalctl --user -u ff-remote-mcp -f

# Metadata chain (RFC 9728 → RFC 8414):
curl -s https://dev.fibreflow.app/.well-known/oauth-protected-resource/api/ff-remote-mcp/mcp | jq
curl -s https://dev.fibreflow.app/api/ff-remote-mcp/.well-known/oauth-authorization-server | jq
```

## Revoking

Per user, from the **Cortex page** token list, or directly:

```sql
-- one user's connector
DELETE FROM user_sessions WHERE kind='mcp' AND label='Claude connector' AND user_id=$1;
-- every connector grant
DELETE FROM user_sessions WHERE kind='mcp' AND label='Claude connector';
```

Revocation is immediate: both auth wrappers resolve the session row on every request
and 401 when it is gone. The service's own OAuth store still holds an access token, but
it is now useless.

To disable the connector entirely: `systemctl --user stop ff-remote-mcp` — the edge
proxy then fails closed (502) and FibreFlow itself is unaffected.

## Gotchas

- **`/api/health` cannot validate a token.** It is unauthenticated and 200s for any
  `Authorization` header. Token validation uses `GET /api/auth/me`, which is behind
  `withAuth`. Do not "simplify" this back.
- **Cortex's `_HTTPS` is `"http://s"`** — it derives it as `_HTTP + "s"`. Do not copy
  that idiom across; `config.py` builds the prefix independently.
- **The consent redirect must target `FF_APP_BASE`, not the proxy base.** The user's
  session cookie is on the app host. A dev service pointed at the prod base would send
  users to prod to authorize a dev connector.
- **The denylist is a blast-radius guard, not a security boundary.** RBAC and the
  read-only gate are the real controls. It is mirrored in two places —
  `scripts/build-mcp-endpoint-catalogue.ts` (`DENIED_GROUPS`) and `apps/ff_mcp/tools.py`
  — because catalogue omission alone does not stop a model constructing a path it never
  saw listed. Change both.
- **`WorkingDirectory` is the deploy dir**, not a workspace checkout. A workspace tree
  follows whatever branch is checked out and can sit frozen behind origin.
- **Read-only is enforced server-side**, in `withAuth`/`requireAuth`. The tool layer
  does not enforce it and must not pretend to.
- **The path guards run on a canonical path** — unquoted until stable, then lower-cased.
  Next.js decodes percent-escapes before routing and its route dirs are lower-case, so
  checking the raw string let `/api/Accounting/ledger` and `/api/%2e%2e/x` straight past.
- **`x-forwarded-host` is attacker-controlled here.** The nginx configs in `docs/VPS/`
  set `Host`, `X-Real-IP`, `X-Forwarded-For` and `X-Forwarded-Proto` — never
  `X-Forwarded-Host` — so it passes through from any caller.
  `pages/api/mcp/resource-metadata.ts` therefore resolves against an allow-list and
  answers `Cache-Control: no-store`; do not "simplify" it back to echoing the header.

## Tests

```bash
FF_MCP_CALLBACK_SECRET=test-secret python3 -m pytest apps/ff_mcp/ -q
npx vitest run pages/api/mcp/__tests__ tests/pages/mcp-authorize.test.tsx \
              tests/api/mcp-resource-metadata.test.ts tests/api/ff-remote-mcp-proxy.test.ts
```

Pass vitest the **test file or its directory**, not the source directory: `vitest run
pages/api/mcp` matches no `*.test.ts` and exits 1, which reads as a failure.

Related: `docs/plans/fibreflow-remote-mcp-connector-2026-07-25.md` (the plan),
`pages/api/cortex-remote-mcp/[...path].ts` (the sibling proxy this one was cloned from),
and the Cortex service itself at `Cortex/apps/cortex_mcp/server.py` in the Cortex repo —
there is no `.claude/modules/` doc for it.
