# Module: RBAC (Role-Based Access Control)

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Granular permission management with module/page/tab/action hierarchy |
| **Status** | Active |
| **Complexity** | High |
| **Category** | admin/security |
| **Location** | Settings > Access Control |

## Architecture

### Permission Hierarchy
```
Module (14)
└── Page (50+)
    └── Tab (15+)
        └── Action (4 per item: view, create, edit, delete)
```

### Permission Resolution Order
1. **Super Admin Check**: `users.permissions` contains `['all']` → full access bypass
2. **Role Permissions**: Look up `role_permissions` for user's role
3. **User Overrides**: Apply `user_permission_overrides` (grant overrides role, revoke removes)
4. **Return Result**: Combined effective permission

### Role Hierarchy
| Role | Description | Default Access |
|------|-------------|----------------|
| `super_admin` | Full system access | All permissions, all actions |
| `admin` | Administrative access | All except system delete |
| `manager` | Team management | View all, create/edit most, limited delete |
| `technician` | Field work focus | Dashboard, field ops, activations, fleet check-in |
| `viewer` | Read-only access | View only, no modifications |
| `contractor` | External contractor | Limited modules (dashboard, projects, field, activate) |

## Database

### Tables

#### `access_permissions`
Defines all controllable items in the system.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `type` | VARCHAR(20) | 'module' \| 'page' \| 'tab' \| 'action' |
| `key` | VARCHAR(100) | Unique hierarchical key (e.g., 'procurement.sourcing.boq') |
| `parent_key` | VARCHAR(100) | FK to parent permission's key |
| `label` | VARCHAR(100) | Display name |
| `description` | TEXT | Permission description |
| `route` | VARCHAR(200) | Associated route (for pages) |
| `sort_order` | INT | Display order |
| `is_active` | BOOLEAN | Whether permission is active |

**Key constraint:** `UNIQUE(key)`

#### `role_permissions`
Default permissions per role.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `role` | VARCHAR(50) | Role name |
| `permission_key` | VARCHAR(100) | FK to access_permissions.key |
| `actions` | JSONB | `{view: bool, create: bool, edit: bool, delete: bool}` |

**Key constraint:** `UNIQUE(role, permission_key)`

#### `user_permission_overrides`
Per-user customizations to override role defaults.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | FK to users.id |
| `permission_key` | VARCHAR(100) | FK to access_permissions.key |
| `override_type` | VARCHAR(10) | 'grant' \| 'revoke' |
| `actions` | JSONB | Which actions to grant/revoke |
| `granted_by` | UUID | Who granted the override |
| `granted_at` | TIMESTAMPTZ | When granted |
| `expires_at` | TIMESTAMPTZ | Optional expiry |
| `reason` | TEXT | Why override was granted |

**Key constraint:** `UNIQUE(user_id, permission_key)`

### Database Functions

#### `user_has_permission(user_id, permission_key, action)`
Returns `BOOLEAN` - checks if user has specific permission action.

#### `get_user_permissions(user_id)`
Returns table of all effective permissions for user.

### Key Queries

**Get user's effective permissions:**
```sql
SELECT * FROM get_user_permissions('user-uuid-here');
```

**Check specific permission:**
```sql
SELECT user_has_permission('user-uuid-here', 'procurement.sourcing.boq', 'edit');
```

**Get permission tree:**
```sql
SELECT * FROM v_permission_tree;
```

## API Endpoints

### Permissions

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/admin/permissions` | GET | admin | List all permissions |
| `/api/admin/permissions?tree=true` | GET | admin | Hierarchical tree |
| `/api/admin/permissions?type=module` | GET | admin | Filter by type |
| `/api/admin/permissions/me` | GET | auth | Current user's permissions |

### Roles

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/admin/roles` | GET | admin | List all roles |
| `/api/admin/roles?role=admin` | GET | admin | Single role permissions |

### Users

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/admin/users` | GET | admin | List all users |
| `/api/admin/users/[userId]` | GET | admin | User with permissions |
| `/api/admin/users/[userId]` | PATCH | admin | Update role/status |
| `/api/admin/users/provision-from-staff` | POST | admin | Create users from staff |

## Services

### Permission Service
**File:** `src/lib/permissions/index.ts`

#### Query Functions
```typescript
getPermissions(type?: PermissionType): Promise<Permission[]>
getPermissionTree(): Promise<Permission[]>
getModulePermissions(moduleKey: string): Promise<Permission[]>
getRoles(): Promise<string[]>
getRolePermissions(role: string): Promise<RolePermission[]>
```

#### User Permission Functions
```typescript
userHasPermission(userId: string, permissionKey: string, action: PermissionAction): Promise<boolean>
getUserEffectivePermissions(userId: string): Promise<EffectivePermission[]>
getUserPermissionOverrides(userId: string): Promise<UserPermissionOverride[]>
```

#### Override Functions
```typescript
grantUserPermission(userId, permissionKey, actions, grantedBy, reason?, expiresAt?): Promise<void>
revokeUserPermission(userId, permissionKey, actions, revokedBy, reason?): Promise<void>
removeUserPermissionOverride(userId, permissionKey): Promise<void>
```

#### Helper Functions
```typescript
canViewModule(userId: string, moduleKey: string): Promise<boolean>
canAccessPage(userId: string, pageKey: string): Promise<boolean>
getAccessibleModules(userId: string): Promise<Permission[]>
getAccessiblePages(userId: string, moduleKey: string): Promise<Permission[]>
```

## Components

### AccessControlTab
**File:** `src/components/settings/AccessControlTab.tsx`

Three sub-tabs:
1. **Users Tab**: User list with search, role filter, edit role, toggle active
2. **Roles Tab**: Role list with permission matrix
3. **Permissions Tab**: Hierarchical tree view with type badges

### UI Features
- Search/filter users by name, email, role
- Inline role editing via dropdown
- Active/inactive toggle
- Permission tree with module > page > tab hierarchy
- Color-coded type badges (module=blue, page=green, tab=purple)
- Staff provisioning button

## Auth Integration

### Current Implementation
- `withAuth()` - Requires authentication
- `withRole(role)` - Requires specific role
- Super admin bypass via `permissions: ['all']`

### Position-to-Role Mapping
**Used in:** `provision-from-staff.ts`, `setup-password.ts`

```typescript
function mapPositionToAuthRole(position: string): AuthRole {
  const positionLower = position.toLowerCase();

  if (positionLower.includes('admin') || positionLower.includes('director') ||
      positionLower.includes('ceo') || positionLower.includes('cso'))
    return 'admin';

  if (positionLower.includes('manager') || positionLower.includes('supervisor') ||
      positionLower.includes('head') || positionLower.includes('lead'))
    return 'manager';

  if (positionLower.includes('technician') || positionLower.includes('installer') ||
      positionLower.includes('engineer'))
    return 'technician';

  return 'viewer';
}
```

## Seeded Permissions

### Modules (14)
| Key | Label |
|-----|-------|
| `dashboard` | Dashboard |
| `projects` | Projects |
| `activate` | Activations |
| `field` | Field Operations |
| `maintenance` | Maintenance |
| `people` | People |
| `clients` | Clients |
| `contractors` | Contractors |
| `procurement` | Procurement |
| `assets` | Assets |
| `fleet` | Fleet |
| `communications` | Communications |
| `analytics` | Analytics |
| `system` | System |

### Sample Page Keys
- `dashboard.main`, `dashboard.action-items`, `dashboard.daily-progress`
- `projects.list`, `projects.imports`, `projects.pipeline`
- `procurement.main`, `procurement.sourcing`, `procurement.purchasing`
- `system.settings`, `system.access-control`

### Sample Tab Keys
- `procurement.sourcing.suppliers`, `procurement.sourcing.boq`, `procurement.sourcing.rfq`
- `procurement.inventory.stock`, `procurement.inventory.items`
- `activate.main.summary`, `activate.main.qa-centre`, `activate.main.reports`

## Patterns

### Permission Check Pattern (Backend)
```typescript
import { withAuth, withRole } from '@/lib/auth';
import { userHasPermission } from '@/lib/permissions';

async function handler(req, res) {
  // Already have role check via withRole
  // For granular check:
  const canEdit = await userHasPermission(req.user.id, 'procurement.sourcing.boq', 'edit');
  if (!canEdit) {
    return apiResponse.forbidden(res, 'Cannot edit BOQ');
  }
  // ... proceed
}

export default withAuth(withRole('admin')(handler));
```

### Permission Check Pattern (Frontend - TODO)
```typescript
// Future: usePermission hook
const { can, canAny } = usePermission();

if (can('procurement.sourcing.boq', 'edit')) {
  // Show edit button
}

// Future: PermissionGate component
<PermissionGate permission="procurement.sourcing.boq" action="edit">
  <EditButton />
</PermissionGate>
```

## Implementation Status

### Completed
- [x] Database schema (3 tables + 2 functions + 1 view)
- [x] Migration with seed data
- [x] Permission service (`src/lib/permissions/index.ts`)
- [x] Admin API endpoints
- [x] Access Control UI (Settings > Access Control)
- [x] Staff provisioning
- [x] Theme compliance

### TODO
- [ ] `usePermission` hook for frontend
- [ ] `PermissionGate` component
- [ ] Sidebar filtering (hide inaccessible modules)
- [ ] Tab filtering (hide inaccessible tabs)
- [ ] Action button permissions (disable/hide based on permissions)
- [ ] Role editor (modify role permissions in UI)
- [ ] User override editor (grant/revoke in UI)

## Files

### Core
| File | Purpose |
|------|---------|
| `scripts/migrations/097_access_control.sql` | Database schema + seed |
| `src/lib/permissions/index.ts` | Permission service |
| `src/components/settings/AccessControlTab.tsx` | Admin UI |

### API
| File | Purpose |
|------|---------|
| `pages/api/admin/permissions/index.ts` | List permissions |
| `pages/api/admin/permissions/me.ts` | Current user permissions |
| `pages/api/admin/roles/index.ts` | List roles |
| `pages/api/admin/users/index.ts` | List users |
| `pages/api/admin/users/[userId].ts` | Single user management |
| `pages/api/admin/users/provision-from-staff.ts` | Staff provisioning |

### Auth
| File | Purpose |
|------|---------|
| `src/lib/auth.ts` | Auth utilities, withRole |
| `pages/api/auth/setup-password.ts` | Password setup with role mapping |

## Gotchas

1. **Super Admin Bypass**: Users with `permissions: ['all']` bypass all permission checks
2. **Override Priority**: User overrides take precedence over role permissions
3. **Expiring Overrides**: Check `expires_at` when evaluating overrides
4. **Position Mapping**: Position-based role assignment is fuzzy (substring match)
5. **Permission Keys**: Use dot notation for hierarchy (`module.page.tab`)
6. **No UI Enforcement Yet**: Backend permissions work, but UI doesn't hide/disable elements yet

## Related Commands
- `/audit-rbac` - RBAC system audit
- `/audit` - Full system audit (includes infrastructure)

## Migration

**File:** `scripts/migrations/097_access_control.sql`

**Run migration:**
```bash
DATABASE_URL='...' node scripts/migrations/run-migration-097.js
# or
npm run db:migrate
```
