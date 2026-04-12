# Plugin Workflow Improvements Design

**Date:** 2026-04-11  
**Status:** Approved  
**Scope:** Three workflow improvements leveraging new ralph-loop, agent-sdk-dev, and cloudflare plugins

---

## Overview

Three independent improvements to FibreFlow's development and infrastructure workflows:

1. **Ralph Loop `/auto-improve-loop`** — multi-iteration autonomous CI fix cycles
2. **Cloudflare AI Gateway** — proxy OpenAI embedding calls for caching + observability
3. **CF Tunnel expansion** — expose VLM and QField webhook on Velocity; new tunnel for VPS WA services

---

## 1. Ralph Loop → `/auto-improve-loop`

### Problem

The existing `/auto-improve` command runs a single fix cycle (diagnose → implement → test → report). Reaching a clean CI state requires manually re-invoking it multiple times. There's no automated feedback loop.

### Solution

A new global command `~/.claude/commands/auto-improve-loop.md` that wraps `/auto-improve` in a ralph-loop. The loop runs fix cycles until `npm run ci:quick` exits 0, then signals completion.

### Design

**File:** `~/.claude/commands/auto-improve-loop.md`

**Arguments:** `$ARGUMENTS` — optional focus area (e.g. `types`, `lint`, `tests`). Passed through to each auto-improve cycle.

**Loop behaviour:**
- Each iteration: run one auto-improve cycle (max 50 lines, max 3 files)
- After each cycle: run `npm run ci:quick`
- Exit condition: CI exits 0 → output `<promise>CI CLEAN</promise>`
- Safety cap: 15 iterations max (outputs `<promise>MAX ITERATIONS REACHED</promise>`)
- No restarts, no env changes, no CI config modifications

**State tracking:** Each iteration appends a one-line summary to `.claude/auto-improve-loop.log` (gitignored).

**Completion detection:** ralph-loop stop hook watches for `<promise>CI CLEAN</promise>` or `<promise>MAX ITERATIONS REACHED</promise>`.

### Rationale

- Reuses all existing `/auto-improve` logic — no duplication
- 15-iteration cap prevents runaway loops on stubborn failures
- Focused mode (e.g. `/auto-improve-loop types`) lets you target specific CI gates

---

## 2. Cloudflare AI Gateway

### Problem

OpenAI embedding calls in `src/lib/wa-digest/ingestToQdrant.ts` (model: `text-embedding-3-small`) go directly to `api.openai.com`. There is no caching, no cost visibility, and no rate-limit protection.

### Current State

- No AI Gateway exists in the CF account (verified via API — `result: []`)
- OpenAI client initialised in `src/lib/llm/client.ts` without a custom `baseURL`
- `ingestToQdrant.ts` uses raw `OPENAI_API_KEY` with default OpenAI endpoint

### Solution

Create a CF AI Gateway (`fibreflow-ai`) in account `9cc447813a4d879764f613a2c35baf95`. Route all OpenAI calls through it via an env-configurable `baseURL`.

### Design

**Gateway URL:**
```
https://gateway.ai.cloudflare.com/v1/9cc447813a4d879764f613a2c35baf95/fibreflow-ai/openai
```

**Gateway settings:**
- Caching: enabled (TTL 7 days — embedding vectors are deterministic for identical input)
- Rate limiting: 500 req/min
- Logging: enabled

**Code changes:**

`src/lib/llm/client.ts`:
```typescript
instance = new OpenAI({
  apiKey,
  baseURL: process.env.OPENAI_BASE_URL,  // undefined = default OpenAI endpoint
});
```

`src/lib/wa-digest/ingestToQdrant.ts` — same pattern for inline OpenAI fetch calls.

**Env changes:**
- `.env.example`: add `OPENAI_BASE_URL=` (empty = direct, gateway when set)
- `.env.local`: set to CF AI Gateway URL

**Fallback:** `OPENAI_BASE_URL` unset → SDK defaults to `api.openai.com`. Zero breaking change.

### Rationale

- KB ingestion re-processes the same chunks frequently — 7-day cache eliminates redundant calls
- CF dashboard gives immediate visibility into embedding spend
- One env var toggles between gateway and direct

---

## 3. Cloudflare Tunnel Expansion

### Problem

**Velocity:** VLM (port 8100) and QField webhook receiver (port 8095) are accessible only via direct port. External agents can't reach them without port exposure.

**VPS (72.61.197.178):** WA Sender (8081) and WA Bridge (8083) have no CF Tunnel — open ports directly on the internet.

### Current State

- Velocity tunnel: `vf-fibreflow` (ID: `40fda93c-c6f9-4071-abf9-7481d6af8a31`), config at `/home/louis/.cloudflared/config.yml`
- Covers: `app.fibreflow.app`, `dev.fibreflow.app`, `vf.fibreflow.app`, `qfield.fibreflow.app`
- VPS: cloudflared not installed, no tunnel

### Solution

**Part A — Extend Velocity tunnel config** (`/home/louis/.cloudflared/config.yml`):

```yaml
- hostname: vlm.fibreflow.app
  service: http://localhost:8100
  originRequest:
    httpHostHeader: vlm.fibreflow.app

- hostname: qfield-hook.fibreflow.app
  service: http://localhost:8095
```

DNS: two CNAME records pointing to `40fda93c-c6f9-4071-abf9-7481d6af8a31.cfargotunnel.com`.

Cloudflare Access on `vlm.fibreflow.app`:
- Policy: One-time PIN
- Allowed email: `ai@velocityfibre.co.za`

No Access on `qfield-hook.fibreflow.app` — uses existing HMAC auth.

**Part B — New VPS tunnel** (`vf-vps`):

1. Install cloudflared on VPS (Debian `bookworm` package)
2. Create tunnel `vf-vps` via CF API
3. Write `/etc/cloudflared/config.yml`:

```yaml
tunnel: <vf-vps-id>
credentials-file: /etc/cloudflared/<vf-vps-id>.json

ingress:
  - hostname: wa-sender.fibreflow.app
    service: http://localhost:8081

  - hostname: wa-bridge.fibreflow.app
    service: http://localhost:8083

  - service: http_status:404
```

4. DNS CNAMEs for both subdomains → new tunnel
5. Enable `cloudflared.service` systemd unit

No CF Access on WA services — authenticated via `WA_BRIDGE_SECRET` HMAC header.

### Rationale

- VLM behind CF Access: prevents unauthorised GPU load
- QField webhook: removes open port 8095 exposure
- VPS WA services: CF DDoS/rate-limit shielding with no auth changes needed

---

## Implementation Order

1. `/auto-improve-loop` command — pure file creation, zero risk
2. CF AI Gateway — API call + 2 code files + env
3. Velocity tunnel extension — config edit + DNS + CF Access
4. VPS tunnel — install cloudflared, create tunnel, configure, DNS

---

## Out of Scope

- Anthropic API calls (none found in production code — only OpenAI)
- VLM model itself (Qwen3 self-hosted, CF AI Gateway is for cloud providers)
- Changes to WA service authentication logic
- Production deploy timing (follows normal business-hours gate)
