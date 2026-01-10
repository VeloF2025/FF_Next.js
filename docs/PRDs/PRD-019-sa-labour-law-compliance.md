# PRD-019: SA Labour Law Compliance & Employee Exit Workflow

## Overview
Add South African Labour Law compliant contract types, compliance tracking, and a proper employee exit workflow with soft delete functionality.

## Problem Statement
The current staff system:
1. Uses generic contract types that don't align with SA labour law
2. Lacks compliance tracking for UIF, COIDA, PAYE
3. Has no proper process for employee termination/exit
4. Hard-deletes employees losing historical data

## Goals
1. Implement SA Labour Law compliant contract types
2. Add compliance tracking for statutory requirements
3. Create employee exit workflow with soft delete
4. Track probation periods per BCEA guidelines

## SA Labour Law Context

### Basic Conditions of Employment Act (BCEA)
- Defines contract types and employee rights
- Maximum probation period: 6 months
- Notice periods based on service duration

### Compliance Requirements
| Requirement | Description |
|-------------|-------------|
| **UIF** | Unemployment Insurance Fund registration |
| **COIDA** | Compensation for Occupational Injuries and Diseases Act |
| **PAYE** | Pay As You Earn tax deductions |
| **Probation** | Max 6 months per BCEA |

## Requirements

### 1. Contract Types (SA Compliant)
```typescript
enum SAContractType {
  PERMANENT = 'permanent',        // Indefinite period
  FIXED_TERM = 'fixed_term',      // Specific end date
  PART_TIME = 'part_time',        // Less than 45 hours/week
  TEMPORARY = 'temporary',        // Short-term assignments
  INDEPENDENT_CONTRACTOR = 'independent_contractor',  // Not an employee
  INTERN = 'intern'               // Training/learnership
}
```

### 2. Compliance Tracking Fields
Add to staff table:
```sql
-- SA Compliance columns
uif_registered BOOLEAN DEFAULT false,
uif_number VARCHAR(20),
coida_registered BOOLEAN DEFAULT false,
coida_number VARCHAR(20),
paye_registered BOOLEAN DEFAULT false,
tax_number VARCHAR(20),
probation_start_date DATE,
probation_end_date DATE,
probation_status VARCHAR(20), -- 'in_probation', 'completed', 'extended', 'failed'
notice_period_days INTEGER DEFAULT 30
```

### 3. Employee Exit Workflow

#### Exit Types
```typescript
enum ExitType {
  RESIGNATION = 'resignation',
  TERMINATION = 'termination',
  RETRENCHMENT = 'retrenchment',
  CONTRACT_END = 'contract_end',
  RETIREMENT = 'retirement',
  DEATH = 'death',
  ABSCONDED = 'absconded'
}
```

#### Exit Fields
```sql
-- Exit tracking columns
is_active BOOLEAN DEFAULT true,
exit_date DATE,
exit_type VARCHAR(30),
exit_reason TEXT,
exit_notes TEXT,
rehireable BOOLEAN DEFAULT true,
final_pay_processed BOOLEAN DEFAULT false,
exit_interview_completed BOOLEAN DEFAULT false
```

### 4. Exit Employee Modal
A guided workflow component for terminating employees:
- Select exit type
- Enter exit date
- Provide reason (required for termination)
- Mark as rehireable or not
- Confirm action

## Files to Create/Modify

### New Files
- [ ] `src/types/staff/compliance.types.ts` - SA compliance types
- [ ] `src/types/staff/enums.types.ts` - Contract and exit enums
- [ ] `src/modules/staff/components/ExitEmployeeModal.tsx` - Exit workflow UI
- [ ] `src/components/staff/ComplianceDashboard.tsx` - Compliance overview
- [ ] `scripts/add-sa-compliance-columns.sql` - Migration script
- [ ] `scripts/run-sa-compliance-migration.js` - Migration runner

### Modified Files
- [ ] `src/types/staff/base.types.ts` - Add compliance fields
- [ ] `src/types/staff/form.types.ts` - Add form fields
- [ ] `src/modules/staff/components/StaffForm.tsx` - Add compliance section
- [ ] `src/modules/staff/components/form-sections/EmploymentSection.tsx` - Contract type dropdown
- [ ] `src/modules/staff/components/analytics/ContractTypes.tsx` - Update chart
- [ ] `src/services/staff/staffApiService.ts` - Exit functionality
- [ ] `src/services/staff/neon/crudOperations.ts` - Soft delete
- [ ] `pages/api/staff/index.ts` - Exit endpoint
- [ ] `pages/staff/index.tsx` - Add exit button

## Database Migration

```sql
-- Add SA compliance columns to staff table
ALTER TABLE staff ADD COLUMN IF NOT EXISTS contract_type VARCHAR(30) DEFAULT 'permanent';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS uif_registered BOOLEAN DEFAULT false;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS uif_number VARCHAR(20);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS coida_registered BOOLEAN DEFAULT false;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS paye_registered BOOLEAN DEFAULT false;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS tax_number VARCHAR(20);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS probation_start_date DATE;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS probation_end_date DATE;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS probation_status VARCHAR(20);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS notice_period_days INTEGER DEFAULT 30;

-- Exit tracking columns
ALTER TABLE staff ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS exit_date DATE;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS exit_type VARCHAR(30);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS exit_reason TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS rehireable BOOLEAN DEFAULT true;
```

## API Endpoints

### Exit Employee
```
PUT /api/staff/{staffId}
Body: {
  action: 'exit',
  exitType: 'resignation' | 'termination' | ...,
  exitDate: '2026-01-10',
  exitReason: 'string',
  rehireable: boolean
}
```

## Acceptance Criteria
1. Contract type dropdown shows SA-compliant options
2. Compliance fields (UIF, COIDA, PAYE) can be set and saved
3. Probation period tracks start/end dates with 6-month max warning
4. Exit modal allows terminating employees with required fields
5. Exited employees are soft-deleted (is_active = false)
6. Staff list can filter active vs inactive employees
7. Exit reason is required for termination type
8. Historical data preserved for exited employees

## Dependencies
- Database migration must run before features work
- Contract type validation for legacy values (full-time → permanent)

## Original PR
- PR #19: https://github.com/VelocityFibre/FF_Next.js/pull/19
- 50 files changed, +4,851 additions, -751 deletions
