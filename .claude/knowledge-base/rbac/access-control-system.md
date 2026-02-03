# Access Control System (RBAC)

> FibreFlow's Role-Based Access Control system for managing user permissions.

## Quick Reference

**Location:** Settings > Access Control tab (NOT in System section)
**Main Component:** `src/components/settings/AccessControlTab.tsx` (1089 lines)
**Last Updated:** 2026-01-26

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Settings Page (/settings)                     │
├─────────────────────────────────────────────────────────────────┤
│  [General] [Sidebar] [Access Control] [Workflow] [Integrations] │
├─────────────────────────────────────────────────────────────────┤
│                     AccessControlTab.tsx                         │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  [Users (61)]  [Roles (9)]  [Permissions]                   ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  Users Tab:        Roles Tab:           Permissions Tab:         │
│  - User list       - Role list          - Permission tree        │
│  - Role dropdown   - Permission matrix  - 12 modules             │
│  - Permissions     - VIEW|CREATE|EDIT   - Expandable             │
│    button          - Editable toggles   - Read-only              │
│  - Deactivate                                                    │
└─────────────────────────────────────────────────────────────────┘
```

## Role Hierarchy

| Level | Role | Users | Permissions | Notes |
|-------|------|-------|-------------|-------|
| 6 | super_admin | 1 | 71 | All permissions, NOT editable |
| 5 | system | - | - | System-level access |
| 4 | admin (Administrator) | 5 | Varies | Full management |
| 3 | manager | 21 | Varies | Team lead level |
| 2 | technician (Field Tech) | 5 | Varies | Field work |
| 1 | viewer | 28 | Varies | Read-only |

Custom roles: Project Manager, Site Supervisor, Contractor, Client

## Database Schema

```sql
-- Permission definitions
access_permissions (
  id SERIAL PRIMARY KEY,
  key VARCHAR(100) UNIQUE,      -- 'dashboard.view', 'projects.create'
  name VARCHAR(200),
  description TEXT,
  module VARCHAR(50),           -- 'dashboard', 'projects', etc.
  action VARCHAR(50),           -- 'view', 'create', 'edit', 'delete'
  parent_id INTEGER REFERENCES access_permissions(id)
)

-- Role-to-permission mappings
role_permissions (
  id SERIAL PRIMARY KEY,
  role VARCHAR(50),             -- 'admin', 'manager', etc.
  permission_id INTEGER REFERENCES access_permissions(id),
  can_grant BOOLEAN DEFAULT false,
  UNIQUE(role, permission_id)
)

-- Individual user overrides
user_permission_overrides (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  permission_id INTEGER REFERENCES access_permissions(id),
  override_type VARCHAR(20),    -- 'grant' or 'revoke'
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,         -- NULL = permanent
  reason TEXT,
  UNIQUE(user_id, permission_id)
)
```

## API Endpoints

### Permissions

```typescript
// GET /api/admin/permissions - List all permissions
// Query params: ?tree=true (returns hierarchical tree)

interface Permission {
  id: number;
  key: string;
  name: string;
  description: string;
  module: string;
  action: string;
  parent_id: number | null;
  children?: Permission[];  // When tree=true
}
```

### Roles

```typescript
// GET /api/admin/roles - List all roles with permissions

interface Role {
  name: string;
  level: number;
  user_count: number;
  permissions: string[];  // Permission keys
}
```

### User Permission Overrides

```typescript
// GET /api/admin/users/[userId]/permissions
// Returns user's effective permissions with override info

// POST /api/admin/users/[userId]/permissions
// Grant a permission override
body: {
  permission_id: number;
  expires_at?: string;  // ISO date or null for permanent
  reason?: string;
}

// DELETE /api/admin/users/[userId]/permissions/[permissionId]
// Revoke a permission override
```

## Component Structure

```
src/components/settings/
└── AccessControlTab.tsx
    ├── UsersSubTab
    │   ├── Search bar
    │   ├── Filters (role, status)
    │   ├── User table
    │   │   ├── Name/email
    │   │   ├── Role dropdown
    │   │   ├── Department
    │   │   ├── Status badge
    │   │   ├── Last login
    │   │   └── Actions (Permissions, Deactivate)
    │   └── UserPermissionsModal
    │       ├── Permission tree (expandable)
    │       ├── CRUD toggles per permission
    │       ├── Legend (From Role, Grant, Revoke, No Access)
    │       └── Auto-save
    ├── RolesSubTab
    │   ├── Role list (left panel)
    │   └── Permission matrix (right panel)
    │       └── Permission rows × CRUD columns
    └── PermissionsSubTab
        └── Permission hierarchy tree (read-only)
```

## Permission Module Structure

```
12 Top-Level Modules:
├── Dashboard        (dashboard)
├── Projects         (projects)
├── Activations      (activate)
├── Field Operations (field)
├── Maintenance      (maintenance)
├── People           (people)
├── Clients          (clients)
├── Contractors      (contractors)
├── Procurement      (procurement)
├── Assets           (assets)
├── Fleet            (fleet)
└── Communications   (communications)

Each module has sub-permissions:
- module.view      - View access
- module.create    - Create new items
- module.edit      - Edit existing items
- module.delete    - Delete items
- module.page.view - Page-specific view (e.g., dashboard.action-items.view)
```

## Using Permissions in Code

### In API Routes

```typescript
// pages/api/projects/[projectId].ts
import { withAuth, withPermission } from '@/lib/auth/middleware';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handler logic - user is authenticated and has permission
}

// Require auth + specific permission
export default withAuth(withPermission('projects.view')(handler));

// Or just require a role level
export default withAuth(withRole('manager')(handler));
```

### In Components

```typescript
import { useAuth } from '@/contexts/AuthContext';
import { Permission } from '@/types/auth.types';

function MyComponent() {
  const { hasPermission, user } = useAuth();

  if (!hasPermission(Permission.PROJECTS_CREATE)) {
    return <AccessDenied />;
  }

  return <CreateProjectForm />;
}
```

### Permission Service

```typescript
// src/lib/permissions/index.ts
import { getUserEffectivePermissions, grantUserPermission, revokeUserPermission } from '@/lib/permissions';

// Get all permissions for a user (role + overrides)
const permissions = await getUserEffectivePermissions(userId);

// Grant a specific permission to a user
await grantUserPermission(userId, permissionId, {
  grantedBy: adminUserId,
  expiresAt: '2026-06-01',
  reason: 'Temporary project access'
});

// Revoke a permission
await revokeUserPermission(userId, permissionId);
```

## UI/UX Patterns

### Full-Width for Data Tables

The Access Control tab uses full-width layout because the user table has many columns:

```tsx
// src/pages/Settings.tsx
const isFullWidth = activeTab === 'access';

return (
  <div className={`p-6 ${isFullWidth ? '' : 'max-w-4xl mx-auto'}`}>
    {renderTabContent()}
  </div>
);
```

### Permission Legend Colors

| State | Visual | Meaning |
|-------|--------|---------|
| From Role | Green checkmark | Inherited from role |
| Custom Grant | Green checkmark + badge | Manually granted |
| Custom Revoke | Red X | Manually revoked |
| No Access | Empty checkbox | No permission |

### Auto-Save Pattern

Permission changes save automatically without a "Save" button:
```tsx
const handlePermissionToggle = async (permissionId: number, grant: boolean) => {
  if (grant) {
    await grantUserPermission(userId, permissionId);
  } else {
    await revokeUserPermission(userId, permissionId);
  }
  // UI updates optimistically
};
```

## Common Issues

### "Access Denied" for Admin Users

Check role level in database:
```sql
SELECT id, email, role FROM users WHERE email = 'user@example.com';
-- Ensure role matches: 'super_admin', 'admin', 'manager', etc.
```

### Permission Override Not Working

1. Check `user_permission_overrides` table
2. Verify `expires_at` is NULL or in future
3. Check `override_type` is 'grant' not 'revoke'

### Role Dropdown Not Saving

The role dropdown in Users tab calls:
```typescript
// PATCH /api/admin/users/[userId]
body: { role: 'manager' }
```

Check API logs for errors.

## Related Files

| File | Purpose |
|------|---------|
| `src/components/settings/AccessControlTab.tsx` | Main RBAC UI |
| `src/lib/permissions/index.ts` | Permission service |
| `src/lib/auth/middleware.ts` | Auth middleware |
| `pages/api/admin/permissions.ts` | Permissions API |
| `pages/api/admin/roles.ts` | Roles API |
| `pages/api/admin/users/[userId]/permissions.ts` | User overrides API |
| `src/types/auth.types.ts` | Permission enum |

## Navigation Tab Permissions

Module navigation tabs use `rbacKey` to control visibility and access.

### Permission Key Format

```typescript
// CORRECT: Dot-separated format
rbacKey: 'fleet.vehicles'
rbacKey: 'fleet.drivers'
rbacKey: 'system.data-sync.olt.pending'

// WRONG: Do NOT use colon format
rbacKey: 'fleet:vehicles:view'  // ❌ Won't match database keys
```

### How Tab Filtering Works

```typescript
// src/modules/navigation/hooks/useModuleTabs.ts
const { can } = usePermission();

// Tab is locked if user can't view it
const isLocked = tab.rbacKey && !can(tab.rbacKey, 'view');

// Permission check in usePermission hook
const perm = permissionMap.get(permissionKey);
if (!perm) return false;  // No permission = no access
return perm.canView;
```

### Adding Tab Permissions

1. Add permission to database:
```sql
INSERT INTO access_permissions (key, name, module, description)
VALUES ('fleet.vehicles', 'Fleet Vehicles', 'fleet', 'Access to fleet vehicles tab');
```

2. Grant to roles:
```sql
INSERT INTO role_permissions (role, permission_key, actions)
VALUES ('viewer', 'fleet.vehicles', '{"view": true, "create": false, "edit": false, "delete": false}');
```

3. Add rbacKey to navigation config:
```typescript
// src/modules/navigation/config/modules/fleet.config.ts
{
  id: 'vehicles',
  label: 'Vehicles',
  icon: Car,
  path: '/fleet/vehicles',
  rbacKey: 'fleet.vehicles',  // Must match database key
}
```

## Meeting Access Control Pattern

Meetings use participant-based access control rather than role-based.

### Database Schema

```sql
-- Meetings store participants as JSONB array
meetings (
  id UUID PRIMARY KEY,
  title VARCHAR(255),
  participants JSONB,  -- [{"email": "user@example.com", "name": "User"}, ...]
  summary JSONB,
  ...
)
```

### Access Control Query

```typescript
// Only return meetings where user is a participant
const meetings = await sql`
  SELECT * FROM meetings
  WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements(participants) AS p
    WHERE LOWER(p->>'email') = ${userEmail}
  )
`;
```

### Secured Endpoints

| Endpoint | Access Rule |
|----------|-------------|
| `GET /api/meetings` | User sees only meetings they're a participant of |
| `GET /api/meetings?id=X` | 403 if not a participant |
| `POST /api/action-items/extract` | Must be a participant to extract |

**Exception:** `super_admin` role bypasses all meeting access checks.

## Future Enhancements

- [ ] Permission templates (e.g., "Project Manager" bundle)
- [ ] Bulk permission assignment
- [ ] Permission audit log
- [ ] Time-limited permissions with notifications
- [ ] Permission request workflow
