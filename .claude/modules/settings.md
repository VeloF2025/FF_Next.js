# Module: settings

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Configuration management for staff organizational structure including positions, departments, and reporting hierarchy |
| **Status** | Active |
| **Complexity** | Medium |
| **Category** | admin |

## Dependencies

### Internal FF Modules
None

### External Packages
- react (useState)
- lucide-react (Users, Building, GitBranch icons)
- @/types/staff-hierarchy.types

## Database

### Tables
None - local state only

### Key Queries
None

## API Endpoints
None

## Services
None

## Components
- `StaffSettings` - Main container with tabs
- `PositionsTab` - Manage positions
- `DepartmentsTab` - Manage departments
- `HierarchyTab` - Reporting structure

## Hooks
- `useStaffSettings` - State management for positions/departments

## Settings Categories
1. Positions
2. Departments
3. Hierarchy (reporting structure)

## Patterns
- Tabbed interface for organization settings
- In-memory state management (not persisted to DB)
- CRUD operations on positions and departments
- Hierarchy initialization with defaults

## Gotchas
- **No Persistence**: Currently uses local state only - no database persistence
- **Enum Initialization**: Positions and departments initialized from enums
- **Incomplete UI**: Editing functionality UI present but incomplete
- **Missing Modal**: Modal for add/edit not fully implemented
- **No API**: No API integration for saving changes
