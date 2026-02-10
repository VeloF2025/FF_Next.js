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

## Staff Creation Flow (Updated 2026-02-09)
- **Minimal Required Fields**: Create mode only requires name, email, phone. Employee ID auto-generated server-side.
- **Auto Employee ID**: POST `/api/staff` generates VFxxx pattern (e.g., VF065 after VF064) automatically. `employeeId` is optional in form types.
- **Create → Detail Redirect**: After creation, redirects to `/staff/[newId]` detail page for further editing.
- **Form Sections**: Create mode shows only `PersonalInfoSection` with `isCreating` prop to hide employee ID and alt phone fields.

## Layout Pattern (Updated 2026-02-09)
- **Full-Width Detail Pages**: `StaffDetail.tsx` uses `p-6` padding, NO `max-w-6xl mx-auto` constraint.
- **Consistency**: Matches standard `ModulePage` layout pattern used throughout the app.
- **Previous Pattern**: Old layout had centered max-width container, removed for consistency.

## Dev Deployment Process (Updated 2026-02-09)
- **Dev Server Location**: `/home/hein/apps/fibreflow-dev` (owned by hein user)
- **Two-Step Deploy**:
  1. SSH as `hein` (pw: 0203) for `git pull` and `npm run build`
  2. SSH as `velo` (pw: velo2026) for `sudo systemctl restart fibreflow-dev.service`
- **Permission Issue**: Running `sudo rm -rf .next` as velo creates permission conflicts. Use hein for build operations.
- **Standard Dev Deploy**:
  ```bash
  # Step 1: Build as hein
  sshpass -p '0203' ssh hein@100.96.203.105 "cd /home/hein/apps/fibreflow-dev && git pull && npm run build"

  # Step 2: Restart as velo
  sshpass -p 'velo2026' ssh velo@100.96.203.105 "echo 'velo2026' | sudo -S systemctl restart fibreflow-dev.service"
  ```
