# Module: projects

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Core project management - creation, tracking, SOW import, fiber stringing, home installs, pole tracking |
| **Status** | Active |
| **Complexity** | High |
| **Category** | core |

## Dependencies

### Internal FF Modules
- `sow` - SOW document handling
- Pole tracker sub-system

### External Packages
- @tanstack/react-query
- Firebase (legacy for project data)

## Database

### Tables
- `projects` - Core project table
- `drops` - SOW imported drop data
- `sow_poles` - Pole positions and statuses
- `sow_fibre` - Fiber cable segments
- `clients` - Linked via client_id
- `staff` - Linked via project_manager
- `home_installs` - Home customer installations

### Key Queries
- SELECT from projects with filter by id, status, client_id, search
- JOIN projects with clients and staff for details
- Query poles by project_id with status filtering
- Query fiber segments by project_id with completion tracking

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST/PUT/DELETE | `/api/projects` | Project CRUD |
| GET/PUT | `/api/projects/[projectId]` | Single project |
| * | `/api/sow/project` | SOW data |
| * | `/api/sow/project/[projectId]` | Project SOW |
| * | `/api/contractors-projects.ts` | Contractor projects |
| * | `/api/contractors-projects-update.ts` | Update |
| * | `/api/contractors-projects-delete.ts` | Delete |
| * | `/api/analytics/projects` | Project analytics |
| * | `/api/staff/[staffId]/projects.ts` | Staff projects |

## Services

### ProjectService (facade)
- **ProjectCrudService**: createProject, getProjectById, updateProject, deleteProject
- **ProjectQueryService**: getProjects, getProjectsByClient, getProjectsByManager
- **ProjectProgressService**: updateProjectProgress, calculateMetrics
- **ProjectTeamService**: assignTeamMember, removeTeamMember

### SOWService
- uploadService, documentService, dataExtractor, dataValidator
- sowDropImport, sowFiberImport, sowPoleImport

### PoleTrackerService
- poleTrackerNeonService (Neon PostgreSQL)
- poleDataService, photoManagementService, qualityCheckService, statisticsService

## Components
- `ProjectCreationWizard` - Multi-step creation
- `ProjectForm`, `ProjectList`, `ProjectTable`, `ProjectListHeader`
- `ProjectSummaryCards`
- `FiberStringingDashboard` - Fiber tracking
- `HomeInstallsList`, `HomeInstallsDashboard`, `HomeInstallsTable`, `HomeInstallsHeader`
- `PoleTrackerDashboard`, `PoleTrackerDetail`, `PoleTrackerList`
- `SOWUploadSection`, `SOWManagement`, `DropsManagement`

## Hooks
```typescript
useProjects(query)
useProject(projectId)
useProjectsByClient(clientId)
useProjectsByManager(managerId)
useCreateProject()
useUpdateProject()
useDeleteProject()
usePoleTracker(projectId)
usePoleDetail(poleId)
useTrackerData()
useSOWUpload()
useSOWData()
useDropsManagement()
useFiberStringingDashboard()
```

## Patterns
- Wizard-based project creation (BasicInfo, ProjectDetails, SOWUpload, Review)
- SOW import workflow - parse → validate → import → verify
- Pole tracker uses Neon PostgreSQL directly (not Firebase)
- Three sub-systems: SOW management, Fiber tracking, Pole tracking
- Project progress calculated from pole and drop completion
- Team member role-based access

## Gotchas
- **Dual Database**: ProjectCrudService still uses Firebase (legacy) while new endpoints use PostgreSQL
- **Migration Needed**: Two separate databases - need full Neon migration
- **Atomic Import**: SOW import creates drops, poles, and fiber - must be atomic
- **Separate Storage**: Pole photos stored separately (likely Firebase Storage)
- **Separate Tracking**: Home installs tracked separately from general drops
- **Table Sync**: Fiber stringing depends on sow_poles and sow_fibre tables in sync
- **Complex Nesting**: Pole tracker has complex nested service structure
