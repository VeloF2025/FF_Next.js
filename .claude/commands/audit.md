# /audit - Comprehensive Production Readiness Audit

Full system audit covering infrastructure, code quality, APIs, UI, and functionality. Run this to verify the app is production-ready with zero issues.

## Usage

```
/audit                        # Full system audit (all checks)
/audit quick                  # Quick smoke test (critical paths only)
/audit [module]               # Module-specific audit (activate, procurement, fleet, etc.)
/audit infra                  # Infrastructure only
/audit code                   # Code quality only
/audit api                    # API endpoints only
/audit ui                     # UI/UX only
```

## Audit Levels

| Level | Time | Coverage |
|-------|------|----------|
| `quick` | ~5 min | Health endpoints, critical pages, no console errors |
| `module` | ~15 min | Single module deep dive |
| `full` | ~45 min | Everything below |

---

## 1. INFRASTRUCTURE AUDIT

### 1.1 Environment Health

**Check ALL environments respond:**
```bash
# External (through Cloudflare)
curl -s -o /dev/null -w 'PROD: %{http_code}\n' https://app.fibreflow.app/api/health
curl -s -o /dev/null -w 'STAGING: %{http_code}\n' https://vf.fibreflow.app/api/health
curl -s -o /dev/null -w 'DEV: %{http_code}\n' https://dev.fibreflow.app/api/health

# Internal (localhost on server)
sshpass -p 'velo2026' ssh velo@100.96.203.105 "
  echo 'PROD (3000):' \$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/health)
  echo 'STAGING (3006):' \$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3006/api/health)
  echo 'DEV (3005):' \$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3005/api/health)
"
```

**Expected:** All return `200`

### 1.2 Service Health Endpoints

| Service | Endpoint | Expected |
|---------|----------|----------|
| App Health | `/api/health` | `{ status: "ok" }` |
| Database | `/api/health/db` | Connection success |
| Activate | `/api/activate/health-check` | 5 services green |
| WA Monitor | `/api/wa-monitor-health` | Bridge + Sender OK |
| VLM | `curl localhost:8100/health` | Model loaded |
| QField Sync | `curl localhost:8095/health` | Webhook ready |

### 1.3 Critical Services (Server)

```bash
sshpass -p 'velo2026' ssh velo@100.96.203.105 "
  echo '=== SERVICES ==='
  echo 'nginx:' \$(systemctl is-active nginx)
  echo 'cloudflared:' \$(systemctl is-active cloudflared-tunnel.service)
  echo 'fibreflow-prod:' \$(systemctl is-active fibreflow-production.service)
  echo 'fibreflow-staging:' \$(systemctl is-active fibreflow.service)
  echo 'fibreflow-dev:' \$(systemctl is-active fibreflow-dev.service)
  echo 'vllm-qwen:' \$(systemctl is-active vllm-qwen.service)
  echo 'wa-monitor-prod:' \$(systemctl is-active wa-monitor-prod)
  echo 'whatsapp-sender-2:' \$(systemctl is-active whatsapp-sender-2.service)
  echo 'whatsapp-bridge-2:' \$(systemctl is-active whatsapp-bridge-2.service)
  echo 'wa-feedback:' \$(systemctl is-active wa-feedback)
  echo 'qfield-webhook:' \$(systemctl is-active qfield-oes-webhook)
"
```

### 1.4 Cloudflare Tunnel

```bash
# Check tunnel connections
sshpass -p 'velo2026' ssh velo@100.96.203.105 "curl -s http://127.0.0.1:20241/metrics 2>/dev/null | grep cloudflared_tunnel_ha_connections"
```

**Expected:** `cloudflared_tunnel_ha_connections 4`

### 1.5 Database Connectivity

```bash
# Test direct query
DATABASE_URL='postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require' node -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql\`SELECT 1 as ok\`.then(r => console.log('DB:', r[0].ok === 1 ? 'CONNECTED' : 'FAILED'));
"
```

---

## 2. CODE QUALITY AUDIT

### 2.1 No Console.log (Production)

```bash
# Find console.log in production code (excluding tests, node_modules)
grep -rn "console\.log" src/ pages/ --include="*.ts" --include="*.tsx" | grep -v "// DEBUG" | grep -v "\.test\." | head -20
```

**Expected:** Zero results (use `log` from `@/lib/logger` instead)

### 2.2 No Hardcoded Values

```bash
# Hardcoded URLs
grep -rn "localhost:3" src/ pages/ --include="*.ts" --include="*.tsx" | grep -v "env\." | grep -v "\.md" | head -10

# Hardcoded IPs
grep -rn "100\.96\.203\." src/ pages/ --include="*.ts" --include="*.tsx" | grep -v "\.md" | head -10

# Hardcoded credentials (CRITICAL)
grep -rn "npg_\|password.*=" src/ pages/ --include="*.ts" --include="*.tsx" | head -10
```

**Expected:** Zero results for credentials, URLs should use env vars

### 2.3 No Mock/Demo Data in Production Code

```bash
# Find mock patterns
grep -rn "mock\|MOCK\|demo\|DEMO\|fake\|FAKE\|dummy\|DUMMY\|test@\|example\.com" src/ pages/ --include="*.ts" --include="*.tsx" | grep -v "\.test\.\|\.spec\.\|__tests__\|__mocks__" | head -20

# Find TODO/FIXME in critical paths
grep -rn "TODO\|FIXME\|HACK\|XXX" src/modules/ pages/api/ --include="*.ts" --include="*.tsx" | head -20
```

**Expected:** Zero mocks in production code

### 2.4 No Empty Catch Blocks

```bash
grep -rn "catch.*{.*}" src/ pages/ --include="*.ts" --include="*.tsx" -A 1 | grep -B 1 "^[^:]*:[^:]*:[ ]*}$" | head -20
```

**Expected:** All catch blocks have error handling

### 2.5 No `any` Types

```bash
grep -rn ": any\|as any\|<any>" src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | wc -l
```

**Expected:** Minimal (< 50), ideally zero

### 2.6 No Stale Data Displays

**Critical Pattern:**
```typescript
// BAD - uses potentially stale stored count
{record.itemCount}

// GOOD - calculates from actual data
{items.length}
```

```bash
# Find potential stale count patterns
grep -rn "\.count}\|\.Count}\|itemCount\|totalCount" src/modules/ src/components/ pages/ --include="*.tsx" | head -20
```

**Review each:** Ensure displayed counts come from actual data arrays, not stored values.

---

## 3. API AUDIT

### 3.1 All API Routes Return Proper Responses

```bash
# List all API routes
find pages/api -name "*.ts" | wc -l
```

**Test each route category:**

| Category | Sample Test | Expected |
|----------|------------|----------|
| Health | `GET /api/health` | `200 { status: "ok" }` |
| CRUD List | `GET /api/projects` | `200 { data: [...] }` |
| CRUD Get | `GET /api/projects/[id]` | `200 { data: {...} }` |
| CRUD Create | `POST /api/projects` | `201 { data: {...} }` |
| Not Found | `GET /api/projects/invalid-uuid` | `404 { error: "..." }` |
| Auth Required | Without token | `401` |

### 3.2 No 500 Errors with Stack Traces

```bash
# Test key endpoints
for endpoint in /api/health /api/projects /api/staff /api/activate/drops /api/procurement/boq; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:3005$endpoint")
  echo "$endpoint: $code"
done
```

**Expected:** No 500s, all proper status codes

### 3.3 Error Response Format

All errors should follow:
```json
{
  "success": false,
  "error": "Human-readable message",
  "code": "ERROR_CODE"
}
```

**NOT:**
```json
{
  "error": "Error: something went wrong at /path/to/file.ts:123"
}
```

---

## 4. UI/UX AUDIT

### 4.1 Dark Theme Compliance

**Required CSS Variables:**
```css
var(--ff-bg-primary)      /* Page background */
var(--ff-bg-secondary)    /* Cards, sections */
var(--ff-bg-tertiary)     /* Inputs, nested elements */
var(--ff-text-primary)    /* Headings */
var(--ff-text-secondary)  /* Body text */
var(--ff-border-light)    /* Borders */
```

**Find violations:**
```bash
grep -rn "bg-white\|bg-gray-50\|bg-gray-100\|text-gray-900\|border-gray-200" src/modules/ src/components/ pages/ --include="*.tsx" | head -20
```

**Expected:** Zero light theme leaks

### 4.2 Currency Formatting (ZAR)

| Context | Format | Example |
|---------|--------|---------|
| Large amounts | Space thousands | `R 695 775` |
| Precise | Comma decimal | `R 194 287,50` |
| Small | Period decimal | `R29.36` |

**Check:** All monetary displays use proper formatting

### 4.3 Number Formatting

| Type | Format | Example |
|------|--------|---------|
| Quantities | Comma separator | `8,586` |
| Large counts | Space (SA) | `16 000` |
| Percentages | No separator | `85%` |

### 4.4 Status Badges

| Status | Background | Text |
|--------|------------|------|
| Active/Success | `bg-green-500/20` | `text-green-400` |
| Pending/Warning | `bg-yellow-500/20` | `text-yellow-400` |
| Error/Failed | `bg-red-500/20` | `text-red-400` |
| Draft/Inactive | `bg-gray-500/20` | `text-gray-400` |

### 4.5 Toast Notifications

All CRUD operations MUST show feedback:
```typescript
import { notificationService } from '@/services/core/NotificationService';

notificationService.success('Item saved');
notificationService.error('Failed to save');
```

**Verify:** Success/error toasts after every create, update, delete

---

## 5. FUNCTIONAL AUDIT

### 5.1 Navigation - All Links Work

Test EVERY sidebar link:
- [ ] Dashboard
- [ ] Projects (list, detail, edit)
- [ ] Staff/People (list, detail, edit)
- [ ] Contractors (list, detail, onboarding)
- [ ] Clients (list, detail)
- [ ] Fleet (dashboard, vehicles, drivers, check-in, fuel)
- [ ] Procurement (dashboard, BOQ, RFQ, PO, Stock, etc.)
- [ ] Ticketing (dashboard, tickets, escalations)
- [ ] Assets (list, maintenance, calibration)
- [ ] Activate (QA Centre, Reports, OES Import)
- [ ] Analytics
- [ ] Settings

**Check:** No 404s, no blank pages

### 5.2 Buttons - All Actions Work

Test button categories:
- [ ] Create/Add buttons → Open forms/modals
- [ ] Edit buttons → Enable editing
- [ ] Delete buttons → Confirmation then delete
- [ ] Submit buttons → Save and show feedback
- [ ] Cancel buttons → Close without saving
- [ ] Export buttons → Download file

### 5.3 Modals - Open/Close/Submit

| Modal | Location | Test |
|-------|----------|------|
| StockItemSelector | BOQ/RFQ | Open, search, select, create |
| ConvertToPOModal | RFQ | Open, review, submit |
| ExitEmployeeModal | Staff | Open, fill, submit |
| BarcodeScannerModal | Multiple | Open camera, scan |
| Confirmation dialogs | Delete actions | Confirm/cancel |

### 5.4 Forms - Validation Works

Test validation on key forms:
- [ ] Staff form - Required fields, email format
- [ ] Project form - Dates, budget > 0
- [ ] BOQ form - At least 1 line item
- [ ] RFQ form - Deadline, suppliers selected

### 5.5 Flows - Complete User Journeys

**BOQ → RFQ → PO Flow:**
1. Create BOQ with items
2. Create RFQ from BOQ
3. Add suppliers to RFQ
4. Convert RFQ to PO
5. Receive goods (GRN)

**Staff Onboarding Flow:**
1. Create staff member
2. Upload documents
3. Verify compliance
4. Assign to department

**Activate QA Flow:**
1. DR appears in QA Centre
2. Open 5-phase wizard
3. Complete each phase
4. Send WhatsApp feedback

### 5.6 Data Loading - No Errors

Check for:
- [ ] Loading states shown while fetching
- [ ] Empty states shown when no data
- [ ] Error states shown on failure
- [ ] No "undefined" or "null" displayed
- [ ] No NaN in calculations

---

## 6. CONSOLE & NETWORK AUDIT

### 6.1 Zero Console Errors

For EVERY page:
```javascript
// Using claude-in-chrome
mcp__claude-in-chrome__read_console_messages({
  tabId: T,
  pattern: "error|exception|fail",
  onlyErrors: true
})
```

**Expected:** Zero errors

### 6.2 Zero Failed Network Requests

```javascript
// Check for 4xx/5xx
mcp__claude-in-chrome__read_network_requests({
  tabId: T,
  urlPattern: "/api/"
})
```

**Expected:** All 200/201, no 4xx/5xx

### 6.3 No Hydration Warnings

Check for React hydration mismatches:
```
Warning: Text content did not match
Warning: Expected server HTML to contain
```

**Expected:** Zero hydration warnings

---

## 7. RBAC AUDIT (Quick)

Quick checks for Role-Based Access Control system. For comprehensive RBAC audit, run `/audit-rbac`.

### 7.1 Database Tables Exist

```bash
DATABASE_URL='postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require' node -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
(async () => {
  const tables = await sql\`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('access_permissions', 'role_permissions', 'user_permission_overrides')\`;
  console.log('RBAC Tables:', tables.length === 3 ? '✅ All 3 exist' : '❌ Missing tables');
})();
"
```

### 7.2 Permission Data Seeded

```bash
DATABASE_URL='postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require' node -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
(async () => {
  const perms = await sql\`SELECT type, COUNT(*) as c FROM access_permissions WHERE is_active = true GROUP BY type ORDER BY type\`;
  const roles = await sql\`SELECT DISTINCT role FROM role_permissions\`;
  console.log('Permissions:', perms.map(p => p.type + ':' + p.c).join(', '));
  console.log('Roles:', roles.map(r => r.role).join(', '));
})();
"
```

**Expected:**
- Modules: 14, Pages: 50+, Tabs: 15+
- Roles: admin, contractor, manager, super_admin, technician, viewer

### 7.3 Super Admin Has 'all' Permission

```bash
DATABASE_URL='postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require' node -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
(async () => {
  const admins = await sql\`SELECT email, permissions FROM users WHERE role = 'super_admin'\`;
  admins.forEach(a => {
    const hasAll = a.permissions && a.permissions.includes('all');
    console.log(a.email + ':', hasAll ? '✅ has [all]' : '❌ missing [all]');
  });
})();
"
```

### 7.4 API Endpoints Respond

```bash
# Test with auth (requires valid session)
for endpoint in /api/admin/permissions /api/admin/roles /api/admin/users; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:3005$endpoint")
  echo "$endpoint: $code"
done
```

**Expected:** 200 (with auth) or 401 (without auth)

### 7.5 Access Control UI

Navigate to: **Settings > Access Control**

Check:
- [ ] Users tab loads with user list
- [ ] Roles tab shows 6 roles with permission matrix
- [ ] Permissions tab shows hierarchical tree (14 modules)
- [ ] No console errors

**For full RBAC audit:** Run `/audit-rbac`

---

## 8. QUICK CHECKS

### One-Command Infrastructure Check
```bash
# Run from local machine
echo "=== EXTERNAL ===" && \
curl -s -o /dev/null -w 'PROD: %{http_code}\n' https://app.fibreflow.app/api/health && \
curl -s -o /dev/null -w 'STAGING: %{http_code}\n' https://vf.fibreflow.app/api/health && \
curl -s -o /dev/null -w 'DEV: %{http_code}\n' https://dev.fibreflow.app/api/health && \
echo "=== SERVICES ===" && \
curl -s https://vf.fibreflow.app/api/activate/health-check | jq -r '.services | to_entries[] | "\(.key): \(.value.status)"'
```

### One-Command Code Quality Check
```bash
echo "=== CONSOLE.LOG ===" && \
grep -rn "console\.log" src/ pages/ --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "// DEBUG" | wc -l && \
echo "=== MOCKS ===" && \
grep -rn "mock\|MOCK" src/ pages/ --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "\.test\.\|__mocks__" | wc -l && \
echo "=== ANY TYPES ===" && \
grep -rn ": any" src/ --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l
```

---

## AUDIT REPORT TEMPLATE

```markdown
# Production Readiness Audit Report
## Date: YYYY-MM-DD HH:MM
## Environment: [dev | staging | production]
## Auditor: Claude Code

---

## Executive Summary
- **Overall Status:** [READY | NOT READY | BLOCKED]
- **Critical Issues:** X
- **Warnings:** X

---

## 1. Infrastructure
| Check | Status |
|-------|--------|
| Production (app.fibreflow.app) | ✅ 200 |
| Staging (vf.fibreflow.app) | ✅ 200 |
| Dev (dev.fibreflow.app) | ✅ 200 |
| Cloudflared Tunnel | ✅ 4 connections |
| VLM Service | ✅ Active |
| WA Services | ✅ Active |
| Database | ✅ Connected |

## 2. Code Quality
| Check | Count | Status |
|-------|-------|--------|
| console.log | 0 | ✅ |
| Hardcoded URLs | 0 | ✅ |
| Mock data | 0 | ✅ |
| any types | 12 | ⚠️ |
| Empty catch | 0 | ✅ |

## 3. API Endpoints
| Category | Tested | Passed | Failed |
|----------|--------|--------|--------|
| Health | 4 | 4 | 0 |
| CRUD | 45 | 44 | 1 |
| Auth | 5 | 5 | 0 |

## 4. UI/UX
| Check | Status |
|-------|--------|
| Dark theme | ✅ |
| Currency format | ✅ |
| Toast notifications | ✅ |
| Status badges | ✅ |

## 5. Modules
| Module | Pages | Passed | Issues |
|--------|-------|--------|--------|
| Activate | 5 | 5 | 0 |
| Procurement | 21 | 20 | 1 |
| Fleet | 16 | 16 | 0 |
| ... | ... | ... | ... |

## 6. Console/Network
| Page | Console Errors | Failed Requests |
|------|----------------|-----------------|
| /activate | 0 | 0 |
| /procurement | 0 | 0 |
| ... | ... | ... |

## 7. RBAC
| Check | Status |
|-------|--------|
| Tables exist (3) | ✅/❌ |
| Permissions seeded | ✅ 14 modules, 50+ pages |
| Roles configured (6) | ✅/❌ |
| Super admin has 'all' | ✅/❌ |
| Access Control UI | ✅/❌ |

---

## Issues Found
1. **[CRITICAL]** [Description] - File:line
2. **[WARNING]** [Description] - File:line

---

## Verdict
[ ] ✅ READY FOR PRODUCTION
[ ] ⚠️ NEEDS FIXES (X critical, Y warnings)
[ ] ❌ BLOCKED (critical failures)

---

## Sign-off
- Auditor: Claude Code
- Date: YYYY-MM-DD
```

---

## MODULE-SPECIFIC AUDITS

For detailed module testing protocols, see:
- `.claude/skills/final-audit/SKILL.md` - Comprehensive test cases per module

---

## Related Commands

| Command | Purpose |
|---------|---------|
| `/audit-rbac` | Deep RBAC system audit |
| `/infra` | Infrastructure management |
| `/deploy` | Deploy to environments |
| `/status` | Quick project status |
| `/e2e` | End-to-end test runner |

---

## Last Audit Results

| Date | Scope | Issues | Fixed | Status |
|------|-------|--------|-------|--------|
| 2026-01-23 | RBAC | System configured | ✅ | PASS |
| 2026-01-22 | Procurement | BOQ stale counts | ✅ | PASS |
| 2026-01-22 | Global UI | Dark theme verified | ✅ | PASS |
| 2026-01-19 | Full System | Sidebar dead links | ✅ | PASS |
