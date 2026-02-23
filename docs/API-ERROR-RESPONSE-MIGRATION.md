# API Error Response Standardization — Migration Plan

## Decision
**Committee Decision (Feb 23, 2026, 09:30 SAST):** IMPLEMENT API Error Response Standardization

**Technical Lead (Elon):** "Exactly the right tech debt to clear. Frontend pain is real."  
**Ops Lead (Gene):** "Approve with qualifier — API contract change requires staged rollout."  
**Committee Chair (Jarvis):** Confirmed.

---

## Current State (Pain Points)

### Inconsistent Error Response Formats
FibreFlow endpoints currently return mixed error formats:

```typescript
// Format 1: Supplier endpoints (post-Feb 21 fix)
{ success: false, data: null, message: "...", code: "ERROR_CODE" }

// Format 2: Older endpoints
{ error: "...", statusCode: 400, details: {...} }

// Format 3: Pages Router error boundary
{ message: "...", stack: "..." }

// Format 4: Catch-all (no standardization)
{ err: {...}, status: 400 }
```

### Frontend Impact
- Frontend must check multiple response shapes
- Error handling logic duplicated across 20+ components
- Difficult to add global error toasts or retry logic
- Inconsistent user messaging

### Backend Impact
- New developers unsure which format to use
- Copy-paste errors lead to inconsistent formats
- Error codes not standardized across modules
- Audit logging varies (some include user context, some don't)

---

## Target State

### Unified Error Response Format
```typescript
// ALL endpoints return this format
{
  success: false,
  data: null,
  error: "User-facing error message",
  code: "ERROR_CODE",           // Optional: for programmatic handling
  statusCode: 400,               // HTTP status
  timestamp: "2026-02-23T...",  // ISO timestamp
  requestId: "req-uuid-here"     // For tracing
}
```

### Success Format (unchanged, but consistent)
```typescript
{
  success: true,
  data: {...},
  timestamp: "2026-02-23T...",
  requestId: "req-uuid-here"
}
```

### Benefits
- **Frontend:** One error shape to handle, easier to implement global error handling
- **Backend:** Consistent pattern across all endpoints, audit trail built-in
- **Ops:** Traceability with requestId, timestamps for log analysis
- **Dev Experience:** Clear pattern to follow, linter rules can enforce

---

## Staged Rollout Plan (Per Gene)

### Phase 1: Preparation & Testing (Week 1)
**Timeline:** Feb 23-27  
**Owner:** Flow  
**Impact:** Zero (internal changes only)

- [x] Create `@/lib/api-response.ts` with unified response helpers (0f4f8258)
- [ ] Add linter rule to flag old error formats
- [ ] Write integration tests for error cases
- [ ] Create Storybook examples for frontend error states
- [ ] Coordinate with Pixel: impact assessment + component updates needed

**Deliverables:**
- Unified response builder library (done)
- Test suite for error cases
- Frontend impact report from Pixel

### Phase 2: Rollout to Dev (Week 2)
**Timeline:** Mar 1-8  
**Owner:** Flow  
**Impact:** Dev environment only

- [ ] Convert 10-15 endpoint modules to new format (high-volume endpoints first)
- [ ] Test with frontend on dev
- [ ] Gather metrics: error response time, JSON size impact
- [ ] Validate with Pixel on frontend (error toasts, retry logic)

**Metrics to track:**
- Response time (should be identical)
- JSON payload size (might increase due to extra fields)
- Frontend test pass rate

**Rollback plan:** Keep old handlers in place, gradual cut-over

### Phase 3: Rollout to Staging (Week 3)
**Timeline:** Mar 8-15  
**Owner:** Flow (migration) → Forge (deployment)  
**Impact:** Staging APIs

- [ ] Submit CR: Phase 2 batch (10-15 endpoints migrated to staging)
- [ ] Forge deploys Phase 2 batch to staging
- [ ] Capture baseline: `journalctl -u fibreflow-production` error count (for metrics comparison)
- [ ] Monitor error rates, frontend error handling
- [ ] Validation gates:
  - Error rate increase < 5%
  - Malformed response shape < 1%
  - Response time increase < 5ms
  - Frontend error handling working correctly

**Rollback plan:** Maintain old response handlers for 2 weeks if needed

### Phase 4: Rollout to Production (Week 4)
**Timeline:** Mar 15-22  
**Owner:** Forge (deploying)  
**Impact:** Production APIs

- [ ] Submit committee CR: Phase 3 batch ready for production
- [ ] Forge deploys Phase 3 batch to production (10-15 endpoints)
- [ ] Monitor error rates vs staging baseline, frontend error handling
- [ ] Roll out remaining endpoints in 3-4 batches through Mar 31

**Validation gates (per Forge):**
- Error rate increase vs baseline < 5%
- Malformed response shape < 1%
- Response time increase < 5ms
- Frontend error handling working correctly

**Rollback plan:** Maintain old response handlers for 2 weeks post-deploy

---

## Backward Compatibility Strategy

### Option A: New Endpoints Only (Recommended by Gene)
- Create `/api/v2/*` namespace with new response format
- Deprecate old `/api/*` endpoints over 3 months
- Frontend gradually migrates to v2

**Pros:** No breaking changes, gradual migration  
**Cons:** Maintains two implementations, more code

### Option B: Dual Response Headers
- New endpoints return unified format by default
- Old endpoints: add `Accept: application/json; version=legacy` for old format
- Default behavior is new format

**Pros:** Single code path, opt-in legacy  
**Cons:** Still some client negotiation needed

### Recommendation: Option A (v2 endpoints)
Aligns with standard API versioning. Keeps old `/api/*` endpoints stable while `/api/v2/*` uses new format. Three-month deprecation window.

---

## Frontend Coordination (With Pixel)

### Frontend Changes Needed
1. **Error toast component** — show `error` field from response
2. **Retry logic** — use `code` field for programmatic retry decisions
3. **Logging** — include `requestId` in logs for traceability
4. **Loading states** — no change (response format doesn't affect this)

### Timeline
- **Week 1:** Pixel audits all error handling components
- **Week 2:** Pixel updates components for v2 response shape (parallel with Flow Phase 2)
- **Week 3:** Pixel tests on staging, provides feedback

### Test Plan
- Unit tests: error cases for each response code
- Integration tests: error flow end-to-end
- E2E tests: user sees error toast, can retry

---

## Implementation Phases

### Phase 1 Implementation Details

#### Step 1: Create Response Builder Library
```typescript
// lib/api-response.ts
export const successResponse = (data: any, meta?: Meta) => ({
  success: true,
  data,
  timestamp: new Date().toISOString(),
  requestId: generateRequestId(),
  ...meta
});

export const errorResponse = (error: string, code?: string, statusCode = 400) => ({
  success: false,
  data: null,
  error,
  code,
  statusCode,
  timestamp: new Date().toISOString(),
  requestId: generateRequestId()
});
```

#### Step 2: Update API Route Template
```typescript
// All new endpoints follow this pattern
import { successResponse, errorResponse } from '@/lib/api-response';

export async function handler(req: Request) {
  try {
    const result = await doWork();
    return res.status(200).json(successResponse(result));
  } catch (err) {
    return res.status(500).json(errorResponse(
      err.message,
      'INTERNAL_SERVER_ERROR',
      500
    ));
  }
}
```

#### Step 3: Linter Rule
```typescript
// .eslintrc.json
{
  "rules": {
    "no-old-error-format": "warn"
  }
}
// Warns on: { error: "...", statusCode: 400 } pattern
// Suggests: Use errorResponse() helper instead
```

---

## Effort Estimate

| Phase | Task | Effort | Owner |
|-------|------|--------|-------|
| 1 | Response library + tests | 2 days | Flow |
| 1 | Linter rule + docs | 1 day | Flow |
| 1 | Frontend impact assessment | 2 days | Pixel |
| 2 | Migrate 10-15 endpoints to dev | 3 days | Flow |
| 2 | Frontend validation on dev | 2 days | Pixel |
| 3 | Migrate to staging + baseline capture | 2 days | Flow |
| 3 | Staging validation + metrics | 2 days | Forge + Flow |
| 4 | Production rollout (batch 1-4) | 5 days | Forge + Flow |
| 4 | Monitoring + cleanup | 2 days | Flow |

**Total:** ~20 days over 4 weeks (Feb 23 - Mar 31)

---

## Success Metrics

- **Code:** All new endpoints use unified response format
- **Frontend:** Single error handling pattern across app
- **Ops:** All errors include requestId + timestamp
- **Performance:** No response time regression (< 5ms increase)
- **Adoption:** 100% of endpoints migrated by Mar 31

---

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Frontend expects old format | High | Coordinate with Pixel early, parallel development |
| Response size increases | Medium | Monitor JSON size, optimize if needed |
| Deployment rollback needed | High | Maintain old handlers for 2 weeks post-deploy |
| Clients break on format change | High | Use v2 endpoints, deprecation period |

---

## Decision Gates

**Phase 1 Complete:** Feb 27 (EOD)
- [x] Response library ready (0f4f8258)
- [ ] Tests passing
- [ ] Pixel impact assessment done
- [x] Approval from Forge (11:26 AM Mon)

**Phase 2 Ready:** Mar 1
- [ ] Dev endpoint batch complete (10-15 endpoints)
- [ ] Pixel testing on dev
- [ ] Metrics confirm no regression
- [ ] Approval from Flow + Pixel

**Phase 3 Ready:** Mar 8
- [ ] Staging CR submitted (Phase 2 batch)
- [ ] Forge approved, deploy to staging
- [ ] Baseline error count captured
- [ ] Staging metrics green

**Phase 4 Ready:** Mar 15
- [ ] Committee CR approved (Phase 3 batch for production)
- [ ] Forge can deploy to production
- [ ] Rollback plan confirmed
- [ ] Batch deployment 1-4 scheduled for Mar 15-31

---

## Owner Checklist

**Flow (Implementation):**
- [ ] Response builder library
- [ ] Tests + linter
- [ ] Endpoint migrations (Phase 2-3)
- [ ] Metrics collection
- [ ] Documentation

**Pixel (Frontend):**
- [ ] Impact assessment
- [ ] Component updates
- [ ] Testing on staging
- [ ] User feedback

**Gene (Ops):**
- [ ] Rollout approval gates
- [ ] Monitoring setup
- [ ] Rollback readiness

**Jarvis (Chair):**
- [ ] Phase approvals
- [ ] Escalation if needed

---

**Proposed Start:** Monday, Feb 23 (today) ✅  
**Phase 1 Complete:** Friday, Feb 27  
**Phase 2 Complete:** Friday, Mar 8  
**Phase 3 Complete:** Friday, Mar 15  
**Phase 4 Complete:** Mar 31, 2026
