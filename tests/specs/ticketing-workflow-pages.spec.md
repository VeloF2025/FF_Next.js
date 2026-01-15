# Test Specification: Ticketing Workflow Pages

## Overview
Complete the UI integration for Escalations, Handover Center, and Risk Acceptance pages by wiring them to existing backend APIs.

## Current State
- **Backend**: COMPLETE - All services, APIs, and DB tables exist
- **UI**: INCOMPLETE - Pages exist but show mock/placeholder content

## Requirements

### 1. Risk Acceptance Review Page (`/ticketing/risks`)

#### 1.1 Global List Endpoint (NEW)
**Endpoint**: `GET /api/ticketing/risk-acceptances`

**Query Parameters**:
- `status`: filter by status (active, resolved, expired, escalated)
- `expiring_within_days`: filter risks expiring within N days
- `project_id`: filter by project
- `limit`: pagination limit
- `offset`: pagination offset

**Response**:
```typescript
{
  success: true,
  data: QARiskAcceptance[],
  pagination: { total: number, limit: number, offset: number }
}
```

**Test Cases**:
- [ ] Returns all risk acceptances when no filters
- [ ] Filters by status correctly
- [ ] Filters by expiring_within_days (returns risks expiring soon)
- [ ] Returns empty array when no matching risks
- [ ] Returns 500 on database error

#### 1.2 UI Data Fetching
**Test Cases**:
- [ ] Page fetches risks on mount
- [ ] "Active Risks" tab shows active risks from API
- [ ] "Expiring Soon" tab shows risks expiring within 7 days
- [ ] "Resolved" tab shows resolved risks
- [ ] Shows loading state while fetching
- [ ] Shows error state on API failure
- [ ] Displays risk count badges on tabs

#### 1.3 Risk Actions
**Test Cases**:
- [ ] Can resolve a risk from the list
- [ ] Resolving refreshes the list
- [ ] Shows success toast on resolve
- [ ] Shows error toast on resolve failure

---

### 2. Handover Center Page (`/ticketing/handover`)

#### 2.1 Pending Handovers Endpoint (NEW)
**Endpoint**: `GET /api/ticketing/handovers/pending`

**Query Parameters**:
- `handover_type`: filter by type (BUILD_TO_QA, QA_TO_MAINTENANCE)
- `project_id`: filter by project
- `limit`: pagination limit

**Response**:
```typescript
{
  success: true,
  data: {
    ticket_id: string,
    ticket_uid: string,
    title: string,
    current_owner: OwnerType,
    pending_handover_type: HandoverType,
    gate_status: { passed: number, total: number },
    blockers: string[]
  }[],
  pagination: { total: number, limit: number, offset: number }
}
```

**Test Cases**:
- [ ] Returns tickets ready for handover
- [ ] Filters by handover_type
- [ ] Includes gate validation status
- [ ] Lists blockers preventing handover
- [ ] Returns empty array when no pending handovers

#### 2.2 UI Data Fetching
**Test Cases**:
- [ ] Page fetches pending handovers on mount
- [ ] Displays pending tickets list
- [ ] Shows gate status (X/5 passed)
- [ ] Shows blockers for each ticket
- [ ] Clicking ticket opens HandoverWizard with ticket pre-selected
- [ ] Shows loading state while fetching

#### 2.3 Handover History
**Test Cases**:
- [ ] History tab fetches all handover snapshots
- [ ] Displays handover timeline
- [ ] Can filter history by date range
- [ ] Can filter history by handover type

---

### 3. Escalations Page (`/ticketing/escalations`)

#### 3.1 Current State
Escalations page is mostly working. Verify:
- [ ] Fetches escalations from API on mount
- [ ] Filters work (scope_type, status)
- [ ] Map view shows fault patterns
- [ ] Can resolve escalation from list

#### 3.2 Enhancements (if needed)
- [ ] Add project filter
- [ ] Add date range filter
- [ ] Show escalation details modal

---

## Acceptance Criteria

### Risk Acceptance Page
1. Shows real data from database (not placeholder text)
2. Tab counts show actual numbers
3. Can resolve risks directly from page
4. Expiring risks show warning styling

### Handover Center Page
1. Shows list of tickets pending handover
2. Gate status visible for each ticket
3. Can initiate handover from list
4. History shows all past handovers

### Escalations Page
1. Already working - verify no regressions
2. All filters functional

---

## Implementation Order (TDD)

1. **RED**: Write failing tests for new API endpoints
2. **GREEN**: Implement API endpoints to pass tests
3. **REFACTOR**: Wire UI to new endpoints
4. **VERIFY**: Manual testing in browser

## Files to Create/Modify

### New Files:
- `app/api/ticketing/risk-acceptances/route.ts` - Global risk list
- `app/api/ticketing/handovers/pending/route.ts` - Pending handovers list

### Modify Files:
- `app/(main)/ticketing/risks/client.tsx` - Wire to API
- `app/(main)/ticketing/handover/client.tsx` - Wire to API
- `src/modules/ticketing/services/riskAcceptanceService.ts` - Add listAllRisks()
- `src/modules/ticketing/services/handoverService.ts` - Add getPendingHandovers()
