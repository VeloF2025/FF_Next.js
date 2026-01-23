# Product Requirements Document: DR Photo Review Unified System

**Document Version:** 1.0
**Date:** January 14, 2026
**Project:** FibreFlow - DR Photo Review Services Consolidation
**Status:** Draft - Awaiting Approval

---

## 📋 Executive Summary

### Problem Statement
FibreFlow currently operates three separate DR (Drop Record) photo review services that require users to manually switch between applications to complete a single review workflow. This fragmentation causes:
- **Context switching fatigue** - Users must navigate between 3 different UIs
- **Workflow inefficiency** - 5+ minutes to complete what should be a 30-second task
- **Data fragmentation** - Manual QA data, AI evaluation results, and photo metadata stored in 3 separate systems
- **User frustration** - Duplicate data entry and manual coordination between services

### Current State

**Three Fragmented Services:**

1. **Port 8003 HTML App** (http://100.96.203.105:8003/)
   - FastAPI Python service for photo downloads from OneMap GIS API
   - Manual DR entry and photo download trigger
   - 11-step filename-based photo organization
   - WebSocket real-time updates

2. **WA Monitor** (https://vf.fibreflow.app/wa-monitor)
   - Next.js module for WhatsApp message monitoring
   - 12-step manual QA checklist
   - Lock/unlock system for concurrent editing
   - Manual feedback generation and WhatsApp delivery

3. **Foto Review** (https://vf.fibreflow.app/foto-review)
   - Next.js module for AI-powered photo evaluation
   - 10-step automated assessment using MiniCPM-V-2_6 VLM
   - Separate AI evaluation results storage

**Manual Workflow (Current):**
```
WhatsApp message arrives
    ↓
User opens WA Monitor → sees new DR
    ↓
User opens port 8003 → pastes DR → downloads photos from OneMap
    ↓
User returns to WA Monitor → manual review → generate feedback
    ↓
User opens Foto Review → separate AI evaluation
    ↓
User returns to WA Monitor → send feedback to WhatsApp
```

### Proposed Solution

**Single Unified Application** that consolidates all three services into one seamless workflow:

```
WhatsApp message arrives
    ↓
Auto-download photos from OneMap (with fallback to BOSS API/Local)
    ↓
Single unified UI: Manual QA + AI Evaluation side-by-side
    ↓
One-click feedback generation and WhatsApp delivery
```

**Key Benefits:**
- ✅ Zero context switching (1 app instead of 3)
- ✅ Automated photo download (no manual paste/trigger)
- ✅ Combined manual + AI review in single view
- ✅ < 30 seconds to complete review (vs 5+ minutes)
- ✅ Unified database (single source of truth)

---

## 🎯 Goals & Success Metrics

### Business Goals

1. **Increase Review Efficiency**
   - Target: Reduce review time from 5+ minutes to < 30 seconds
   - Measurement: Average time from WhatsApp message arrival to feedback sent

2. **Reduce User Friction**
   - Target: Zero context switches between applications
   - Measurement: Number of different UIs accessed per review

3. **Improve Data Consistency**
   - Target: Single source of truth for all review data
   - Measurement: Zero data synchronization errors

4. **Enable Microservice Extraction**
   - Target: Maintain WA Monitor isolation for future service separation
   - Measurement: Module can be deployed independently

### Success Metrics

**Primary (Efficiency):**
- ✅ < 30 seconds to complete full DR review (baseline: 5+ minutes)
- ✅ Zero context switches (baseline: 3 apps)
- ✅ 100% photo fetch success rate (multi-source fallback)

**Secondary (Quality):**
- ✅ 90%+ agreement between manual and AI evaluation
- ✅ < 10% manual override rate on AI suggestions
- ✅ Zero data loss during migration

**Tertiary (Adoption):**
- ✅ 80%+ user satisfaction (post-deployment survey)
- ✅ 100% user adoption within 2 weeks (Velo Test project)
- ✅ < 5% rollback requests

---

## 👥 User Personas

### Primary User: Field QA Reviewer (Sarah)
- **Role:** Quality Assurance Reviewer for fiber installations
- **Current Pain:** Switches between 3 apps to complete one review
- **Needs:** Fast, efficient review workflow with clear pass/fail criteria
- **Technical Skill:** Medium (comfortable with web apps, not technical)
- **Daily Volume:** 20-50 DR reviews per day
- **Key Frustration:** "I spend more time switching apps than actually reviewing photos"

### Secondary User: Project Manager (David)
- **Role:** Oversees multiple fiber installation projects
- **Current Pain:** No unified view of review status across projects
- **Needs:** Dashboard view of review metrics and team performance
- **Technical Skill:** Low (primarily uses dashboards and reports)
- **Daily Volume:** Reviews 5-10 summary reports
- **Key Frustration:** "I can't easily see which DRs are pending review"

### Tertiary User: System Administrator (Louis)
- **Role:** Maintains FibreFlow infrastructure
- **Current Pain:** Three separate systems to maintain and troubleshoot
- **Needs:** Reliable, maintainable system with clear logging
- **Technical Skill:** High (full-stack developer)
- **Daily Volume:** Deploys updates, troubleshoots issues
- **Key Frustration:** "Managing three separate services is overhead"

---

## 🏗️ Architecture Overview

### High-Level Architecture

**Pattern:** Orchestration Layer (new module coordinates existing microservices)

```
┌──────────────────────────────────────────────────────────┐
│  src/modules/activate/  (NEW ORCHESTRATION)     │
│  ────────────────────────────────────────────────────────│
│  • UnifiedReviewCard.tsx (manual + AI combined)         │
│  • unifiedPhotoService.ts (multi-source coordination)    │
│  • unifiedVlmService.ts (AI evaluation)                  │
│  • dr_photo_unified_reviews table (consolidated data)    │
└──────────────────────────────────────────────────────────┘
           │                │                  │
           ▼                ▼                  ▼
  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │ Port 8003    │  │ BOSS VPS API │  │ WA Monitor   │
  │ (OneMap GIS) │  │ (Proxy)      │  │ (WhatsApp)   │
  │ KEEP AS-IS   │  │ KEEP AS-IS   │  │ ENHANCE      │
  └──────────────┘  └──────────────┘  └──────────────┘
```

### Key Architectural Decisions

**Decision 1: Keep Port 8003 as Microservice**
- **Rationale:** Proven OneMap GIS integration, rewrite would take 2-3 weeks with high risk
- **Alternative Considered:** Rewrite in Next.js (rejected due to timeline and risk)
- **Trade-off:** Maintain two tech stacks (Python FastAPI + Next.js) vs. faster delivery

**Decision 2: Multi-Source Photo Fetching**
- **Primary Source:** OneMap GIS API (via port 8003) - Most authoritative
- **Fallback 1:** BOSS VPS API (port 8001) - Backup/proxy
- **Fallback 2:** Local Filesystem Cache - Offline resilience
- **Rationale:** Ensures 100% photo availability even if OneMap is down

**Decision 3: 12-Step Standardization**
- **Baseline:** WA Monitor's 12-step checklist (most comprehensive)
- **Mapping:** Bidirectional mapping to port 8003 (11 types) and Foto Review (10 steps)
- **Rationale:** Maintains existing WA Monitor workflows while enabling harmonization

**Decision 4: Database Consolidation**
- **New Table:** `dr_photo_unified_reviews`
- **Migration Strategy:** Merge data from 3 sources (qa_photo_reviews, foto_ai_reviews, port 8003)
- **Backward Compatibility:** Create views for old table access during transition

**Decision 5: Gradual Rollout**
- **Phase 1:** Velo Test project only (1 week)
- **Phase 2:** Expand to Lawley, Mohadin, Mamelodi (1 week)
- **Phase 3:** Full rollout + deprecate old services (1 week)
- **Rationale:** Minimize risk, gather feedback, allow rollback if needed

---

## ✨ Features & Requirements

### Feature 1: Unified Review Dashboard

**User Story:**
> As a QA Reviewer, I want to see all DR reviews in one place so that I don't need to switch between multiple apps.

**Acceptance Criteria:**
- [ ] Dashboard shows all DRs from WhatsApp groups (Lawley, Mohadin, Velo Test, Mamelodi)
- [ ] Filter by project, date range, review status (pending, in-progress, completed)
- [ ] Search by DR number
- [ ] Sort by creation date, project, review status
- [ ] Click DR to open unified review card

**UI Mockup:**
```
┌─────────────────────────────────────────────────────────────┐
│ DR Photo Reviews                          [+ New Review]    │
├─────────────────────────────────────────────────────────────┤
│ Filters: [All Projects ▼] [All Status ▼] [Search DR...]    │
├─────────────────────────────────────────────────────────────┤
│ DR Number    Project    Photos  Review Status  Created      │
│ DR1730550    Lawley     16      Completed      Jan 14, 2026 │
│ DR1730551    Mohadin    12      Pending        Jan 14, 2026 │
│ DR1730552    Velo Test  14      In Progress    Jan 14, 2026 │
└─────────────────────────────────────────────────────────────┘
```

**Priority:** P0 (Must Have)
**Effort:** 3 days

---

### Feature 2: Auto-Download Photos on WhatsApp Message

**User Story:**
> As a QA Reviewer, I want photos to be automatically downloaded when a WhatsApp message arrives so that I don't need to manually paste DR numbers into port 8003.

**Acceptance Criteria:**
- [ ] When WhatsApp message arrives in WA Monitor, system automatically triggers photo download
- [ ] Multi-source fallback strategy (OneMap → BOSS API → Local cache)
- [ ] Download status visible in dashboard (pending, downloading, completed, failed)
- [ ] Retry mechanism for failed downloads (max 3 retries with exponential backoff)
- [ ] Notification to user when download completes or fails

**Technical Requirements:**
- Integrate with WA Monitor webhook system
- Call port 8003 API for OneMap photo fetch
- Fallback to BOSS VPS API if OneMap fails
- Store photos metadata in `dr_photo_unified_reviews.photos_metadata` (JSONB)

**Error Handling:**
- If all sources fail, mark DR as "Photos Unavailable" and allow manual review
- Log all download attempts with timestamps and error details

**Priority:** P0 (Must Have)
**Effort:** 5 days

---

### Feature 3: Unified Review Card (4 Tabs)

**User Story:**
> As a QA Reviewer, I want to see manual QA checklist and AI evaluation in one view so that I can quickly compare and approve/reject.

**Acceptance Criteria:**

**Tab 1: Manual QA**
- [ ] 12-step checklist with checkboxes (step_01 through step_12)
- [ ] Mark incorrect steps with dropdown selector
- [ ] Add comments for each incorrect step
- [ ] ONT serial scanner integration (barcode scan)
- [ ] UPS serial scanner integration (barcode scan)
- [ ] Save button with auto-save every 30 seconds
- [ ] Lock/unlock mechanism (prevent concurrent edits)

**Tab 2: AI Evaluation**
- [ ] "Evaluate with AI" button (triggers VLM evaluation)
- [ ] Loading indicator during evaluation (estimated 2-3 minutes for 16 photos)
- [ ] Overall status badge (PASS/FAIL) with color coding
- [ ] Average score (0-10) with visual progress bar
- [ ] Step-by-step AI results with scores and comments
- [ ] Markdown report with detailed analysis
- [ ] Side-by-side comparison table (Manual vs AI)

**Tab 3: Photos**
- [ ] Photo count badge (e.g., "Photos (16)")
- [ ] Photo source indicator (OneMap, BOSS API, Local)
- [ ] Photos grouped by step (House Photo, Cable from Pole, etc.)
- [ ] Click photo to open lightbox (full-screen view)
- [ ] Zoom, pan controls in lightbox
- [ ] Navigate between photos with arrow keys

**Tab 4: Feedback**
- [ ] "Generate Auto-Feedback" button (uses AI + manual review data)
- [ ] Editable text area with generated feedback
- [ ] "Send to WhatsApp" button
- [ ] Feedback sent badge with timestamp
- [ ] Disable send button after feedback sent (prevent duplicate sends)

**UI Mockup:**
```
┌─────────────────────────────────────────────────────────────┐
│ DR1730550 - Lawley                          [Lock Review]   │
├─────────────────────────────────────────────────────────────┤
│ [Manual QA] [AI Evaluation] [Photos (16)] [Feedback]       │
├─────────────────────────────────────────────────────────────┤
│ Manual QA Tab:                                              │
│ ☑ Step 1: House Photo                                      │
│ ☑ Step 2: Cable from Pole                                  │
│ ☐ Step 3: Cable Entry Outside  [Mark Incorrect ▼]         │
│   └─ Comment: Entry point not clearly visible              │
│ ☑ Step 4: Cable Entry Inside                               │
│ ...                                                         │
│                                                             │
│ ONT Serial: [Scan Barcode] SN123456789                     │
│ UPS Serial: [Scan Barcode] UPS987654321                    │
│                                                             │
│ [Save] [Cancel]                                            │
└─────────────────────────────────────────────────────────────┘
```

**Priority:** P0 (Must Have)
**Effort:** 10 days

---

### Feature 4: Multi-Source Photo Fetching

**User Story:**
> As a System Administrator, I want photo fetching to have fallback sources so that reviews are not blocked when OneMap is unavailable.

**Acceptance Criteria:**
- [ ] Primary: Fetch from OneMap GIS API (via port 8003)
- [ ] Fallback 1: Fetch from BOSS VPS API (port 8001) if OneMap fails
- [ ] Fallback 2: Fetch from local filesystem cache if both APIs fail
- [ ] Log which source was used for each DR
- [ ] Display photo source in UI (badge: "Source: OneMap")
- [ ] Retry failed sources after 5 minutes (background job)

**Technical Requirements:**
```typescript
async function fetchPhotosWithFallback(drNumber: string) {
  try {
    return await fetchFromOneMap(drNumber); // Port 8003
  } catch (error) {
    log.warn(`OneMap failed for ${drNumber}, trying BOSS API`);
  }

  try {
    return await fetchFromBossApi(drNumber); // Port 8001
  } catch (error) {
    log.warn(`BOSS API failed for ${drNumber}, checking local cache`);
  }

  try {
    return await fetchFromLocalCache(drNumber);
  } catch (error) {
    throw new Error('All photo sources unavailable');
  }
}
```

**Priority:** P0 (Must Have)
**Effort:** 3 days

---

### Feature 5: Database Migration & Consolidation

**User Story:**
> As a System Administrator, I want all DR review data consolidated into one table so that there is a single source of truth.

**Acceptance Criteria:**
- [ ] New table `dr_photo_unified_reviews` created with migration 033
- [ ] Migrate data from `qa_photo_reviews` (WA Monitor)
- [ ] Merge data from `foto_ai_reviews` (Foto Review)
- [ ] Merge photo metadata from port 8003 session data
- [ ] Verification script validates data integrity (no data loss)
- [ ] Backward compatibility views for old table access
- [ ] Old tables preserved for 3 months (rollback safety)

**Database Schema:**
```sql
CREATE TABLE dr_photo_unified_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_number VARCHAR(50) UNIQUE NOT NULL,
  project VARCHAR(100),

  -- Photo metadata
  photo_source VARCHAR(50), -- 'onemap', 'boss', 'local'
  photo_count INTEGER DEFAULT 0,
  photos_metadata JSONB DEFAULT '[]',

  -- 12 unified QA steps (BOOLEAN)
  step_01_house_photo BOOLEAN DEFAULT false,
  step_02_cable_from_pole BOOLEAN DEFAULT false,
  -- ... through step_12

  -- Incorrect tracking
  incorrect_steps TEXT[] DEFAULT '{}',
  incorrect_comments JSONB DEFAULT '{}',

  -- AI evaluation results
  ai_evaluation_status VARCHAR(50),
  ai_overall_status VARCHAR(10), -- 'PASS', 'FAIL'
  ai_average_score DECIMAL(3,1),
  ai_step_results JSONB,
  ai_markdown_report TEXT,
  ai_evaluated_at TIMESTAMP WITH TIME ZONE,

  -- Serial scanning
  ont_serial_scanned VARCHAR(100),
  ups_serial_scanned VARCHAR(100),

  -- Locking
  locked_by TEXT,
  locked_at TIMESTAMP WITH TIME ZONE,

  -- WhatsApp feedback
  feedback_sent BOOLEAN DEFAULT false,
  feedback_message TEXT,
  feedback_sent_at TIMESTAMP WITH TIME ZONE,

  -- Metadata
  reviewed_by TEXT,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Priority:** P0 (Must Have)
**Effort:** 5 days

---

### Feature 6: AI Evaluation Integration

**User Story:**
> As a QA Reviewer, I want AI to automatically evaluate photos so that I can focus on edge cases and manual verification.

**Acceptance Criteria:**
- [ ] "Evaluate with AI" button triggers VLM evaluation
- [ ] Use MiniCPM-V-2_6 VLM (existing port 8100 service)
- [ ] Batch processing (6 photos per batch for context limits)
- [ ] Progress indicator (e.g., "Processing batch 2 of 4...")
- [ ] Overall status: PASS (9+ steps pass) or FAIL (< 9 steps pass)
- [ ] Average score: 0-10 based on all step scores
- [ ] Step-by-step results with individual scores and comments
- [ ] Markdown report with detailed analysis
- [ ] Save results to `dr_photo_unified_reviews.ai_*` columns

**Technical Requirements:**
- Reuse existing `fotoVlmService.ts` logic
- Map photos to 12 unified steps using `stepMapper.ts`
- Timeout: 180 seconds (3 minutes) for full evaluation
- Error handling: If VLM fails, show "AI Evaluation Unavailable" message

**Priority:** P1 (Should Have)
**Effort:** 4 days

---

### Feature 7: WhatsApp Feedback Integration

**User Story:**
> As a QA Reviewer, I want to send feedback to WhatsApp groups with one click so that I don't need to manually copy/paste messages.

**Acceptance Criteria:**
- [ ] "Generate Auto-Feedback" button creates feedback from manual + AI review
- [ ] Editable text area allows manual changes before sending
- [ ] "Send to WhatsApp" button delivers message to correct WhatsApp group
- [ ] Feedback sent badge shows timestamp (e.g., "Sent at 2:45 PM")
- [ ] Disable send button after feedback sent (prevent duplicates)
- [ ] Log all feedback sends with DR number, project, timestamp

**Feedback Template:**
```
DR: [DR1730550]
Project: [Lawley]

Manual Review: [PASS/FAIL]
AI Review: [PASS/FAIL]

Incorrect Steps:
- Step 3 (Cable Entry Outside): Entry point not clearly visible
- Step 7 (Power Meter): Reading not visible

Next Steps:
[Auto-generated based on incorrect steps]
```

**Priority:** P1 (Should Have)
**Effort:** 3 days

---

### Feature 8: Step Harmonization & Mapping

**User Story:**
> As a System Administrator, I want step mapping between the three systems so that data from all sources can be unified.

**Acceptance Criteria:**
- [ ] Bidirectional mapping: WA Monitor (12) ↔ Port 8003 (11) ↔ Foto Review (10)
- [ ] Photo type to step mapping (e.g., `ph_prop` → Step 1: House Photo)
- [ ] Step to Foto Review mapping (Step 1 → Foto Step 1, Step 11 → null)
- [ ] Utility functions: `photoTypeToStep()`, `stepToFotoReview()`
- [ ] Documentation of mapping logic in `stepMapper.ts`

**Mapping Table:**

| Unified Step | WA Monitor | Port 8003 Photo Type | Foto Review |
|--------------|-----------|---------------------|-------------|
| 1. House Photo | step_01 | ph_prop, ph_sign1 | Step 1 |
| 2. Cable from Pole | step_02 | ph_pole, ph_cbl_r | Step 2 |
| 3. Cable Entry Outside | step_03 | ph_entry_out, ph_hm_ln | Step 3 |
| 4. Cable Entry Inside | step_04 | ph_entry_in, ph_hm_en | Step 4 |
| 5. Wall for Installation | step_05 | ph_wall | Step 5 |
| 6. ONT Back After Install | step_06 | ph_ont, ph_ont_back | Step 6 |
| 7. Power Meter Reading | step_07 | ph_powm, ph_powm2 | Step 7 |
| 8. ONT Barcode | step_08 | ph_bl, ph_barcode | Step 8 |
| 9. UPS Serial Number | step_09 | ph_ups | Step 9 |
| 10. Final Installation | step_10 | ph_after, ph_final | Step 10 |
| 11. Green Lights on ONT | step_11 | ph_lights, ph_led | - |
| 12. Signature | step_12 | - | - |

**Priority:** P0 (Must Have)
**Effort:** 2 days

---

### Feature 9: Gradual Rollout with Feature Flags

**User Story:**
> As a System Administrator, I want to enable the unified system for one project at a time so that we can test and gather feedback before full rollout.

**Acceptance Criteria:**
- [ ] Feature flag: `ENABLE_UNIFIED_REVIEW` (boolean)
- [ ] Project-level control: Enable for specific projects (e.g., "Velo Test")
- [ ] Conditional routing: If enabled, show UnifiedReviewCard; else show old QaReviewCard
- [ ] Dashboard indicator: Badge shows "New UI" or "Classic UI"
- [ ] Analytics: Track usage metrics (old vs new UI)

**Rollout Schedule:**
- **Week 1:** Velo Test project only
- **Week 2:** Expand to Lawley, Mohadin, Mamelodi
- **Week 3:** Full rollout + deprecate old services

**Priority:** P1 (Should Have)
**Effort:** 1 day

---

### Feature 10: Rollback Mechanism

**User Story:**
> As a System Administrator, I want a quick rollback process in case the unified system has critical bugs.

**Acceptance Criteria:**
- [ ] Feature flag can be disabled instantly (< 1 minute)
- [ ] Old services (port 8003, WA Monitor, Foto Review) remain operational during transition
- [ ] Database backup before migration (Neon snapshot)
- [ ] Rollback script to revert database changes
- [ ] Documentation of rollback steps

**Rollback Steps:**
1. Disable feature flag: `ENABLE_UNIFIED_REVIEW = false`
2. Deploy rollback: `git checkout <previous-commit> && npm run build && pm2 restart`
3. Verify old systems operational
4. (If needed) Restore database from Neon snapshot

**Priority:** P1 (Should Have)
**Effort:** 1 day

---

## 🚫 Non-Goals & Out of Scope

### Explicitly Out of Scope

1. **Port 8003 Rewrite in Next.js**
   - Rationale: Would take 2-3 weeks with high integration risk
   - Alternative: Keep as microservice, integrate via API proxy

2. **Real-Time Collaboration (Multiple Users Editing Same DR)**
   - Rationale: Lock/unlock system sufficient for current workflow
   - Future: Can be added in v2 with WebSocket-based collaboration

3. **Mobile App**
   - Rationale: Current users work on desktop browsers
   - Future: Mobile-responsive web app may be considered in v2

4. **Advanced Analytics Dashboard**
   - Rationale: Focus on core workflow efficiency first
   - Future: Can add analytics in v2 (e.g., review time trends, pass/fail rates)

5. **Multi-Language Support (i18n)**
   - Rationale: All users currently work in English
   - Future: Can add if international expansion occurs

6. **Automated Photo Quality Checks (Blur Detection, etc.)**
   - Rationale: VLM already provides quality assessment
   - Future: Can add specialized checks if needed

---

## 🔧 Technical Specifications

### Tech Stack

**Frontend:**
- Next.js 14+ with App Router
- React 18
- TypeScript
- TailwindCSS
- Shadcn UI components

**Backend:**
- Next.js API Routes (App Router)
- Neon PostgreSQL (serverless)
- Direct SQL queries (no ORM)

**External Services:**
- Port 8003: FastAPI Python service (OneMap GIS integration)
- Port 8001: BOSS VPS API (photo proxy)
- Port 8100: vLLM with MiniCPM-V-2_6 (AI evaluation)
- Ports 8080/8081: WhatsApp Bridge API (message monitoring)

**Authentication:**
- Clerk (existing FibreFlow auth)

**Deployment:**
- Velocity Server (Ubuntu with RTX 5090)
- PM2 process manager
- Dual environment: dev.fibreflow.app (port 3006) + app.fibreflow.app (port 3005)

### API Endpoints

**New Endpoints:**
```
GET  /api/activate/review/[dropNumber]  # Get unified review
POST /api/activate/review/[dropNumber]  # Create/update review
POST /api/activate/fetch-photos         # Trigger photo download
POST /api/activate/evaluate             # Trigger AI evaluation
POST /api/activate/send-feedback        # Send WhatsApp feedback
GET  /api/activate/reviews              # List all reviews (with filters)
```

**External API Integration:**
```
Port 8003: GET /api/download-photos?dr={drNumber}  # OneMap photo download
Port 8001: GET /api/photos                          # BOSS VPS photo list
Port 8001: GET /api/photo/{dr}/{filename}           # BOSS VPS photo fetch
Port 8100: POST /v1/chat/completions                # VLM evaluation
Port 8080: POST /send-message                        # WhatsApp send
```

### Database Schema

See Feature 5 for complete schema.

**Key Tables:**
- `dr_photo_unified_reviews` (new) - Unified review data
- `qa_photo_reviews` (existing) - WA Monitor data (kept for 3 months)
- `foto_ai_reviews` (existing) - Foto Review data (kept for 3 months)

**Migration Strategy:**
- Migration 033: Create new unified table
- Data migration script: Merge data from 3 sources
- Verification script: Validate data integrity (zero data loss)
- Backward compatibility views: Enable old API routes to work during transition

### Performance Requirements

**Response Times:**
- Dashboard load: < 2 seconds
- Photo download: < 10 seconds (16 photos from OneMap)
- AI evaluation: < 3 minutes (16 photos, 3 batches)
- Feedback send: < 2 seconds

**Availability:**
- Uptime: 99.5% (allows ~3.6 hours downtime per month)
- Photo fetch success: 100% (via multi-source fallback)
- Data consistency: 100% (zero data loss)

**Scalability:**
- Support 50 concurrent users
- Handle 100 DR reviews per day
- Store 10,000 DR records (12 months)

---

## 🧪 Testing Requirements

### Unit Tests

**Services:**
- `unifiedPhotoService.ts`: Multi-source fallback logic
- `stepMapper.ts`: Step harmonization mapping
- `unifiedVlmService.ts`: AI evaluation logic
- `unifiedDbService.ts`: Database operations

**Components:**
- `UnifiedReviewCard.tsx`: Tab switching, form validation
- `PhotoGalleryUnified.tsx`: Photo grouping, lightbox
- `ComparisonTable.tsx`: Manual vs AI comparison

**Coverage Target:** 80% code coverage

### Integration Tests

**API Routes:**
- `POST /api/activate/fetch-photos`: Test OneMap → BOSS → Local fallback
- `POST /api/activate/evaluate`: Test VLM integration
- `POST /api/activate/send-feedback`: Test WhatsApp delivery

**Database:**
- Migration script: Verify data integrity (0 data loss)
- Backward compatibility views: Verify old APIs still work

**Coverage Target:** 90% API route coverage

### End-to-End Tests (Playwright)

**Critical User Flows:**

1. **Complete Review Workflow**
   ```
   WhatsApp message arrives
   → Auto-download photos
   → Manual QA checklist
   → AI evaluation
   → Send feedback
   → Verify feedback received
   ```

2. **Photo Fetch Fallback**
   ```
   Simulate OneMap API down
   → Verify fallback to BOSS API
   → Verify photos loaded successfully
   ```

3. **Concurrent Edit Prevention**
   ```
   User A locks DR review
   → User B sees "Locked by User A" message
   → User A unlocks review
   → User B can now edit
   ```

**Coverage Target:** 100% critical paths

### User Acceptance Testing (UAT)

**Test Group:** 5 QA Reviewers from Velo Test project

**Duration:** 1 week

**Scenarios:**
1. Complete 10 DR reviews using unified system
2. Compare time vs. old 3-app workflow
3. Report any bugs, UX friction, or missing features
4. Complete user satisfaction survey (1-10 scale)

**Success Criteria:**
- 80%+ user satisfaction score
- < 5 critical bugs reported
- No data loss incidents

---

## 📅 Implementation Timeline

### Phase 1: Foundation & Database (Week 1)

**Deliverables:**
- Create `src/modules/activate/` module structure
- Run migration 033 (dr_photo_unified_reviews table)
- Build `unifiedPhotoService.ts` (multi-source fetching)
- Build `stepMapper.ts` (12-step harmonization)

**Effort:** 5 days

---

### Phase 2: Data Migration & Reconciliation (Week 2)

**Deliverables:**
- Migration script: Populate unified table from 3 sources
- Verification script: Validate data integrity (0 data loss)
- Backward compatibility views for old APIs
- Reconciliation script: Compare old vs new systems

**Effort:** 5 days

---

### Phase 3: UI Components (Week 3)

**Deliverables:**
- `UnifiedReviewCard.tsx` (4 tabs: QA, AI, Photos, Feedback)
- `PhotoGalleryUnified.tsx` (step-grouped photo viewer)
- `ComparisonTable.tsx` (manual vs AI side-by-side)
- Dashboard integration

**Effort:** 5 days

---

### Phase 4: API Endpoints & AI Integration (Week 4)

**Deliverables:**
- `/api/activate/fetch-photos` endpoint
- `/api/activate/review/[dropNumber]` CRUD
- `/api/activate/evaluate` (AI evaluation)
- `/api/activate/send-feedback` (WhatsApp)
- VLM integration with unified service

**Effort:** 5 days

---

### Phase 5: Parallel Operation & Testing (Week 5)

**Deliverables:**
- Run old and new systems in parallel
- Compare outputs for consistency
- E2E tests (Playwright)
- UAT with Velo Test users

**Effort:** 5 days

---

### Phase 6: Gradual Rollout & Deprecation (Week 6)

**Deliverables:**
- ✅ Enable for Velo Test (Week 6.1) - COMPLETED
- ✅ Expand to Lawley, Mohadin, Mamelodi (Week 6.3) - COMPLETED
- ✅ Full rollout to all projects (Week 6.4) - COMPLETED
- ⏳ Deprecate old services - IN PROGRESS
- ⏳ Keep port 8003 as backup for 2 weeks - PENDING

**Effort:** 5 days

**Week 6.1 Progress (COMPLETED):**
- ✅ Feature flag system implemented (`src/lib/featureFlags.ts`)
- ✅ Project-based conditional rendering in WaMonitorDashboard
- ✅ Unified system enabled for "Velo Test" project only
- ✅ Monitoring dashboard created (`/activate/monitoring`)
- ✅ Rollout progression script (`scripts/activate/progress-rollout.ts`)
- ✅ Committed: 7a436de6 - Phase 6 Week 6.1 pilot rollout

**Week 6.3 Progress (COMPLETED):**
- ✅ Updated feature flags to include all projects
- ✅ Enabled projects: Velo Test, Lawley, Mohadin, Mamelodi
- ✅ Rollout stage: 'partial' (4/4 main projects)
- ✅ Committed: ce852372 - Phase 6 Week 6.3 expansion

**Week 6.4 Progress (COMPLETED):**
- ✅ Full rollout to all projects (enabledProjects: [])
- ✅ Rollout stage: 'full'
- ✅ Feature flag now enables unified review for ALL projects
- ⏳ Mark old services as deprecated - IN PROGRESS
- ⏳ Schedule port 8003 shutdown (2 week backup period) - PENDING
- ⏳ Monitor for issues across all projects - PENDING

---

**Total Timeline:** 6 weeks (30 working days)

**MVP (Core Workflow):** 4 weeks (Phases 1-4)

---

## 🎨 UI/UX Design Guidelines

### Design Principles

1. **Simplicity:** Single view for all review tasks (no context switching)
2. **Speed:** Optimize for keyboard shortcuts and one-click actions
3. **Clarity:** Clear pass/fail indicators with color coding
4. **Feedback:** Real-time progress indicators for long operations
5. **Consistency:** Reuse existing FibreFlow design patterns

### Visual Design

**Color Scheme:**
- Primary: FibreFlow brand blue (#0066CC)
- Success: Green (#10B981) for PASS
- Error: Red (#EF4444) for FAIL
- Warning: Yellow (#F59E0B) for pending/in-progress
- Neutral: Gray (#6B7280) for disabled/inactive

**Typography:**
- Headings: Inter Bold
- Body: Inter Regular
- Code/Data: JetBrains Mono

**Spacing:**
- Use 4px grid system (padding/margin in multiples of 4)
- Tabs: 16px padding
- Cards: 24px padding
- Buttons: 12px vertical, 24px horizontal

### Component Specs

**UnifiedReviewCard:**
- Width: 100% (responsive)
- Max-width: 1200px
- Border radius: 8px
- Shadow: 0 2px 8px rgba(0,0,0,0.1)
- Tabs: Horizontal, sticky header

**Photo Gallery:**
- Grid: 3 columns on desktop, 2 on tablet, 1 on mobile
- Photo size: 250px × 250px (aspect ratio preserved)
- Hover effect: Slight scale (1.05) + shadow
- Lightbox: Full-screen overlay with 90% width/height

**Comparison Table:**
- Columns: Step, Manual Result, AI Result, Difference
- Row height: 48px
- Zebra striping for readability
- Highlight differences in yellow

### Accessibility

**WCAG 2.1 Level AA Compliance:**
- Color contrast: 4.5:1 minimum for text
- Keyboard navigation: All actions accessible via keyboard
- ARIA labels: All interactive elements labeled
- Focus indicators: Visible focus outline (2px blue)
- Screen reader support: Semantic HTML + ARIA

**Keyboard Shortcuts:**
- `Ctrl + S`: Save review
- `Ctrl + E`: Trigger AI evaluation
- `Ctrl + Enter`: Send feedback
- `Esc`: Close lightbox/modal
- `Arrow keys`: Navigate photos in lightbox

---

## 🔒 Security & Privacy

### Data Protection

**Sensitive Data:**
- DR numbers: Not personally identifiable, but project-specific
- Photos: May contain property addresses, contractor faces
- WhatsApp messages: Internal communication, not public

**Access Control:**
- Clerk authentication required for all routes
- Role-based access: QA Reviewers, Project Managers, Admins
- Row-level security: Users can only see DRs for their assigned projects

**Data Storage:**
- Database: Neon PostgreSQL (encrypted at rest)
- Photos: Stored on Velocity Server (encrypted filesystem)
- Backups: Daily Neon snapshots (retained 7 days)

### API Security

**Rate Limiting:**
- 100 requests per minute per user (via Arcjet)
- 1000 requests per hour per IP

**Input Validation:**
- DR number: Alphanumeric, max 50 characters
- Comments: Max 1000 characters, sanitize HTML
- File uploads: Validate MIME type, max 10MB per photo

**Error Handling:**
- Never expose stack traces to users
- Log all errors to server logs
- Generic error messages for users ("Something went wrong")

### Compliance

**GDPR (if applicable):**
- User consent for photo storage
- Right to deletion (delete DR reviews on request)
- Data retention: 12 months, then auto-archive

**Internal Policies:**
- No sharing of DR photos outside FibreFlow system
- WhatsApp messages logged for audit trail
- Admin access logged with timestamps

---

## 📊 Monitoring & Analytics

### Application Monitoring

**Metrics to Track:**
- Average review time (WhatsApp message → feedback sent)
- Photo fetch success rate (by source: OneMap, BOSS, Local)
- AI evaluation completion rate
- Feedback delivery success rate
- Error rate per endpoint

**Tools:**
- Application logs: PM2 logs + custom logger (`@/lib/logger`)
- Performance monitoring: Server-side metrics (response times)
- Error tracking: Log errors to Neon database `error_logs` table

### User Analytics

**User Behavior:**
- Feature adoption: % of users using unified system vs. old system
- Tab usage: Which tabs are most viewed (Manual QA, AI, Photos, Feedback)
- Time spent per tab
- Actions per session (saves, evaluations, feedback sends)

**Business Metrics:**
- DRs reviewed per day (by project, by user)
- Pass/fail rate (manual vs. AI)
- Manual override rate (when users disagree with AI)
- Average photos per DR

**Privacy:**
- No personally identifiable tracking
- Aggregate metrics only (no individual user tracking)
- Opt-out option for analytics

---

## 🚀 Deployment Strategy

### Environments

**Development (dev.fibreflow.app):**
- Branch: `develop`
- Port: 3006
- Database: Neon `hein-dev` branch
- PM2 process: `fibreflow-dev`
- Purpose: Test all changes before production

**Production (app.fibreflow.app):**
- Branch: `master`
- Port: 3005
- Database: Neon `production` branch
- PM2 process: `fibreflow-prod`
- Purpose: Live user-facing application

### Deployment Process

**Standard Workflow:**
1. Create feature branch from `develop`
2. Implement feature + tests
3. Deploy to dev: `ssh louis@100.96.203.105 "cd /var/www/fibreflow-dev && git pull && npm ci && npm run build && pm2 restart fibreflow-dev"`
4. Test on dev.fibreflow.app
5. Merge to `develop` → auto-deploy to dev
6. Get user approval
7. Merge to `master` → auto-deploy to production

**Rollback Process:**
1. SSH to server: `ssh louis@100.96.203.105`
2. Navigate to app: `cd /var/www/fibreflow`
3. Revert commit: `git reset --hard <previous-commit>`
4. Rebuild: `npm ci && npm run build`
5. Restart: `pm2 restart fibreflow-prod`

**Database Migrations:**
- Run migrations on dev first
- Verify data integrity
- Create Neon snapshot before production migration
- Run migration on production
- Verify + test
- Keep snapshot for 7 days (rollback safety)

---

## 📝 Documentation Requirements

### Developer Documentation

**Files to Create:**
1. `docs/DR_PHOTO_UNIFIED_GUIDE.md` - User guide for QA Reviewers
2. `src/modules/activate/README.md` - Technical documentation
3. `docs/DR_PHOTO_MIGRATION_GUIDE.md` - Migration process for admins
4. `docs/API_DR_PHOTO_UNIFIED.md` - API reference

**Content:**
- Architecture diagrams
- Database schema
- API endpoint reference
- Step mapping logic
- Error handling patterns
- Testing instructions

### User Documentation

**Training Materials:**
1. Quick Start Guide (1 page PDF)
2. Video walkthrough (5 minutes)
3. FAQ document
4. Troubleshooting guide

**Content:**
- How to complete a review using unified system
- How to use AI evaluation feature
- How to send feedback to WhatsApp
- Common errors and solutions

### API Documentation

**Swagger/OpenAPI Spec:**
- Generate from API route comments
- Host at `/api/docs` (dev environment)
- Include request/response examples
- Document error codes

---

## ❓ Open Questions & Decisions Needed

### Questions for Stakeholders

1. **Photo Storage Strategy:**
   - Q: Should we archive photos after 12 months to save disk space?
   - Options: A) Keep all photos indefinitely, B) Archive to S3 after 12 months, C) Delete after 24 months
   - Recommendation: B) Archive to S3 after 12 months

2. **AI Evaluation Cost:**
   - Q: Should we limit AI evaluations per user/day to control costs?
   - Options: A) Unlimited, B) 50/day per user, C) 100/day per project
   - Recommendation: C) 100/day per project (sufficient for current volume)

3. **WhatsApp Feedback Format:**
   - Q: Should we include AI evaluation results in WhatsApp feedback?
   - Options: A) Manual only, B) Manual + AI summary, C) Manual + full AI report
   - Recommendation: B) Manual + AI summary (concise but informative)

4. **Old Service Deprecation Timeline:**
   - Q: How long should we keep old services running after full rollout?
   - Options: A) 2 weeks, B) 1 month, C) 3 months
   - Recommendation: A) 2 weeks (sufficient for emergency rollback)

5. **Mobile Responsiveness Priority:**
   - Q: Should unified system work on mobile devices (phones/tablets)?
   - Options: A) Desktop only, B) Tablet support, C) Full mobile support
   - Recommendation: B) Tablet support (reviewers may use iPads in field)

### Technical Decisions Needed

1. **Photo Caching Strategy:**
   - Q: Should we cache photos locally in browser?
   - Options: A) No caching, B) IndexedDB cache (1 hour), C) Service Worker cache (24 hours)
   - Recommendation: B) IndexedDB cache (1 hour) - balance freshness vs. performance

2. **AI Evaluation Timeout:**
   - Q: What should be the max timeout for AI evaluation?
   - Options: A) 2 minutes, B) 3 minutes, C) 5 minutes
   - Recommendation: B) 3 minutes (current performance baseline)

3. **Concurrent Edit Handling:**
   - Q: Should we support real-time collaboration or keep lock/unlock?
   - Options: A) Lock/unlock (current), B) Optimistic locking (last write wins), C) Real-time collaboration
   - Recommendation: A) Lock/unlock (simpler, sufficient for current workflow)

4. **Error Retry Strategy:**
   - Q: How many times should we retry failed photo downloads?
   - Options: A) 1 retry, B) 3 retries, C) 5 retries
   - Recommendation: B) 3 retries with exponential backoff (5s, 15s, 45s)

---

## 📚 Appendix

### Glossary

- **DR (Drop Record):** Unique identifier for fiber installation site
- **OneMap GIS:** Singapore government mapping API (photo source)
- **BOSS VPS API:** FibreFlow internal photo proxy service
- **VLM (Vision Language Model):** AI model for image understanding (MiniCPM-V-2_6)
- **QA (Quality Assurance):** Manual review process for fiber installations
- **WhatsApp Bridge:** API service for WhatsApp message monitoring and sending

### Related Documents

- **BOSS VPS Migration Handover:** `docs/BOSS_VPS_MIGRATION_HANDOVER.md`
- **VLM Integration Summary:** `VLM_INTEGRATION_SUMMARY.md`
- **WA Monitor README:** `src/modules/wa-monitor/README.md`
- **Database Tables Reference:** `docs/DATABASE_TABLES.md`

### References

- Next.js Documentation: https://nextjs.org/docs
- Neon PostgreSQL: https://neon.tech/docs
- MiniCPM-V-2_6: https://github.com/OpenBMB/MiniCPM-V
- Clerk Authentication: https://clerk.dev/docs

---

**Document Status:** Draft
**Next Steps:** Review with stakeholders → Refine requirements → Begin implementation
**Approval Required From:** Louis (Project Owner), QA Team Lead
**Target Approval Date:** January 17, 2026

---

**Change Log:**

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 14, 2026 | AI Assistant (Claude) | Initial draft based on consolidation plan |

