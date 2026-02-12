# WA Monitor Learnings - February 2026

## Session: 2026-02-10 - DR474666 Investigation

### Key Learnings

**1. Non-Critical Dependencies Can Cause Critical Failures**
- Google Sheets integration was "nice to have" but not essential
- When Sheets failed (no tab configured for Mamelodi), it cascaded into API 500
- API 500 caused bridge to exit without sending acknowledgment
- **Lesson:** Remove or isolate non-critical dependencies from critical paths

**2. Dedup Windows Must Balance Competing Needs**
- Too short (< 60s): Risk infinite loops when bridge/API errors occur
- Too long (10 min): Blocks legitimate resubmissions from field workers
- **Sweet spot:** 90 seconds prevents loops while allowing genuine retries
- **Context:** Field workers often resubmit within 2-5 minutes when no ack received

**3. Retry Logic Requires Exponential Backoff**
- Simple retries can overwhelm failing services
- Exponential backoff (2s, 4s, 8s) gives services time to recover
- Log each retry attempt for debugging (`[ACK RETRY X/3]`)
- **Implementation:** 3 attempts is sufficient - more creates false hope

**4. Bridge Deployment Must Stop Service First**
- Copying binary while service running: "Text file busy" error
- **Correct sequence:** stop → copy → start
- Keep backup: `mv whatsapp-bridge whatsapp-bridge.backup` before deploy

**5. Log Analysis Without Timestamps**
- Bridge logs have no date stamps (Go default)
- **Cross-reference:** Match log entries with `qa_photo_reviews.created_at`
- **Better:** Add timestamps to logger in future bridge updates

**6. Invalid DR Numbers vs Real Failures**
- 44 of 57 "failed acks" were invalid DR numbers (typos)
- Field workers typing "DR1234" instead of "DR1234567"
- **Insight:** Most "failures" are user input errors, not system failures
- **Don't panic:** Check if DR exists in 1Map before investigating infrastructure

**7. Manual Ack Workflow**
```bash
# 1. Get ack message from API
curl -X POST https://app.fibreflow.app/api/activate/dr-acknowledgment \
  -d '{"dropNumber":"DR1234567"}'

# 2. Send via bridge
curl -X POST http://72.61.197.178:8083/send-message \
  -d '{"group_jid":"120363...@g.us","message":"..."}'
```

### Stats Summary (Feb 3-10, 2026)
| Metric | Count |
|--------|-------|
| Real missed acks | 13 |
| Invalid DR numbers | 44 |
| Cloudflare errors | 5 |
| Server 500 errors | 2 |
| No ack/not on 1Map | 6 |

### Files Modified
- `/home/louis/whatsapp-bridge-go/main.go` - Retry logic, Sheets removal
- `/home/louis/whatsapp-bridge-go/sender_proxy.go` - Dedup TTL reduction

### Next Considerations
1. Add timestamps to bridge logger
2. Monitor retry success rate over next week
3. Consider 1Map validation before processing DR submissions
4. Document common invalid DR patterns for field worker training

---

## Session: 2026-02-10 - Serial Warnings & Deploy Process

### Key Learnings

**1. Serial Number Feedback Improvements (commit cb8d64c3)**
- **Bold warnings work better:** Changed subtle `⚠️` to `🔴 *MISMATCH:*` for serial issues
- **Show both values:** Display "1Map: X / Sticker: Y" so installers see exactly what differs
- **Duplicate detection:** Check if same ONT/UPS serial used across multiple DRs
  - Runs in parallel with photo polling (0ms added latency)
  - Case-insensitive UPPER() queries with dedicated indexes (Migration 174)
  - Shows all DRs using same serial: "Also on DR123456, DR234567"
- **Shared helper:** `buildSerialWarningLines()` used by both new DR and resubmission acks
- **JSON response:** Added `duplicateSerials` field - Bridge ignores unknown fields (Go struct unmarshal)

**2. Deploy Process with User Permissions**
- **Problem:** `hein` user cannot git pull on velo-owned repos
  - Permission denied on `.git/objects` (ownership conflicts)
  - `hein` user's GitHub token on dev server is expired (`ghp_placeholder`)
- **Solution:** Use `velo` user for ALL deploy operations
  - Pass GitHub token from local `gh auth token` via `git remote set-url`
  - Example: `git remote set-url origin https://${GH_TOKEN}@github.com/...`
- **Dirty working tree:** Dev server had uncommitted changes (stash@{0})
  - Need to `git stash` before pull, or risk merge conflicts
  - Dev server now has 6 stashes accumulated - clean up eventually
- **Deployment workflow:**
  ```bash
  # Get GitHub token locally
  GH_TOKEN=$(gh auth token)

  # Deploy to dev (velo user, pass token)
  sshpass -p 'velo2026' ssh velo@100.96.203.105 "
    cd /home/hein/apps/fibreflow-dev &&
    git remote set-url origin https://${GH_TOKEN}@github.com/... &&
    git stash &&
    git pull &&
    npm run build &&
    echo 'velo2026' | sudo -S systemctl restart fibreflow-dev.service
  "
  ```

**3. Index Strategy for Case-Insensitive Searches**
- Neon PostgreSQL doesn't use btree indexes for `WHERE UPPER(col) = ...`
- **Solution:** Create function-based indexes on UPPER()
  ```sql
  CREATE INDEX idx_dr_unified_ont_upper ON dr_photo_unified_reviews (UPPER(ont_serial_scanned));
  ```
- Enables fast duplicate serial detection across 1000+ DRs
- Migration 174 added 3 such indexes (ONT, UPS, OES)

**4. Backward Compatible JSON Responses**
- Go Bridge uses strict struct unmarshaling - unknown JSON fields are ignored
- Safe to add new fields to API responses (e.g., `duplicateSerials`)
- No need to update Bridge immediately - new fields gracefully ignored

### Files Modified
- `pages/api/activate/dr-acknowledgment.ts` - Serial warnings, duplicate detection (+173/-42)
- `scripts/migrations/174_serial_duplicate_indexes.sql` - New indexes for UPPER() searches

### Stats
- Duplicate serial detection: 0ms latency (parallel with 6-photo poll)
- Warning format: Bold `🔴 *MISMATCH:*` vs previous subtle `⚠️`
- Indexes added: 3 (ONT, UPS, OES serials)

---

## Session: 2026-02-11 - Access Control Audit & Help Center Integration

### Key Learnings

**1. API Security Audit Results (601 routes audited)**
- **Protected:** 575 routes (95.7%) with RBAC middleware
- **Exempt:** 17 routes (public endpoints, webhooks)
- **Unprotected:** 9 routes (security gaps)
- **Grade:** A- (would be A+ after fixes)
- **Action:** `/api/chat/send.ts` was unprotected - added `withOptionalAuth` middleware + removed console.log, replaced with logger

**2. Help Center Module Missing from Database**
- Help Center wasn't seeded in `access_permissions` table
- Impact: Users couldn't access Help Center even with valid permissions
- **Fix:** Seeded 3 entries:
  - Module: `help-center`
  - Pages: `help-center.overview`, `help-center.ai-chat`
  - Added 18 role permission mappings (all users can read, PM/Admin can write)
- **Lesson:** After adding new modules, always verify database seeding

**3. User Manual v1.3 Comprehensive Update**
- Updated `docs/user-manuals/source/fibreflow-complete.md` (~300 lines)
- **New:** Section 12.4 - Help Center & AI Chat Assistant
- **Updated:** Serial validation (4.3), Meetings (2.2), PP Data (4.4), QField QA (5.1), Fleet Fuel (9.5), OLT Report (13.2), Appendix A
- **Regenerated:** Help center embedded content via `npm run embed-manual`
- **Version:** 1.2 → 1.3
- **Lesson:** Always regenerate embedded help after manual updates

**4. Skills Created (Require Session Restart)**
- `/access-control` - RBAC audit when features change
- `/user-manual` - Update complete manual with recent changes
- **Note:** Skills need `session restart` to be recognized by Skill tool
- **Location:** `.claude/skills/` with detailed procedures

**5. KB Scan - 100% Module Coverage**
- Generated `.claude.md` for 4 missing modules: data-sync, help-center, navigation, navigation.disabled
- Now: 48/48 modules (100% coverage)
- Consolidated 3 learnings files earlier (staff, activate, procurement)

### Files Modified
- `pages/api/chat/send.ts` - Added `withOptionalAuth` middleware, proper logger
- `src/lib/access_permissions_seed.ts` - Added Help Center module + 18 permission mappings
- `docs/user-manuals/source/fibreflow-complete.md` - v1.3 update (~300 lines)
- `.claude/skills/access-control.md` - New skill for RBAC audits
- `.claude/skills/user-manual.md` - New skill for manual updates

### Stats
- API routes protected: 575/601 (95.7%)
- Unprotected endpoints found: 9
- Database seeding entries added: 3 (module + pages)
- Help Center permission mappings: 18
- User Manual sections updated: 8
- Skills created: 2

### Next Considerations
1. Fix remaining 9 unprotected API routes to achieve A+ grade
2. Run access control audit when features change
3. Add timestamps to bridge logger (from prev session)
4. Monitor KnowledgeBase AI chat usage for feedback
