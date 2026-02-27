# Phase 1 Quick Reference — One-Page Execution Cheat Sheet

**For:** Flow (executor) | **When:** Saturday morning or whenever BOQ merges  
**Duration:** ~30 min per batch (includes tests + monitoring)

---

## Pre-Deployment (Do Once)

```bash
cd /home/velo/fibreflow-production

# 1. Run pre-flight
bash scripts/phase1-preflight.sh
# Expected: ✓ All checks passing

# 2. Check out feature branch
git checkout flow/phase1-error-standardization

# 3. Verify local tests pass
npm test -- tests/phase1-error-migration/batch-1 --run
# Expected: All tests passing
```

---

## Per-Batch Deployment (Repeat for Each Batch)

### Step 1: Analyze (2 min)
```bash
# For Batch 1 (validate.ts)
bash scripts/phase1-batch-migrate.sh pages/api/project-import/validate.ts

# Output tells you: error count, line numbers, test path
# Expected: 1 error at line 49
```

### Step 2: Create Test (3 min)
```bash
# Only if test file doesn't exist
mkdir -p tests/phase1-error-migration/project-import
cp tests/phase1-error-migration/templates/endpoint.test.template.ts \
   tests/phase1-error-migration/project-import/validate.test.ts

# Edit with endpoint-specific cases (or use template as-is for MVP)
```

### Step 3: Test Locally (5 min)
```bash
npm test -- tests/phase1-error-migration/project-import/validate.test.ts --run
# Expected: Tests passing
```

### Step 4: Migrate Code (5 min)
```bash
# Edit: pages/api/project-import/validate.ts
# Find: res.status(405).json({ error: 'Method not allowed' })
# Replace: apiResponse.methodNotAllowed(res, 'PUT', ['PUT'])

# Line number from analyze step above (line 49)
```

### Step 5: Retest & Commit (5 min)
```bash
npm test -- tests/phase1-error-migration/project-import/validate.test.ts --run
git add pages/api/project-import/validate.ts tests/phase1-error-migration/project-import/
git commit -m "feat(api/project-import): Phase 1 error standardization — Batch N

Migrate X endpoints to standardized {success, error, meta} format.
- Replace inline errors with apiResponse helpers
- Tests: Y passing"
```

### Step 6: Staging Deploy (5 min)
```bash
# Copy to staging
cp pages/api/project-import/*.ts /home/velo/fibreflow-staging/pages/api/project-import/

cd /home/velo/fibreflow-staging
git add pages/api/project-import/
git commit -m "Phase 1 Batch N: project-import"

# Build
npm run build
# Expected: No errors, BUILD_ID generated

# Restart
lsof -i :3006 -t | xargs kill -9 2>/dev/null || true
sleep 2
NODE_OPTIONS=--max-old-space-size=4096 node_modules/.bin/next start -p 3006 &
sleep 6
```

### Step 7: Validate & Monitor (5 min)
```bash
# Health check
curl -sf http://localhost:3006/api/health | jq '.status'
# Expected: healthy

# Monitor for 5 min
bash scripts/phase1-monitor.sh 3006 1
# Expected: All checks passing

# Format validation (optional)
bash scripts/phase1-error-format-validator.sh 3006
# Expected: Standardized format responses
```

### Step 8: Notify Pixel (1 min)
```
Message to Pixel (via MC):

Phase 1 Batch N deployed to staging.
Commit SHA: <sha from git log -1 --oneline>
Endpoints: <list files changed>
Ready for regression testing.
```

### Step 9: Wait for Pixel Approval (15–30 min)
- Pixel runs 4-point regression
- Expected: "✅ ACK: Regression passing, ready for dev"

### Step 10: Dev Deploy (5 min) — After Pixel Approval
```bash
# Same as staging, but /home/velo/fibreflow-dev, port 3005
cp pages/api/... /home/velo/fibreflow-dev/pages/api/
cd /home/velo/fibreflow-dev
git add ...
git commit -m "..."
npm run build
lsof -i :3005 -t | xargs kill -9 || true
sleep 2
NODE_OPTIONS=--max-old-space-size=4096 node_modules/.bin/next start -p 3005 &
sleep 6

# Verify
curl -sf http://localhost:3005/api/health | jq '.status'
bash scripts/phase1-monitor.sh 3005 N
```

---

## Batch-Specific Commands

### Batch 1: validate.ts (1 file, 1 error)
```bash
bash scripts/phase1-batch-migrate.sh pages/api/project-import/validate.ts
# Line 49: res.status(405).json({ error: ... })
# Replace: apiResponse.methodNotAllowed(res, 'PUT', ['PUT'])
```

### Batch 2: index.ts + status.ts (2 files, 2 errors)
```bash
bash scripts/phase1-batch-migrate.sh pages/api/project-import/index.ts
# Line 42: res.status(405).json({ error: ... })
# Replace: apiResponse.methodNotAllowed(res, 'POST', ['POST'])

bash scripts/phase1-batch-migrate.sh pages/api/project-import/status.ts
# Line 20: res.status(405).json({ error: ... })
# Replace: apiResponse.methodNotAllowed(res, 'GET', ['GET'])
```

---

## Troubleshooting Quick Reference

| Issue | Fix |
|-------|-----|
| Tests fail after migration | Check apiResponse import; verify exact line/text replacement |
| Build fails on staging | Check syntax; run `npm run build` locally first |
| Health check fails | Service may need 10+ seconds to start; wait longer |
| Pixel reports breaking change | Revert batch commit; check error format matches reference |
| Deploy hangs | Check memory; may need `kill -9` on old process |

---

## Documentation Quick Links

| Need | File |
|------|------|
| Full execution guide | `PHASE1_DEPLOYMENT_CHECKLIST.md` |
| Batch 1 detailed walkthrough | `PHASE1_DAY1_QUICKSTART.md` |
| Batch 2 detailed walkthrough | `PHASE1_BATCH2_MIGRATION_GUIDE.md` |
| Scope + timeline | `PHASE1_EXECUTION_STATUS.md` |
| Error format reference | `docs/ERROR_HANDLING_PATTERNS.md` |
| Issues/rollback | `PHASE1_CONTINGENCY_PLAN.md` |

---

## Time Breakdown (Per Batch)

| Task | Minutes |
|------|---------|
| Analyze | 2 |
| Create test | 3 |
| Test locally | 5 |
| Migrate code | 5 |
| Commit | 5 |
| Staging deploy | 5 |
| Monitor | 5 |
| Notify Pixel | 1 |
| Wait for Pixel | 15–30 |
| Dev deploy | 5 |
| **Total** | **51–66 min per batch** |

---

## Batch Sequence

```
[BOQ merges]
       ↓
[Batch 1: validate.ts] ← 1–2 hours
       ↓ (after Pixel approval)
[Batch 2: index.ts + status.ts] ← 30 min
       ↓ (after Pixel approval)
[Committee decision on Phase 2]
```

---

## Final Checks Before Starting

- [ ] BOQ merged to master? (external gate)
- [ ] Feature branch updated? `git pull origin flow/phase1-error-standardization`
- [ ] All scripts executable? `ls -l scripts/phase1-*.sh`
- [ ] Tests directory exists? `ls -d tests/phase1-error-migration/`
- [ ] You have MC access? (notify Pixel)

---

## Success Criteria

- ✅ All tests passing (local + staging)
- ✅ Staging health check: 200 OK
- ✅ Monitor runs 5 min with no timeouts
- ✅ Pixel regression: passing
- ✅ Dev deploy successful
- ✅ Zero production incidents

---

**Prepared:** 2026-02-27  
**Status:** Ready to execute  
**Owner:** Flow  
**Approver:** Elon (BOQ merge gate) → Pixel (regression gate)

---

**Key principle:** Follow the checklist. Automate validation. Move fast. Keep Pixel in the loop.
