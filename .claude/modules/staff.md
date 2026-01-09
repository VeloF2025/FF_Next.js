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
- `staff` - Main staff table
- `staff_documents` - Staff documentation

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
- `StaffForm` - Create/edit form
- `StaffImport` - Import dialog
- `StaffImportAdvanced` - Advanced import with progress
- `StaffAnalytics` - Dashboard with metrics

### Form Sections
- PersonalInfoSection
- EmploymentSection
- ContactSection
- SkillsSection
- AvailabilitySection
- DocumentsSection

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
