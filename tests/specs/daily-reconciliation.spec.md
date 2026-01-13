# Test Specification: Daily Stock Reconciliation Report

> API endpoint for generating daily stock reconciliation reports per technician

## Source

- **PRD/Spec**: `~/.claude/plans/dynamic-spinning-floyd.md` (Site Stock Tracking Plan - Phase 4)
- **Date Created**: 2026-01-13
- **Author**: Kai (PAI)

---

## Overview

The `/api/field-stock/reports/daily-reconciliation` endpoint provides end-of-day stock accountability reports. It reconciles stock issued to technicians against installations completed, identifying unaccounted items.

**Key Workflow:**
1. Query stock_pickings for items issued on specified date
2. Query stock_consumptions/qa_photo_reviews for items installed
3. Calculate: Issued - Installed - Returned = Unaccounted
4. Apply accountability thresholds (> 3 items or > R5000)
5. Return per-technician breakdown with flags

---

## Unit Tests

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| UT-001 | Return reconciliation for valid date | date=2026-01-12 | Success with technician data | HIGH |
| UT-002 | Calculate correct issued counts | Technician with 10 issued items | issued_count: 10 | HIGH |
| UT-003 | Calculate correct installed counts | Technician with 8 installed items | installed_count: 8 | HIGH |
| UT-004 | Calculate unaccounted correctly | 10 issued - 8 installed | unaccounted_count: 2 | HIGH |
| UT-005 | Include summary totals | Multiple technicians | total_issued, total_installed | HIGH |
| UT-006 | Flag blocked contractor | threshold exceeded | is_blocked: true | HIGH |
| UT-007 | Filter by project | project=Lawley | Only Lawley technicians | MEDIUM |
| UT-008 | Filter by technician | technicianId=UUID | Single technician report | MEDIUM |
| UT-009 | Return empty for future date | date=2026-12-31 | Empty technicians array | LOW |
| UT-010 | Reject missing date parameter | No date | 400 validation error | HIGH |
| UT-011 | Reject invalid date format | date=invalid | 400 validation error | HIGH |
| UT-012 | Reject invalid HTTP methods | PUT/DELETE/POST | 405 Method Not Allowed | MEDIUM |
| UT-013 | Handle database error | DB failure | 500 Internal Error | HIGH |
| UT-014 | Include serial numbers in response | Valid request | issued_serials array | MEDIUM |
| UT-015 | Calculate unaccounted value | Items with known prices | unaccounted_value in ZAR | MEDIUM |

### Test File Location
`tests/api/field-stock/daily-reconciliation.test.ts`

---

## Integration Tests

| ID | Description | Components Involved | Expected Behavior | Priority |
|----|-------------|---------------------|-------------------|----------|
| IT-001 | Full reconciliation query | API, DB Views | Correct join across tables | HIGH |
| IT-002 | Accountability threshold trigger | API, DB | Block flag when threshold exceeded | HIGH |
| IT-003 | Multi-technician report | API, DB | All technicians for date returned | HIGH |

### Test File Location
`tests/integration/api/daily-reconciliation.test.ts`

---

## Acceptance Criteria Mapping

From Plan Phase 4:

- [x] **AC1**: Query issued items from stock_pickings by date -> `UT-002`
- [x] **AC2**: Query installed items from stock_consumptions/qa_photo_reviews -> `UT-003`
- [x] **AC3**: Calculate unaccounted = issued - installed - returned -> `UT-004`
- [x] **AC4**: Include summary totals -> `UT-005`
- [x] **AC5**: Flag contractors exceeding threshold -> `UT-006`
- [x] **AC6**: Support project filter -> `UT-007`
- [x] **AC7**: Support technician filter -> `UT-008`
- [x] **AC8**: Include serial number lists -> `UT-014`
- [x] **AC9**: Calculate unaccounted monetary value -> `UT-015`

---

## Edge Cases

| Scenario | Expected Behavior | Test ID |
|----------|-------------------|---------|
| No pickings for date | Empty technicians array, zero totals | UT-009 |
| Technician with zero issued | Not included in report | - |
| Technician with all installed | unaccounted_count: 0, no flag | UT-004 |
| Returned items | Reduce unaccounted count | - |
| Weekend date | Still query (may be empty) | - |

---

## API Contract

### Request

```typescript
GET /api/field-stock/reports/daily-reconciliation?date=2026-01-12&project=Lawley&technicianId=UUID
Content-Type: application/json

Query Parameters:
  date: string (required)       // YYYY-MM-DD format
  project?: string              // Filter by project name
  technicianId?: string         // Filter to single technician
```

### Response - Success

```typescript
{
  "success": true,
  "data": {
    "date": "2026-01-12",
    "technicians": [
      {
        "id": "tech-uuid",
        "name": "John Doe",
        "contractorId": "contractor-uuid",
        "contractorName": "ABC Contractors",

        "issued_count": 10,
        "issued_serials": ["ONT-001", "ONT-002", ...],

        "installed_count": 8,
        "installed_serials": ["ONT-001", "ONT-002", ...],

        "returned_count": 0,
        "returned_serials": [],

        "unaccounted_count": 2,
        "unaccounted_serials": ["ONT-009", "ONT-010"],
        "unaccounted_value": 3500.00,

        "is_blocked": false,
        "pending_recovery": 0
      }
    ],
    "summary": {
      "total_issued": 30,
      "total_installed": 26,
      "total_returned": 0,
      "total_unaccounted": 4,
      "unaccounted_value": 7000.00,
      "technician_count": 3
    }
  }
}
```

### Response - Error

```typescript
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR" | "DATABASE_ERROR" | "NOT_FOUND",
    "message": string
  }
}
```

---

## Notes

- Uses field-stock module isolation (internal utilities)
- Reads from v_installation_stock_reconciliation view (created in migration 032)
- Stock values come from stock_items.unit_price
- Blocking threshold: > 3 items OR > R5000 value
- Response includes both counts and serial number arrays for drill-down

---

## Checklist

Before implementation:
- [x] All acceptance criteria have mapped tests
- [x] Edge cases identified
- [x] Test file locations decided
- [x] Priority assigned to each test

After test creation:
- [ ] Tests are failing (RED phase)
- [ ] Test descriptions match behavior
- [ ] No trivial tests (DGTS compliant)
