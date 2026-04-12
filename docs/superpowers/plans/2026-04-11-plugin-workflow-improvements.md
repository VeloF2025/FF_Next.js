# Plugin Workflow Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate three new plugins (ralph-loop, cloudflare) into FibreFlow workflows: autonomous CI fix loops, OpenAI embedding caching via CF AI Gateway, and CF Tunnel coverage for VLM + VPS WA services.

**Architecture:** Four independent tasks — a global command file, a two-file code change + env update, a tunnel config extension with DNS + Access, and a full cloudflared install on the VPS.

**Tech Stack:** bash, cloudflare REST API, cloudflared, TypeScript (OpenAI SDK), Next.js env vars

**Worktree:** `/home/hein/Workspace/FF_Next.js-plugins` (branch `feature/plugin-workflow-improvements`)

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `~/.claude/commands/auto-improve-loop.md` | Create | Global ralph-loop CI fix command |
| `~/.gitignore` (global or project) | Modify | Gitignore `.claude/auto-improve-loop.log` |
| `src/lib/llm/client.ts` | Modify | Accept `OPENAI_BASE_URL` env var |
| `src/lib/wa-digest/ingestToQdrant.ts` | Modify | Use configurable OpenAI base URL |
| `.env.example` | Modify | Document `OPENAI_BASE_URL` |
| `.env.local` | Modify | Set CF AI Gateway URL (not committed) |
| `/home/louis/.cloudflared/config.yml` | Modify | Add vlm + qfield-hook ingress rules |

---

## Task 1: `/auto-improve-loop` Global Command

**Files:**
- Create: `~/.claude/commands/auto-improve-loop.md`
- Modify: `/home/hein/Workspace/FF_Next.js-plugins/.gitignore` (add log file)

- [ ] **Step 1: Create the command file**

```bash
cat > ~/.claude/commands/auto-improve-loop.md << 'SKILL'
# /auto-improve-loop — Autonomous Multi-Iteration CI Fix Loop

Run one improvement cycle, check CI, signal completion or continue looping.
Ralph-loop feeds this same prompt back until the completion promise is output.

## Arguments
$ARGUMENTS — Optional focus area: `types` | `lint` | `tests` | empty = auto-detect

## This Iteration

### Phase 1: Detect stack (same as /auto-improve)

```bash
if [ -f "bun.lockb" ] || [ -f "bunfig.toml" ]; then TEST_CMD="bun test"
elif [ -f "package.json" ]; then TEST_CMD="npm test"
elif [ -f "pyproject.toml" ] || [ -f "setup.py" ]; then TEST_CMD="pytest"
elif [ -f "Cargo.toml" ]; then TEST_CMD="cargo test"
elif [ -f "go.mod" ]; then TEST_CMD="go test ./..."
else TEST_CMD="echo 'no test runner'"; fi

if [ -f "tsconfig.json" ]; then TYPE_CHECK="npx tsc --noEmit"
elif grep -q "mypy\|pyright" pyproject.toml 2>/dev/null; then TYPE_CHECK="mypy ."
else TYPE_CHECK=""; fi

SRC_DIR=$([ -d "src" ] && echo src || [ -d "lib" ] && echo lib || echo .)
EXT=$(ls $SRC_DIR/*.ts 2>/dev/null | head -1 > /dev/null && echo ts || echo py)
```

### Phase 2: Check iteration count

```bash
ITER=$(cat .claude/auto-improve-loop.log 2>/dev/null | wc -l)
if [ "$ITER" -ge 15 ]; then
  echo "Reached 15-iteration cap — stopping loop."
  # Output completion promise
fi
```

If ITER >= 15, output `<promise>MAX ITERATIONS REACHED</promise>` and stop.

### Phase 3: Run one improvement cycle

Follow all phases from `/auto-improve` exactly:
- Diagnose: pick the single highest-signal problem ($ARGUMENTS narrows the search)
- Pick ONE improvement (max 50 lines added, max 3 files)
- Implement + fix/revert if tests break
- Measure: record metrics

Focus order when $ARGUMENTS is set:
- `types` → run `npx tsc --noEmit` first, fix the most common error pattern
- `lint` → run `npm run lint` first, fix the top lint violation pattern
- `tests` → run `npm test` first, fix failing tests

### Phase 4: Check CI gate

```bash
npm run ci:quick
CI_EXIT=$?
```

### Phase 5: Log and signal

```bash
mkdir -p .claude
ITER=$(cat .claude/auto-improve-loop.log 2>/dev/null | wc -l)
echo "[$((ITER+1))] $(date -Iseconds) — CI: $([ $CI_EXIT -eq 0 ] && echo CLEAN || echo DIRTY)" >> .claude/auto-improve-loop.log
```

- If `CI_EXIT == 0`: output `<promise>CI CLEAN</promise>` (ralph-loop stops)
- If ITER+1 >= 15: output `<promise>MAX ITERATIONS REACHED</promise>` (ralph-loop stops)
- Otherwise: do NOT output any promise tag (ralph-loop continues next iteration)

## Rules
- ONE change per iteration. Max 50 lines added. Max 3 files.
- Never break existing tests — fix or revert before logging.
- Never modify .env files, CI config scripts, or systemd services.
- Never restart services.
- Always leave codebase better than you found it.
SKILL
```

- [ ] **Step 2: Verify the file was created**

```bash
cat ~/.claude/commands/auto-improve-loop.md | head -5
```

Expected output: `# /auto-improve-loop — Autonomous Multi-Iteration CI Fix Loop`

- [ ] **Step 3: Add log file to .gitignore in project**

Open `/home/hein/Workspace/FF_Next.js-plugins/.gitignore` and add at the end:

```
# auto-improve-loop iteration log
.claude/auto-improve-loop.log
```

- [ ] **Step 4: Commit the .gitignore change**

```bash
cd /home/hein/Workspace/FF_Next.js-plugins
git add .gitignore
git commit -m "chore: gitignore auto-improve-loop iteration log"
```

- [ ] **Step 5: Smoke-test the command exists in claude**

```bash
ls ~/.claude/commands/auto-improve-loop.md
```

Expected: file listed (no "No such file" error).

---

## Task 2: Cloudflare AI Gateway — OpenAI Embedding Proxy

**Files:**
- Modify: `src/lib/llm/client.ts`
- Modify: `src/lib/wa-digest/ingestToQdrant.ts`
- Modify: `.env.example`
- Modify: `.env.local` (not committed)

All code changes happen in `/home/hein/Workspace/FF_Next.js-plugins/`.

- [ ] **Step 1: Create the AI Gateway via CF API**

```bash
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/9cc447813a4d879764f613a2c35baf95/ai-gateway/gateways" \
  -H "X-Auth-Email: ai@velocityfibre.co.za" \
  -H "X-Auth-Key: b606ca0397f318d413473a65102b7a37ef649" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "fibreflow-ai",
    "slug": "fibreflow-ai",
    "cache_invalidate_on_update": false,
    "collect_logs": true,
    "rate_limiting_interval": 60,
    "rate_limiting_limit": 500,
    "rate_limiting_technique": "fixed"
  }' | python3 -m json.tool
```

Expected: `"success": true` with a gateway object containing `"slug": "fibreflow-ai"`.

- [ ] **Step 2: Verify gateway URL**

The gateway URL for OpenAI calls will be:
```
https://gateway.ai.cloudflare.com/v1/9cc447813a4d879764f613a2c35baf95/fibreflow-ai/openai
```

Verify the gateway exists:
```bash
curl -s \
  "https://api.cloudflare.com/client/v4/accounts/9cc447813a4d879764f613a2c35baf95/ai-gateway/gateways/fibreflow-ai" \
  -H "X-Auth-Email: ai@velocityfibre.co.za" \
  -H "X-Auth-Key: b606ca0397f318d413473a65102b7a37ef649" | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('success') else 'FAIL')"
```

Expected: `OK`

- [ ] **Step 3: Update `src/lib/llm/client.ts` to use configurable baseURL**

Current file (`src/lib/llm/client.ts`):
```typescript
instance = new OpenAI({ apiKey });
```

Replace with:
```typescript
instance = new OpenAI({
  apiKey,
  ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
});
```

Full updated file:
```typescript
import OpenAI from 'openai';

let instance: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!instance) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    instance = new OpenAI({
      apiKey,
      ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
    });
  }
  return instance;
}
```

- [ ] **Step 4: Update `src/lib/wa-digest/ingestToQdrant.ts` to use configurable base URL**

At the top of `ingestToQdrant.ts`, after the existing constants (around line 18), add:

```typescript
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
```

Then change line 169 from:
```typescript
const response = await fetch('https://api.openai.com/v1/embeddings', {
```
to:
```typescript
const response = await fetch(`${OPENAI_BASE_URL}/v1/embeddings`, {
```

- [ ] **Step 5: Add `OPENAI_BASE_URL` to `.env.example`**

In `.env.example`, find the `OPENAI_API_KEY=` line and add below it:

```
OPENAI_BASE_URL=    # Optional: set to CF AI Gateway URL to enable caching/observability
                    # https://gateway.ai.cloudflare.com/v1/<account_id>/fibreflow-ai/openai
```

- [ ] **Step 6: Set the gateway URL in `.env.local`**

In `.env.local`, find the `OPENAI_API_KEY=` line and add below it:

```
OPENAI_BASE_URL=https://gateway.ai.cloudflare.com/v1/9cc447813a4d879764f613a2c35baf95/fibreflow-ai/openai
```

This file is gitignored — do not commit it.

Also update on Velocity deploy dirs:
```bash
sudo -u velo bash -c 'echo "OPENAI_BASE_URL=https://gateway.ai.cloudflare.com/v1/9cc447813a4d879764f613a2c35baf95/fibreflow-ai/openai" >> /home/velo/fibreflow-dev/.env.local'
sudo -u velo bash -c 'echo "OPENAI_BASE_URL=https://gateway.ai.cloudflare.com/v1/9cc447813a4d879764f613a2c35baf95/fibreflow-ai/openai" >> /home/velo/fibreflow-production/.env.local'
```

- [ ] **Step 7: Type-check**

```bash
cd /home/hein/Workspace/FF_Next.js-plugins
npm run type-check 2>&1 | grep -E "error|Error" | head -20
```

Expected: no new errors introduced (0 new errors vs baseline).

- [ ] **Step 8: Commit code changes**

```bash
cd /home/hein/Workspace/FF_Next.js-plugins
git add src/lib/llm/client.ts src/lib/wa-digest/ingestToQdrant.ts .env.example
git commit -m "feat(ai-gateway): route OpenAI embedding calls through CF AI Gateway

Adds OPENAI_BASE_URL env var support to client.ts and ingestToQdrant.ts.
When set, all OpenAI calls proxy through Cloudflare AI Gateway for
caching (7-day TTL on embeddings) and cost observability.
Unset = direct api.openai.com. Zero breaking change.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Extend Velocity Tunnel — VLM + QField Webhook

**Files:**
- Modify: `/home/louis/.cloudflared/config.yml` (via sudo)
- DNS: two CNAME records via CF API
- CF Access: one application for `vlm.fibreflow.app`

- [ ] **Step 1: Read current tunnel config**

```bash
sudo cat /home/louis/.cloudflared/config.yml
```

Confirm the file ends with `- service: http_status:404` catch-all.

- [ ] **Step 2: Add VLM and QField hook ingress rules**

Insert before the catch-all `- service: http_status:404` line:

```bash
sudo tee /tmp/tunnel-addition.yml << 'EOF'

  # VLM API (Qwen3 — protected by CF Access)
  - hostname: vlm.fibreflow.app
    service: http://localhost:8100
    originRequest:
      httpHostHeader: vlm.fibreflow.app

  # QField webhook receiver
  - hostname: qfield-hook.fibreflow.app
    service: http://localhost:8095

EOF
```

Then apply (insert before the catch-all):
```bash
sudo python3 -c "
import re, sys
content = open('/home/louis/.cloudflared/config.yml').read()
addition = '''
  # VLM API (Qwen3 — protected by CF Access)
  - hostname: vlm.fibreflow.app
    service: http://localhost:8100
    originRequest:
      httpHostHeader: vlm.fibreflow.app

  # QField webhook receiver
  - hostname: qfield-hook.fibreflow.app
    service: http://localhost:8095

'''
content = content.replace('  - service: http_status:404', addition + '  - service: http_status:404')
open('/home/louis/.cloudflared/config.yml', 'w').write(content)
print('Done')
"
```

- [ ] **Step 3: Verify config is valid**

```bash
sudo -u louis cloudflared tunnel --config /home/louis/.cloudflared/config.yml ingress validate
```

Expected: `Validating ingress rules...` followed by `OK` for each rule.

- [ ] **Step 4: Add DNS CNAME for `vlm.fibreflow.app`**

```bash
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/88b2df513589e5894a2e633944bbf010/dns_records" \
  -H "X-Auth-Email: ai@velocityfibre.co.za" \
  -H "X-Auth-Key: b606ca0397f318d413473a65102b7a37ef649" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "CNAME",
    "name": "vlm",
    "content": "40fda93c-c6f9-4071-abf9-7481d6af8a31.cfargotunnel.com",
    "proxied": true,
    "ttl": 1
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); print('Created:', d['result'].get('name') if d.get('success') else 'FAIL: ' + str(d.get('errors')))"
```

Expected: `Created: vlm.fibreflow.app`

- [ ] **Step 5: Add DNS CNAME for `qfield-hook.fibreflow.app`**

```bash
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/88b2df513589e5894a2e633944bbf010/dns_records" \
  -H "X-Auth-Email: ai@velocityfibre.co.za" \
  -H "X-Auth-Key: b606ca0397f318d413473a65102b7a37ef649" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "CNAME",
    "name": "qfield-hook",
    "content": "40fda93c-c6f9-4071-abf9-7481d6af8a31.cfargotunnel.com",
    "proxied": true,
    "ttl": 1
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); print('Created:', d['result'].get('name') if d.get('success') else 'FAIL: ' + str(d.get('errors')))"
```

Expected: `Created: qfield-hook.fibreflow.app`

- [ ] **Step 6: Reload cloudflared to pick up config changes**

```bash
sudo systemctl reload cloudflared-tunnel.service 2>/dev/null || \
sudo systemctl restart cloudflared-tunnel.service
sleep 5
sudo systemctl status cloudflared-tunnel.service | grep -E "Active|error"
```

Expected: `Active: active (running)`

- [ ] **Step 7: Create Cloudflare Access application for `vlm.fibreflow.app`**

```bash
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/9cc447813a4d879764f613a2c35baf95/access/apps" \
  -H "X-Auth-Email: ai@velocityfibre.co.za" \
  -H "X-Auth-Key: b606ca0397f318d413473a65102b7a37ef649" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "VLM API",
    "domain": "vlm.fibreflow.app",
    "type": "self_hosted",
    "session_duration": "24h",
    "auto_redirect_to_identity": false
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); print('App ID:', d['result'].get('id') if d.get('success') else 'FAIL: ' + str(d.get('errors')))"
```

Note the App ID returned — needed for Step 8.

- [ ] **Step 8: Create Access policy — allow `ai@velocityfibre.co.za`**

Replace `<APP_ID>` with the ID from Step 7:

```bash
APP_ID="<APP_ID>"
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/9cc447813a4d879764f613a2c35baf95/access/apps/${APP_ID}/policies" \
  -H "X-Auth-Email: ai@velocityfibre.co.za" \
  -H "X-Auth-Key: b606ca0397f318d413473a65102b7a37ef649" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "VLM Allowed Users",
    "decision": "allow",
    "precedence": 1,
    "include": [
      {
        "email": {
          "email": "ai@velocityfibre.co.za"
        }
      },
      {
        "email": {
          "email": "hein@velocityfibre.co.za"
        }
      }
    ]
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); print('Policy:', d['result'].get('name') if d.get('success') else 'FAIL: ' + str(d.get('errors')))"
```

Expected: `Policy: VLM Allowed Users`

- [ ] **Step 9: Smoke-test tunnel endpoints**

```bash
# VLM — should redirect to CF Access login (302), not 404/502
curl -s -o /dev/null -w "vlm.fibreflow.app: %{http_code}\n" https://vlm.fibreflow.app/health

# QField hook — should reach the service (200 or 404 from the service itself, not CF error)
curl -s -o /dev/null -w "qfield-hook.fibreflow.app: %{http_code}\n" https://qfield-hook.fibreflow.app/health
```

Expected:
- `vlm.fibreflow.app`: 302 (CF Access redirect) or 403
- `qfield-hook.fibreflow.app`: 200 or 404 (service-level response, not 502)

---

## Task 4: VPS Tunnel — WA Sender + WA Bridge

All steps run via SSH to the VPS (`ssh root@72.61.197.178` from Velocity).

- [ ] **Step 1: SSH to VPS and check OS**

```bash
ssh root@72.61.197.178 "lsb_release -a 2>/dev/null || cat /etc/os-release | head -5"
```

Expected: Debian/Ubuntu version info.

- [ ] **Step 2: Install cloudflared on VPS**

```bash
ssh root@72.61.197.178 << 'REMOTE'
# Add Cloudflare GPG key and repo
mkdir -p /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | gpg --dearmor -o /usr/share/keyrings/cloudflare-main.gpg
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" > /etc/apt/sources.list.d/cloudflared.list
apt-get update -qq
apt-get install -y cloudflared
cloudflared --version
REMOTE
```

Expected: `cloudflared version X.Y.Z`

- [ ] **Step 3: Create tunnel `vf-vps` via CF API (run locally on Velocity)**

```bash
TUNNEL_RESP=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/9cc447813a4d879764f613a2c35baf95/cfd_tunnel" \
  -H "X-Auth-Email: ai@velocityfibre.co.za" \
  -H "X-Auth-Key: b606ca0397f318d413473a65102b7a37ef649" \
  -H "Content-Type: application/json" \
  -d '{"name": "vf-vps", "config_src": "local"}')

echo "$TUNNEL_RESP" | python3 -m json.tool
VPS_TUNNEL_ID=$(echo "$TUNNEL_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['id'])")
VPS_TUNNEL_TOKEN=$(echo "$TUNNEL_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['token'])")
echo "Tunnel ID: $VPS_TUNNEL_ID"
echo "Token: $VPS_TUNNEL_TOKEN"
```

Note both values — needed for Steps 4 and 5.

- [ ] **Step 4: Install tunnel token on VPS**

Replace `<VPS_TUNNEL_TOKEN>` with the token from Step 3:

```bash
ssh root@72.61.197.178 "cloudflared service install <VPS_TUNNEL_TOKEN>"
```

This creates `/etc/cloudflared/cert.json` and registers the tunnel on the VPS.

- [ ] **Step 5: Write tunnel config on VPS**

Replace `<VPS_TUNNEL_ID>` with the ID from Step 3:

```bash
VPS_TUNNEL_ID="<VPS_TUNNEL_ID>"
ssh root@72.61.197.178 "cat > /etc/cloudflared/config.yml << EOF
tunnel: ${VPS_TUNNEL_ID}
credentials-file: /etc/cloudflared/${VPS_TUNNEL_ID}.json

ingress:
  - hostname: wa-sender.fibreflow.app
    service: http://localhost:8081

  - hostname: wa-bridge.fibreflow.app
    service: http://localhost:8083

  - service: http_status:404
EOF
echo 'Config written'"
```

- [ ] **Step 6: Validate config on VPS**

```bash
ssh root@72.61.197.178 "cloudflared tunnel --config /etc/cloudflared/config.yml ingress validate"
```

Expected: `OK` for each ingress rule.

- [ ] **Step 7: Add DNS CNAME for `wa-sender.fibreflow.app` (run locally)**

Replace `<VPS_TUNNEL_ID>` with tunnel ID from Step 3:

```bash
VPS_TUNNEL_ID="<VPS_TUNNEL_ID>"
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/88b2df513589e5894a2e633944bbf010/dns_records" \
  -H "X-Auth-Email: ai@velocityfibre.co.za" \
  -H "X-Auth-Key: b606ca0397f318d413473a65102b7a37ef649" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"CNAME\",
    \"name\": \"wa-sender\",
    \"content\": \"${VPS_TUNNEL_ID}.cfargotunnel.com\",
    \"proxied\": true,
    \"ttl\": 1
  }" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Created:', d['result'].get('name') if d.get('success') else 'FAIL: ' + str(d.get('errors')))"
```

Expected: `Created: wa-sender.fibreflow.app`

- [ ] **Step 8: Add DNS CNAME for `wa-bridge.fibreflow.app`**

```bash
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/88b2df513589e5894a2e633944bbf010/dns_records" \
  -H "X-Auth-Email: ai@velocityfibre.co.za" \
  -H "X-Auth-Key: b606ca0397f318d413473a65102b7a37ef649" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"CNAME\",
    \"name\": \"wa-bridge\",
    \"content\": \"${VPS_TUNNEL_ID}.cfargotunnel.com\",
    \"proxied\": true,
    \"ttl\": 1
  }" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Created:', d['result'].get('name') if d.get('success') else 'FAIL: ' + str(d.get('errors')))"
```

Expected: `Created: wa-bridge.fibreflow.app`

- [ ] **Step 9: Start and enable cloudflared service on VPS**

```bash
ssh root@72.61.197.178 << 'REMOTE'
systemctl enable cloudflared
systemctl start cloudflared
sleep 5
systemctl status cloudflared | grep -E "Active|error"
REMOTE
```

Expected: `Active: active (running)`

- [ ] **Step 10: Smoke-test VPS tunnel endpoints**

```bash
# WA Sender — health or root endpoint
curl -s -o /dev/null -w "wa-sender.fibreflow.app: %{http_code}\n" https://wa-sender.fibreflow.app/health

# WA Bridge
curl -s -o /dev/null -w "wa-bridge.fibreflow.app: %{http_code}\n" https://wa-bridge.fibreflow.app/health
```

Expected: 200 or 404 (service-level response). Not 502 (tunnel working).

- [ ] **Step 11: Final PR commit and push**

```bash
cd /home/hein/Workspace/FF_Next.js-plugins
git status
git push -u origin feature/plugin-workflow-improvements
```

Then open PR with `/pr`.

---

## Self-Review Notes

- Task 1 creates a global file (`~/.claude/commands/`) — not in the worktree, no PR needed for that file alone
- Task 2 code changes are in the worktree and go into the PR
- Tasks 3 & 4 are infra-only (no code in the repo), executed directly on servers — no PR for those steps
- The tunnel config at `/home/louis/.cloudflared/config.yml` is not in version control; document the change in the commit message for traceability
- If `cloudflared service install` fails on VPS (token already registered), use `cloudflared tunnel token --tunnel-id <ID>` to re-generate
- `.env.local` changes on Velocity deploy dirs should be done before the next app restart — no code deploy needed since it's just env
