# CLAUDE.md - AI Assistant Context Guide

## Project Overview
**FibreFlow Next.js** - A fiber network project management application
- **Framework**: Next.js 14+ with App Router
- **Auth**: Clerk (fully integrated)
- **Database**: Neon PostgreSQL (direct SQL)
- **Storage**: Firebase Storage (files/images)

## Essential Directory Structure
```
src/
├── modules/           # Modular features (Lego blocks)
│   ├── wa-monitor/    # WhatsApp monitor (fully isolated)
│   ├── dr-photo-unified/ # AI photo review with VLM
│   └── rag/           # Contractor health monitoring
├── components/        # Shared UI (AppLayout is standard)
├── services/          # API services
└── lib/              # Utilities

scripts/           # Build scripts & database tools
SOW/              # Statement of Work import
neon/             # Database configuration
docs/             # Documentation & logs
```

## 🚨 CRITICAL: Database Configuration

**Neon Branching Setup (Jan 2026):**

All environments use branches within the **FF_React** project (sparkling-bar-47287977):

| Environment | Branch | Endpoint | Worktree |
|-------------|--------|----------|----------|
| **Production** | `production` | `ep-dry-night-a9qyh4sj` | `FF_Next.js` (master) |
| **Development** | `hein-dev` | `ep-aged-poetry-a9bbd8e9` | `FF_Next.js-hein` (hein/dev) |

**Connection Strings (Updated Jan 2026):**
```bash
# PRODUCTION (master branch) - REAL CUSTOMER DATA
DATABASE_URL='postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require'

# DEVELOPMENT (hein-dev branch) - SAFE TO EXPERIMENT
DATABASE_URL='postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-aged-poetry-a9bbd8e9.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require'
```

**Sync Dev from Production (reset to fresh data):**
```bash
export NEON_API_KEY="napi_2afbjxk3l7jh71x10log1icm4yycl3n2hqag9wrg1jgvwqg5z955c2tnt0ip4gwx"
npx neonctl branches reset br-summer-brook-a9jlv58r --project-id sparkling-bar-47287977 --parent
```

**Git Worktrees:**
```bash
git worktree list  # See all worktrees
# /home/hein/Workspace/FF_Next.js       [master]      - Production DB
# /home/hein/Workspace/FF_Next.js-hein  [hein/dev]    - Dev DB (branch)
```

- ❌ Never use: `ep-damp-credit-a857vku0` (old/incorrect)
- ❌ Deprecated: `ep-jolly-flower-a8zu8hnz` (separate project, not a branch)

### Two Drop Tables - DO NOT CONFUSE!

**1. `drops` Table** - SOW imports from Excel
- API: `/api/sow/drops`, `/api/sow/fibre`
- Import scripts: `/scripts/sow-import/`

**2. `qa_photo_reviews` Table** - WhatsApp QA data
- API: `/api/wa-monitor-drops`, `/api/wa-monitor-daily-drops`
- Source: WhatsApp groups via server monitor

**Query Examples:**
```sql
-- SOW drops
SELECT * FROM drops WHERE project_id = '...';

-- WhatsApp QA drops
SELECT * FROM qa_photo_reviews WHERE project = 'Lawley';
```

**Documentation:**
- `docs/DATABASE_TABLES.md` - Complete schema reference
- `src/modules/wa-monitor/README.md` - WA Monitor details

## 🚨 Starting the Server

**ALWAYS use production mode locally:**
```bash
npm run build
PORT=3005 npm start
# Access at http://localhost:3005
```

Dev mode now works after removing duplicate routes in src/app/ and src/pages/

## Key Commands
```bash
# Development
npm run build && PORT=3005 npm start  # Local development
npm run lint                          # ESLint
npm run type-check                    # TypeScript checking

# Database
npm run db:migrate                    # Run migrations
npm run db:seed                       # Seed data

# Testing
npm test                             # Vitest
npm run test:e2e                     # Playwright
npm run antihall                     # Validate code references
```

## Development Guidelines

### API Response Standards
Use `apiResponse` helper from `lib/apiResponse.ts`:
```typescript
import { apiResponse } from '@/lib/apiResponse';

return apiResponse.success(res, data);
return apiResponse.notFound(res, 'Resource', id);
return apiResponse.internalError(res, error);
```

### SOW Import Process
After creating a project, import data:
```bash
# Edit script with PROJECT_ID, then:
node scripts/sow-import/import-fibre-louissep15.cjs
node scripts/sow-import/verify-fibre-louissep15.cjs
```

### Coding Standards
- Files < 300 lines, components < 200 lines
- Extract business logic to hooks
- Type organization by module
- Domain-focused services

### API Route Naming
**Consistent dynamic parameters required:**
```bash
# ✅ CORRECT
pages/api/contractors/[contractorId].ts
pages/api/contractors/[contractorId]/documents.ts

# ❌ WRONG - Conflicts
pages/api/contractors/[id].ts
pages/api/contractors/[contractorId]/documents.ts
```

### Page Layouts
```tsx
// Standard layout with sidebar
import { AppLayout } from '@/components/layout';

export default function MyPage() {
  return <AppLayout>{/* content */}</AppLayout>;
}

// Fullscreen without sidebar
FotoReviewPage.getLayout = (page) => page;
```

### ⚠️ Vercel Nested Routes Issue
**Nested dynamic routes fail in production!** Use flattened routes:
```bash
# ❌ FAILS in production
pages/api/contractors/[contractorId]/onboarding/stages.ts

# ✅ WORKS everywhere
pages/api/contractors-onboarding-stages.ts?contractorId={id}
```

## Modular Architecture

Each module in `src/modules/` is self-contained:
```
module-name/
├── types/          # TypeScript interfaces
├── services/       # Business logic & API
├── utils/         # Helpers
├── components/    # UI components
└── hooks/         # Custom hooks
```

**WA Monitor** - Fully isolated module (zero dependencies)
- Can be extracted to microservice
- See: `src/modules/wa-monitor/ISOLATION_GUIDE.md`

## WhatsApp Monitor (WA Monitor)

**Status:** ✅ FULLY ISOLATED MODULE

### Quick Reference
- **Dashboard:** `/wa-monitor`
- **API:** `/api/wa-monitor-*`
- **Table:** `qa_photo_reviews`
- **Services:** `wa-monitor-prod`, `wa-monitor-dev`

### Common Issues & Fixes

**"Send Feedback" button not working:**
```bash
ssh louis@100.96.203.105
systemctl restart whatsapp-bridge-prod
```

**Add new WhatsApp group (5 minutes):**
```bash
ssh louis@100.96.203.105
nano /opt/wa-monitor/prod/config/projects.yaml
# Add group in YAML format
/opt/wa-monitor/prod/restart-monitor.sh  # ✅ Use safe restart
```

**⚠️ CRITICAL: Always use safe restart for production:**
```bash
/opt/wa-monitor/prod/restart-monitor.sh  # ✅ Clears Python cache
# NOT: systemctl restart wa-monitor-prod  # ❌ Keeps stale cache
```

### Monitored Groups
- **Lawley**: 120363418298130331@g.us
- **Mohadin**: 120363421532174586@g.us
- **Velo Test**: 120363421664266245@g.us
- **Mamelodi**: 120363408849234743@g.us

**Full Documentation:**
- `src/modules/wa-monitor/README.md`
- `src/modules/wa-monitor/TROUBLESHOOTING.md`

## DR Photo Unified (AI Photo Review)

**Status:** ✅ ACTIVE MODULE - VLM-powered photo categorization

### Overview
Unified system for DR (Drop Receipt) photo review with AI-powered categorization using Qwen3 VLM running on the Velocity Server.

### Quick Reference
- **Dashboard:** `/dr-photo-unified`
- **Monitoring:** `/dr-photo-unified/monitoring`
- **Review Page:** `/dr-photo-unified/[dropNumber]`
- **API Prefix:** `/api/dr-photo-unified/*`
- **Table:** `foto_ai_reviews`
- **VLM:** Qwen3 via VLLM on 100.96.203.105:8000

### Key Features
1. **AI Categorization:** Qwen3 VLM analyzes photos against 10-step checklist
2. **Tab-Based UI:** DR List tab + Manual Entry tab
3. **System Health Dashboard:** Monitors DB, OneMap, VLM, WhatsApp services
4. **WhatsApp Feedback:** Send review results to project WhatsApp groups
5. **Retry Queue:** Failed categorizations auto-queue for retry

### API Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/dr-photo-unified/health-check` | GET | Service health status |
| `/api/dr-photo-unified/admin/retry-failed` | GET/POST | Manage failed retries |
| `/api/dr-photo-unified/categorize-photos` | POST | Trigger VLM categorization |
| `/api/dr-photo-unified/approve-categorization` | POST | Approve AI results |
| `/api/dr-photo-unified/process-new-dr` | POST | Process new DR from WA |
| `/api/dr-photo-unified/fetch-photos` | GET | Fetch photos for DR |
| `/api/dr-photo-unified/send-feedback` | POST | Send WhatsApp feedback |

### Database Tables
```sql
-- Main review table
CREATE TABLE foto_ai_reviews (
  id UUID PRIMARY KEY,
  dr_number TEXT NOT NULL,
  project TEXT,
  photos JSONB,
  vlm_categorization JSONB,
  vlm_status TEXT DEFAULT 'pending',
  vlm_error TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Migration: scripts/migrations/055_vlm_categorization.sql
```

### VLM Status Values
- `pending` - Awaiting categorization
- `processing` - Currently being analyzed
- `completed` - Successfully categorized
- `failed` - Error occurred (check vlm_error)
- `approved` - Human-approved results

### Key Components
```
src/modules/dr-photo-unified/
├── components/
│   ├── DrListPage.tsx           # Main page with tabs
│   ├── UnifiedReviewCard.tsx    # Individual DR review
│   ├── ManualDREntry.tsx        # Manual DR addition
│   ├── SystemHealthDashboard.tsx # Health monitoring
│   └── AICategorizationTab.tsx  # AI results display
├── services/
│   └── categorizationVlmService.ts # VLM API calls
└── types/
    └── unified.types.ts         # TypeScript interfaces
```

### WhatsApp Integration
**Sender Service:** Port 8081 on 100.96.203.105
```bash
# Check service status
curl http://100.96.203.105:8081/health

# Restart if needed
ssh louis@100.96.203.105
sudo systemctl restart whatsapp-sender
```

**Group Mapping:**
- Lawley: `120363418298130331@g.us`
- Mohadin: `120363421532174586@g.us`
- Velo Test: `120363421664266245@g.us`
- Mamelodi: `120363408849234743@g.us`

### 10-Step Photo Checklist
1. `cable_placement` - Cable correctly placed
2. `splicing_complete` - Splicing work completed
3. `enclosure_sealed` - Enclosure properly sealed
4. `labels_visible` - Labels clearly visible
5. `fiber_protection` - Fiber protection in place
6. `nbn_compliance` - NBN compliance met
7. `documentation` - Documentation complete
8. `site_cleanup` - Site cleaned up
9. `safety_measures` - Safety measures followed
10. `quality_check` - Final quality check passed

### Troubleshooting

**VLM not responding:**
```bash
ssh louis@100.96.203.105
docker ps | grep vllm
docker logs vllm-qwen3
```

**Photos not categorizing:**
1. Check health dashboard: `/dr-photo-unified/monitoring`
2. Review failed queue via admin/retry-failed API
3. Check vlm_error in foto_ai_reviews table

**Routing Issues:**
- Dynamic route `[dropNumber].tsx` may catch static routes
- Always create explicit Pages Router files for static routes (like monitoring.tsx)

**Full Documentation:**
- `/home/hein/Downloads/DR_PHOTO_UNIFIED_WA_INTEGRATION.md`
- `src/modules/dr-photo-unified/README.md`

## Arcjet Security

API protection with rate limiting and bot detection:
- **Location:** `src/lib/arcjet.ts`
- **Levels:** ajStrict (30/min), aj (100/min), ajGenerous (300/min)

```typescript
import { withArcjetProtection, aj } from '@/lib/arcjet';
export default withArcjetProtection(handler, aj);
```

## Deployment Architecture

### 🚀 Velocity Server (New Infrastructure)
**Server Access:**
```bash
ssh louis@100.96.203.105    # via Tailscale (recommended)
ssh louis@192.168.1.150     # via LAN (same network)
# Password: VeloAdmin2025! (or use SSH key)
```

**Server Specs:**
- **GPU:** NVIDIA RTX 5090
- **RAM:** 128GB
- **Storage:** 500GB SSD
- **OS:** Ubuntu Server
- **Tailnet:** velof2025.github

### Dual Environment Setup
| Environment | URL | Branch | Port | PM2 Process |
|------------|-----|--------|------|-------------|
| **Production** | app.fibreflow.app | `master` | 3005 | `fibreflow-prod` |
| **Development** | dev.fibreflow.app | `develop` | 3006 | `fibreflow-dev` |

### Deployment Workflow
1. **Local:** Create feature branch from develop
2. **Dev:** Merge to develop → Deploy to dev.fibreflow.app
3. **Test:** Verify on dev environment
4. **Prod:** Merge to master → Deploy to app.fibreflow.app

### Deployment Commands
```bash
# Deploy to DEV (test first!)
ssh louis@100.96.203.105 \
  "cd /var/www/fibreflow-dev && git pull && npm ci && npm run build && pm2 restart fibreflow-dev"

# Deploy to PRODUCTION (after dev testing)
ssh louis@100.96.203.105 \
  "cd /var/www/fibreflow && git pull && npm ci && npm run build && pm2 restart fibreflow-prod"
```

### Server Quick Reference
```bash
ssh louis@100.96.203.105
pm2 list                          # View processes
pm2 logs fibreflow-prod          # View logs
pm2 restart fibreflow-prod       # Restart production
```

### Additional Services
| Service | Port | URL |
|---------|------|-----|
| **Portainer** | 9443 | https://100.96.203.105:9443 |
| **Grafana** | 3000 | http://100.96.203.105:3000 |
| **Ollama** | 11434 | http://100.96.203.105:11434 |
| **Qdrant** | 6333 | http://100.96.203.105:6333 |

### Rollback Process
```bash
ssh louis@100.96.203.105
cd /var/www/fibreflow
git log --oneline -5
git reset --hard <commit-hash>
npm ci && npm run build
pm2 restart fibreflow-prod
```

## Important Notes

- **Server**: Now hosted on Velocity Server (migrated from old VPS)
- **Migration Complete**: Next.js in production, React/Vite archived
- **Authentication**: Clerk only (Firebase Auth removed)
- **Database**: Direct SQL with Neon serverless client (no ORM)
- **Archive**: `../FF_React_Archive/` has old files for reference
- **Full Server Docs**: `~/VF/server/LOUIS_VELOCITY_SERVER_ACCESS.md`

### Page Development Logging
After changes, update `docs/page-logs/{page-name}.md` with:
- Timestamp (Month DD, YYYY - HH:MM AM/PM)
- Problem description
- Solution with file:line references
- Testing results

### AI Assistant Guidelines
1. Always work on feature branches
2. Deploy to dev.fibreflow.app first
3. Wait for user confirmation before production
4. Document changes in page logs
5. Use antihall validator for code verification
6. Prefer editing existing files over creating new ones

## GitHub Workflow

### Branch Naming
- `feature/<name>` - New features
- `fix/<name>` - Bug fixes
- `refactor/<name>` - Code improvements

### PR Standards
- Title: Conventional commits (feat:, fix:, refactor:)
- Description: What, Why, How
- Always link related issues
- Request review from team member

### Slash Commands
| Command | Description |
|---------|-------------|
| `/pr` | Create PR with FF standards |
| `/review <num>` | Review PR thoroughly |
| `/sync` | Morning status check |
| `/tdd spec <name>` | Create test specification |
| `/tdd validate` | Check TDD compliance |

### CLI Shortcuts (source scripts/gh-workflows.sh)
| Command | Description |
|---------|-------------|
| `ff-sync` | Morning status check |
| `ff-pr` | Create PR |
| `ff-review 123` | Quick review |
| `ff-merge 123` | Approve and merge |
| `ff-team` | See Louis's PRs |
| `ff-feature <name>` | Create feature branch |
| `ff-tdd-check` | Validate TDD compliance |

## TDD Enforcement

### Principle
> "No feature code without test specification first"

### Workflow: Spec → Test → Code
1. **Spec**: Create requirement document or GitHub issue
2. **Test Spec**: Create `tests/specs/<feature>.spec.md`
3. **Tests**: Generate failing tests from spec
4. **Implement**: Write code to make tests pass
5. **Refactor**: Improve code, keep tests green

### Test Structure
```
tests/
├── specs/              # Test specifications (BEFORE code)
│   └── _TEMPLATE.spec.md
├── unit/               # Unit tests
│   └── modules/<module>/
├── integration/        # Integration tests
│   └── api/
└── e2e/                # End-to-end tests
```

### TDD Commands
```bash
/tdd spec "feature-name"     # Create test spec from requirements
/tdd generate specs/x.md     # Generate test skeletons
/tdd validate                # Check compliance before PR
/tdd implement specs/x.md    # Full RED-GREEN-REFACTOR cycle
```

### Enforcement Levels
1. **Reminder**: Hook shows warning when editing src/ without tests
2. **PR Check**: CI validates test coverage
3. **Review**: `/review` checks for TDD compliance

### Exceptions (mark in commit)
```
fix: critical hotfix
[TDD-EXEMPT: Hotfix - tests to follow in #123]
```

## Protocols (PAI Integration)

### Zero Tolerance Quality
- No `console.log` - use `log` from `@/lib/logger`
- No empty catch blocks
- 100% type coverage
- Max 300 lines per file

### NLNH (No Lies, No Hallucinations)
- Say "I don't know" when uncertain
- Use confidence levels: HIGH/MEDIUM/LOW
- Mark code status: `// WORKING:`, `// PARTIAL:`, `// UNTESTED:`

### DGTS (Don't Game The System)
- No fake tests (`expect(true).toBe(true)`)
- No mocked implementations pretending to be real
- Tests must actually test behavior