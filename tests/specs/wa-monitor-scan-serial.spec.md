# Test Specification: WA Monitor Serial Scanning

> API endpoint for recording equipment serial scans during installation

## Source

- **PRD/Spec**: `~/.claude/plans/dynamic-spinning-floyd.md` (Site Stock Tracking Plan)
- **Date Created**: 2026-01-13
- **Author**: Kai (PAI)

---

## Overview

The `/api/wa-monitor-scan-serial` endpoint enables field technicians to scan ONT/UPS/Router barcodes during installation (QA Review Steps 8 & 9). It validates the serial against stock inventory, creates consumption records, and links the equipment to the drop number for full traceability.

**Key Workflow:**
1. Technician scans barcode at customer site
2. System validates serial exists and is issued to technician
3. Creates stock_consumptions record
4. Updates stock_serials status to 'installed'
5. Updates qa_photo_reviews with serial + consumption link

---

## Unit Tests

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| UT-001 | Record valid ONT serial scan | Valid qaReviewId, dropNumber, stepNumber=8, serialNumber | Success with consumptionId | HIGH |
| UT-002 | Record valid UPS serial scan | Valid qaReviewId, dropNumber, stepNumber=9, serialNumber | Success with consumptionId | HIGH |
| UT-003 | Reject serial not found | Non-existent serialNumber | Error: SERIAL_NOT_FOUND | HIGH |
| UT-004 | Reject serial not issued | Serial with status='available' | Error: SERIAL_NOT_ISSUED | HIGH |
| UT-005 | Reject already installed serial | Serial with status='installed' | Error: ALREADY_INSTALLED | HIGH |
| UT-006 | Reject missing qaReviewId | Missing qaReviewId | Validation error | HIGH |
| UT-007 | Reject missing dropNumber | Missing dropNumber | Validation error | HIGH |
| UT-008 | Reject invalid stepNumber | stepNumber=7 | Validation error | MEDIUM |
| UT-009 | Handle database transaction error | DB failure during update | Internal error | HIGH |
| UT-010 | Accept optional GPS coordinates | Valid request with gpsLat/gpsLng | Success with GPS recorded | MEDIUM |
| UT-011 | Reject invalid method | PUT/DELETE request | 405 Method Not Allowed | MEDIUM |

### Test File Location
`tests/api/wa-monitor/scan-serial.test.ts`

---

## Integration Tests

| ID | Description | Components Involved | Expected Behavior | Priority |
|----|-------------|---------------------|-------------------|----------|
| IT-001 | Full scan workflow | API, Service, DB | Serial linked to drop, status updated | HIGH |
| IT-002 | QA review updated | API, DB | qa_photo_reviews has ont_serial_scanned | HIGH |
| IT-003 | Stock consumption created | API, DB | stock_consumptions record exists | HIGH |
| IT-004 | Serial status changed | API, DB | stock_serials.status = 'installed' | HIGH |

### Test File Location
`tests/integration/api/wa-monitor-scan-serial.test.ts`

---

## Acceptance Criteria Mapping

From Plan Phase 2A:

- [x] **AC1**: Validate serial exists in stock_serials table -> `UT-003`
- [x] **AC2**: Verify status = 'issued' (not already installed) -> `UT-004`, `UT-005`
- [x] **AC3**: Create consumption record with all required fields -> `IT-003`
- [x] **AC4**: Update stock_serials status to 'installed' -> `IT-004`
- [x] **AC5**: Update qa_photo_reviews with serial + consumption link -> `IT-002`
- [x] **AC6**: GPS coordinates recorded when provided -> `UT-010`
- [x] **AC7**: Return appropriate error codes -> `UT-003`, `UT-004`, `UT-005`

---

## Edge Cases

| Scenario | Expected Behavior | Test ID |
|----------|-------------------|---------|
| Serial scanned twice | Second scan rejected (ALREADY_INSTALLED) | UT-005 |
| Invalid step number | Validation error (only 8 or 9 allowed) | UT-008 |
| Database timeout | Transaction rolled back, error returned | UT-009 |
| Empty serial string | Validation error | UT-006 |
| GPS coordinates out of range | Accept but flag for review | - |

---

## API Contract

### Request

```typescript
POST /api/wa-monitor-scan-serial
Content-Type: application/json

{
  "qaReviewId": string,      // UUID from qa_photo_reviews
  "dropNumber": string,       // e.g., "DR123456"
  "stepNumber": 8 | 9,        // 8=ONT, 9=UPS
  "serialNumber": string,     // Scanned barcode value
  "technicianId"?: string,    // Current user ID
  "technicianName"?: string,  // Current user name
  "gpsLat"?: number,          // GPS latitude
  "gpsLng"?: number,          // GPS longitude
  "scanTimestamp": string     // ISO timestamp
}
```

### Response - Success

```typescript
{
  "success": true,
  "data": {
    "consumptionId": string,
    "serialStatus": "installed",
    "dropUpdated": boolean,
    "qaReviewUpdated": boolean
  }
}
```

### Response - Error

```typescript
{
  "success": false,
  "error": {
    "code": "SERIAL_NOT_FOUND" | "SERIAL_NOT_ISSUED" | "ALREADY_INSTALLED" | "VALIDATION_ERROR",
    "message": string
  }
}
```

---

## Notes

- Uses WA Monitor module's internal apiResponse helper (module isolation)
- Transaction ensures all updates succeed or all fail
- GPS coordinates are optional but recommended for verification
- Serial must have status 'issued' to be scanned at installation

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
