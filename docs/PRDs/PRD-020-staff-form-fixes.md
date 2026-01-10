# PRD-020: Staff Form Fixes, Field Persistence, and Import Improvements

## Overview
Various fixes for the staff form, ensuring field persistence on save, improved Excel import with flexible column headers, and better navigation.

## Problem Statement
1. Row click on staff list doesn't navigate to staff detail
2. Excel import fails with mixed-case column headers
3. Staff API returns `id` but frontend expects `employeeId`
4. Staff import doesn't save all fields from Excel
5. Staff queries don't compute full name from first_name + last_name
6. Position dropdown missing options for some departments (e.g., Finance)
7. Legacy contract type values (full-time) fail validation

## Goals
1. Fix all field persistence issues
2. Make Excel import more flexible
3. Improve staff list navigation
4. Ensure API compatibility

## Requirements

### 1. Staff List Row Click Navigation
- [ ] Enable click on staff table row to navigate to `/staff/{id}`
- [ ] Add cursor pointer on hover
- [ ] Preserve action buttons (edit, delete) without triggering navigation

### 2. Excel Import - Mixed Case Headers
Accept any case variation:
```typescript
// All should map to 'firstName':
'First Name', 'first name', 'FIRST NAME', 'firstName', 'first_name'
```

Column mapping:
```typescript
const headerMappings: Record<string, string> = {
  'first name': 'firstName',
  'last name': 'lastName',
  'email': 'email',
  'phone': 'phone',
  'department': 'department',
  'position': 'position',
  'employee id': 'employeeNumber',
  'id number': 'idNumber',
  // ... etc
};
```

### 3. API Field Aliasing
Return both `id` and `employeeId` for compatibility:
```typescript
// In staff API response
return {
  id: staff.id,
  employeeId: staff.id,  // Alias for frontend
  ...otherFields
};
```

### 4. Staff Import - Save All Fields
Ensure these fields save from Excel:
- First Name, Last Name
- Email, Phone
- Department, Position
- Employee ID/Number
- ID Number
- Start Date
- Contract Type
- Salary/Rate
- Skills
- Emergency Contact

### 5. Computed Name Field
Staff queries should compute name:
```sql
SELECT
  id,
  CONCAT(first_name, ' ', last_name) as name,
  first_name,
  last_name,
  ...
FROM staff
```

### 6. Position Dropdown - All Departments
Add positions for Finance department:
```typescript
const financePositions = [
  'Financial Manager',
  'Accountant',
  'Bookkeeper',
  'Financial Controller',
  'Accounts Payable',
  'Accounts Receivable',
  'Payroll Administrator'
];
```

### 7. Contract Type Validation
Map legacy values to new SA-compliant values:
```typescript
const contractTypeMapping: Record<string, string> = {
  'full-time': 'permanent',
  'full_time': 'permanent',
  'fulltime': 'permanent',
  'part-time': 'part_time',
  'parttime': 'part_time',
  'contract': 'fixed_term',
  'temp': 'temporary',
  'freelance': 'independent_contractor',
};
```

## Files to Modify

### Import Processing
- [ ] `src/services/staff/import/excelProcessor.ts` - Mixed-case headers
- [ ] `src/services/staff/import/csvProcessor.ts` - Mixed-case headers
- [ ] `src/services/staff/import/parsers.ts` - Field mapping
- [ ] `src/services/staff/import/rowProcessor.ts` - Save all fields

### Staff API
- [ ] `pages/api/staff/index.ts` - Add employeeId alias
- [ ] `src/services/staff/neon/queryBuilders.ts` - Computed name
- [ ] `src/services/staff/neon/crudOperations.ts` - Save all fields

### Staff UI
- [ ] `src/modules/staff/components/StaffTable.tsx` - Row click navigation
- [ ] `src/modules/staff/components/StaffList.tsx` - Click handler
- [ ] `src/modules/staff/components/StaffDetail.tsx` - Field display
- [ ] `src/modules/staff/components/form-sections/EmploymentSection.tsx` - Position dropdown
- [ ] `pages/staff/import.tsx` - Proper navigation

## Acceptance Criteria
1. Clicking a staff row navigates to staff detail page
2. Excel import accepts headers in any case
3. All Excel fields persist after import
4. Staff name displays as "First Last" in lists
5. Position dropdown shows options for all departments
6. Legacy contract types auto-convert on import
7. Frontend receives both `id` and `employeeId`

## Testing
1. Import Excel with mixed-case headers
2. Verify all fields saved correctly
3. Click staff row and verify navigation
4. Test position dropdown for Finance department
5. Import staff with "full-time" contract type

## Original PR
- PR #20: https://github.com/VelocityFibre/FF_Next.js/pull/20
- 29 files changed, +4,326 additions, -162 deletions
