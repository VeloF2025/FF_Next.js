# Dev Queue Auto Dev Feature - Complete

**Status**: ✅ Production Ready (Hybrid Mode)
**Date**: 2026-01-22
**Staging URL**: https://vf.fibreflow.app/dev-queue

## Overview

The Dev Queue page now has a complete automation pipeline that connects user feature requests to the agent harness for automated development.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        WISHLIST BOARD                                │
│  Backlog → Under Review → Approved → In Progress → Testing → Done   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ Item moved to "Approved"
                              │ (with XS/S/M effort estimate)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     MVP PIPELINE TRIGGER                             │
│  1. Create GitHub Issue (VelocityFibre/mvp-builds)                  │
│  2. Update DB: github_issue_url, build_status = "pending"           │
│  3. POST to Harness Trigger Service                                  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│               HARNESS TRIGGER SERVICE (VF Server:8096)               │
│  1. Generate spec file from dev-queue item details                   │
│  2. Queue build (in-memory)                                          │
│  3. Send email notification to ai@velocityfibre.co.za               │
│  4. [FUTURE] Auto-run harness with ANTHROPIC_API_KEY                │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     MANUAL BUILD (Current)                           │
│  Developer receives email → Runs: claude "Build {run_id}"           │
│  Uses Claude Code Max plan (no additional API costs)                │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PROGRESS WEBHOOK                                  │
│  POST /api/dev-queue/{id}/progress                                   │
│  Updates: build_status, build_progress, github_pr_url               │
└─────────────────────────────────────────────────────────────────────┘
```

## Work Types

| Type | Emoji | Harness Approach | Features |
|------|-------|------------------|----------|
| `feature` | ✨ | Full harness build | 50-100 |
| `fix` | 🐛 | Quick fix | 5-15 |
| `amendment` | 📝 | Targeted change | 10-30 |
| `refactor` | 🔧 | Code improvement | 20-40 |

## Components Built

### 1. Database
- **Migration**: `scripts/migrations/add-dev-queue-work-type.sql`
- **New column**: `work_type VARCHAR(20)` with CHECK constraint

### 2. TypeScript Types
- **File**: `src/modules/dev-queue/types/dev-queue.ts`
- **Added**: `Dev QueueWorkType = 'feature' | 'fix' | 'amendment' | 'refactor'`

### 3. UI Components
- **File**: `src/modules/dev-queue/components/AddDev QueueItemModal.tsx`
- **Added**: Work type dropdown selector

### 4. API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/dev-queue` | POST | Create item (includes work_type) |
| `/api/dev-queue/move` | POST | Move item, triggers MVP pipeline |
| `/api/dev-queue/[id]/progress` | POST | Receive build progress updates |

### 5. Harness Trigger Service (VF Server)
- **Location**: `/opt/harness-trigger/`
- **Port**: 8096
- **Endpoints**:
  - `GET /health` - Health check
  - `POST /trigger` - Receive build request
  - `GET /queue` - View queued builds
  - `GET /builds` - View all builds

### 6. Harness Trigger Client
- **File**: `src/modules/dev-queue/services/harnessTrigger.ts`
- **Function**: `triggerHarnessBuild()`

### 7. Spec Generator
- **File**: `/opt/harness-trigger/spec_generator.py`
- **Generates**: Markdown spec files for each work type

## Environment Variables

### FibreFlow Staging (.env.production)
```bash
HARNESS_TRIGGER_URL=http://100.96.203.105:8096
HARNESS_TRIGGER_SECRET=dev-queue-harness-secret-2026
```

### Harness Trigger Service (/opt/harness-trigger/.env)
```bash
HARNESS_PATH=/home/louisdup/Agents/claude/VF/harness
FIBREFLOW_WEBHOOK_URL=https://vf.fibreflow.app/api/dev-queue
HARNESS_TRIGGER_SECRET=dev-queue-harness-secret-2026
ANTHROPIC_API_KEY=                    # Empty = hybrid mode
RESEND_API_KEY=re_YQYSYwyD_...
NOTIFY_EMAIL=ai@velocityfibre.co.za
```

## Current Mode: Hybrid (Recommended for Monitoring)

1. **Item approved** → GitHub issue created automatically
2. **Email notification** → Sent to ai@velocityfibre.co.za
3. **Manual build** → Developer runs `claude "Build {run_id}"`
4. **Progress updates** → Via webhook to FibreFlow

### Benefits of Hybrid Mode
- ✅ Zero additional API costs (uses Claude Code Max plan)
- ✅ Human oversight of each build
- ✅ Ability to review specs before building
- ✅ Learn and refine the process

---

## 🚀 Enabling Full Automation (Future)

To enable **fully autonomous builds** without manual intervention:

### Step 1: Get Anthropic API Key
1. Go to https://console.anthropic.com
2. Create account or sign in
3. Navigate to API Keys
4. Create new key
5. Add billing (pay-per-use)

### Step 2: Add Key to Harness Trigger
```bash
ssh louis@100.96.203.105
sudo nano /opt/harness-trigger/.env

# Add your key:
ANTHROPIC_API_KEY=sk-ant-api03-...

# Restart service
sudo systemctl restart harness-trigger
```

### Step 3: What Changes

With API key configured:
- Builds start **automatically** when items are approved
- No manual intervention required
- Harness runs overnight (4-24 hours depending on complexity)
- Progress updates sent to FibreFlow in real-time
- PR created automatically when complete

### Cost Estimates (Pay-per-use)

| Work Type | Est. Tokens | Est. Cost |
|-----------|-------------|-----------|
| Fix (XS) | 50K-200K | $0.50-2.00 |
| Amendment (S) | 200K-500K | $2.00-5.00 |
| Feature (M) | 500K-2M | $5.00-20.00 |
| Large Feature (L) | 2M-5M | $20.00-50.00 |

### Recommended Approach

1. **Start with Hybrid Mode** (current) - Monitor and refine
2. **Enable auto-builds for small items** - XS/S effort only
3. **Scale up gradually** - As confidence grows
4. **Full automation** - For mature, well-tested specs

---

## Testing Checklist

- [x] Create dev-queue item with work_type
- [x] Move to Approved triggers GitHub issue
- [x] Harness trigger service receives request
- [x] Email notification sent
- [x] Spec file generated
- [x] Progress webhook endpoint works
- [ ] Full harness build (requires API key)
- [ ] PR creation and merge

## GitHub Issues Created (Test)

| # | Title | Type | Status |
|---|-------|------|--------|
| 3 | [E2E Test] Fix button color on dashboard | fix | pending |
| 4 | [Test] WhatsApp notification test | fix | pending |
| 5 | [Test] Email notification test | fix | pending |
| 6 | [Final Test] Complete notification flow | amendment | pending |

## Quick Commands

```bash
# Check harness trigger health
curl http://100.96.203.105:8096/health

# View queued builds
curl http://100.96.203.105:8096/queue

# Check service status
ssh louis@100.96.203.105 'sudo systemctl status harness-trigger'

# View logs
ssh louis@100.96.203.105 'sudo journalctl -u harness-trigger -f'

# Manual build (after receiving email)
claude "Build fix_807faa3b_20260122_130734"
```

## Files Modified/Created

### FibreFlow App
- `scripts/migrations/add-dev-queue-work-type.sql` (new)
- `src/modules/dev-queue/types/dev-queue.ts` (modified)
- `src/modules/dev-queue/components/AddDev QueueItemModal.tsx` (modified)
- `src/modules/dev-queue/services/harnessTrigger.ts` (new)
- `app/api/dev-queue/route.ts` (modified)
- `app/api/dev-queue/move/route.ts` (modified)
- `app/api/dev-queue/[id]/progress/route.ts` (new)
- `.claude/commands/build.md` (new)

### VF Server
- `/opt/harness-trigger/main.py` (new)
- `/opt/harness-trigger/spec_generator.py` (new)
- `/opt/harness-trigger/requirements.txt` (new)
- `/opt/harness-trigger/.env` (new)
- `/etc/systemd/system/harness-trigger.service` (new)

---

*Last updated: 2026-01-22*
