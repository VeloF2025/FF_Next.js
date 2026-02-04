# Module: staff

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Comprehensive staff management system with CRUD operations, advanced import, analytics, document tracking, and organizational hierarchy |
| **Status** | Active |
| **Complexity** | High |
| **Category** | admin |

## Dependencies

### Internal FF Modules
- `settings` (staff hierarchy configuration)

### External Packages
- @tanstack/react-query
- next/router
- lucide-react
- react-hot-toast
- react

## Database

### Tables
- `staff` - Main staff table (`department` VARCHAR, `department_id` UUID FK, `position` VARCHAR)
- `staff_documents` - Staff documentation
- `departments` - Department lookup table (`is_active` boolean, NOT `deleted_at`)

### Key Queries
- Select staff with CONCAT(first_name, last_name) as name
- Filter by search, department, status, position
- Count and aggregate staff by department/position
- Join staff with documents for tracking

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/staff` | List all staff with filters |
| GET | `/api/staff?id={id}` | Single staff member |
| POST | `/api/staff` | Create staff |
| GET | `/api/staff/[staffId]` | Detail view |
| GET | `/api/staff/[staffId]/documents` | Staff documents |
| GET | `/api/staff/[staffId]/projects` | Staff projects |

## Services

### staffService
```typescript
getAll(filter)
getById(id)
create(data)
update(id, data)
delete(id)
getStaffSummary()
```

### staffImportService
```typescript
importFromCSV(file, overwriteExisting)
importFromExcel(file, overwriteExisting)
```

## Components

### Main Components
- `StaffPage` - Main container
- `StaffList` - List view with filters
- `StaffTable` - Data table
- `StaffListHeader` - Header with actions
- `StaffFilters` - Search and filter UI
- `StaffDetail` - Detail view
- `StaffForm` - Create form (interceptor for dept→position clearing)
- `StaffEditForm` - Tabbed edit form (Overview/Employment/Compliance)
- `StaffImport` - Import dialog
- `StaffImportAdvanced` - Advanced import with progress
- `StaffAnalytics` - Dashboard with metrics

### Edit Form Sections (`edit-sections/`)
- `OverviewEditSection` - Personal info, contact, address, identity docs (Next of Kin hidden)
- `EmploymentEditSection` - Department/position dropdowns, contract, skills
- `ComplianceEditSection` - SA compliance fields (UIF, COIDA, tax)

### Create Form Sections
- PersonalInfoSection
- EmploymentSection
- EmergencyContactSection
- SkillsSection
- AvailabilitySection

### Analytics Components
- StaffKeyMetrics
- DepartmentDistribution
- ExperienceLevels
- ContractTypes
- TopPerformersTable
- SkillsOverview

### Other
- `ExitEmployeeModal` - Exit workflow

## Hooks
- `useStaffSettings` - Organizational settings
- `useStaffImportAdvanced` - Import state management
- `useStaffSummary` - Summary stats
- `useStaff` - Main staff data hook

## Patterns
- Advanced import with progress tracking
- Form sections for organization
- Analytics module with multiple chart components
- React Query for server state
- Parameterized SQL queries for security
- Error handling with custom logger

## Gotchas
- **Name Generation**: API uses CONCAT for name, not separate first/last in response
- **Multiple Filters**: Separate SQL queries for each filter combo (no union/reduce)
- **Cascade Check**: DELETE operation cascades may need checking
- **Import Testing**: Import overwrite logic needs detailed testing
- **Legacy Analytics**: StaffAnalytics marked as legacy with deprecation notice
- **Department names mismatch**: DB names (e.g., "Field Operations") differ from `StaffDepartment` enum ("Operations"). Resolved via `DEPARTMENT_ALIASES` in `staff-hierarchy.types.ts`
- **departments table uses `is_active`**: NOT `deleted_at` — never use soft-delete queries against this table
- **SA ID Number dual fields**: `saIdNumber` (Overview) and `idNumber` (Compliance) sync bidirectionally in `StaffEditForm.handleInputChange`
- **Position dropdown**: Uses `getPositionsByDepartment()` from `staff-hierarchy.types.ts` — must include current position as fallback option for legacy data
- **Department stored twice**: As display name in `department` VARCHAR + UUID in `department_id` FK. API resolves name→UUID on save
- **No demo data fallback** (fixed 2026-02-04): `pages/staff/index.tsx` previously fell back to demo data (John Smith, Sarah Johnson) when API failed. Now shows proper error state with retry button. See `learnings.md` for details.
