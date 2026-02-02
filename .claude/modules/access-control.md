# Module: Access Control (RBAC)

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Role-based access control for user permissions |
| **Status** | Active |
| **Complexity** | Medium |
| **Category** | admin |

## Quick Reference
- **Dashboard:** `/settings` → Access Control tab
- **API:** `/api/admin/users/*`
- **Tables:** `users`, `access_permissions`, `role_permissions`, `user_permission_overrides`

## Architecture

### Permission System
```
┌─────────────────────────────────────────────────────────────────┐
│ access_permissions                                              │
│ Defines ALL available permissions in the system                 │
│ e.g., 'people.staff.sensitive', 'procurement.po.approve'       │
├─────────────────────────────────────────────────────────────────┤
│ role_permissions                                                │
│ Grants permissions to roles (admin, super_admin, viewer, etc.) │
│ ⚠️ CRITICAL: Permission must exist HERE to work for roles      │
├─────────────────────────────────────────────────────────────────┤
│ user_permission_overrides                                       │
│ Individual user permission grants/revokes                       │
│ Overrides role-based permissions for specific users             │
└─────────────────────────────────────────────────────────────────┘
```

### Permission Check Flow
```typescript
// 1. Get user's role permissions
const rolePerms = await sql`
  SELECT ap.permission_key
  FROM role_permissions rp
  JOIN access_permissions ap ON ap.id = rp.permission_id
  WHERE rp.role = ${user.role}
`;

// 2. Get user-specific overrides
const overrides = await sql`
  SELECT permission_key, is_granted
  FROM user_permission_overrides
  WHERE user_id = ${userId}
`;

// 3. Merge: overrides take precedence
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/users` | List users with filtering |
| GET | `/api/admin/users/[userId]` | Get user details |
| PATCH | `/api/admin/users/[userId]` | Update user |
| GET | `/api/admin/roles` | List available roles |
| GET | `/api/admin/permissions` | List all permissions |
| POST | `/api/admin/users/[userId]/permissions` | Grant/revoke permission |

## Database Tables

| Table | Purpose |
|-------|---------|
| `users` | User accounts with role field |
| `access_permissions` | Permission definitions |
| `role_permissions` | Role-to-permission mapping |
| `user_permission_overrides` | Per-user permission overrides |

## Key Files

| File | Purpose |
|------|---------|
| `src/components/settings/AccessControlTab.tsx` | Main UI component |
| `src/services/staff/staffAccessService.ts` | Permission checking service |
| `pages/api/admin/users/index.ts` | Users list API |

## UI Features

### Search & Filter (Client-Side)
- **Instant search** - No API calls, filters in-memory
- **Filters**: Role, Status (Active/Inactive), Department
- **Filter pills** - Show active filters with remove buttons
- **Collapsible filter panel** - Clean UI when not filtering

### User Management
- View all users with role badges
- Edit user role and permissions
- Grant/revoke individual permissions
- Toggle user active status

## Troubleshooting

### User Can't Access Feature Despite Permission Existing

**Symptom:** Permission exists in `access_permissions` but user still can't access.

**Root Cause:** Permission not granted to their role in `role_permissions`.

**Fix:**
```sql
-- 1. Find the permission ID
SELECT id, permission_key FROM access_permissions
WHERE permission_key = 'the.permission.key';

-- 2. Grant to role
INSERT INTO role_permissions (role, permission_id)
VALUES ('admin', <permission_id>);
```

### Permission Override Not Working

**Check:** User overrides take precedence, but only if the override exists:
```sql
SELECT * FROM user_permission_overrides
WHERE user_id = '<user_id>'
AND permission_key = 'the.permission.key';
```

### Search Is Slow

**Pattern:** Use client-side filtering for instant search (no debounce needed):
```typescript
const filteredUsers = useMemo(() => {
  return users.filter(user => {
    const search = searchTerm.toLowerCase();
    return user.fullName?.toLowerCase().includes(search) ||
           user.email?.toLowerCase().includes(search);
  });
}, [users, searchTerm]);
```

## Tab-Level Permission Filtering

### Pattern Implementation
All modules with tabs should filter tabs by user permissions:

```typescript
// 1. Define tabs with permission keys
const TABS = [
  { id: 'overview', label: 'Overview', permissionKey: 'module.tabs.overview' },
  { id: 'settings', label: 'Settings', permissionKey: 'module.tabs.settings' },
];

// 2. Filter tabs using usePermission hook
const { can, isLoading } = usePermission();

const accessibleTabs = useMemo(() => {
  if (isLoading) return []; // Don't show tabs while loading
  return TABS.filter(tab => can(tab.permissionKey, 'view'));
}, [isLoading, can]);

// 3. Show loading state
if (isLoading) {
  return <Loader2 className="animate-spin" />;
}

// 4. Show access denied if no tabs
if (accessibleTabs.length === 0) {
  return <AccessDenied message="No accessible tabs" />;
}

// 5. Render only accessible tabs
{accessibleTabs.map(tab => <Tab key={tab.id} {...tab} />)}
```

### Modules Using Tab Filtering
| Module | Permission Pattern | Tabs |
|--------|-------------------|------|
| Data Sync - OLT | `system.data-sync.olt.*` | import, pending, investigate, escalations, history, reporting |
| Data Sync - Maintenance | `system.data-sync.maintenance.*` | qcontact, alignment, three-way, weekly, wa-tracking |
| Data Sync - Activate | `system.data-sync.activate.*` | oes, arch, manual |
| Staff Detail | `people.staff.tabs.*` | overview, performance, employment, compliance, vehicles, etc. |

## User Permission Overrides

### Override Structure
```sql
-- user_permission_overrides table
CREATE TABLE user_permission_overrides (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  permission_key VARCHAR(100) NOT NULL,
  override_type VARCHAR(20) NOT NULL, -- 'grant' or 'revoke'
  actions JSONB DEFAULT '{}',         -- { view: true/false, edit: true/false }
  granted_by UUID,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  reason TEXT
);
```

### Grant Type with Restricted Access
To give a user access to ONLY specific tabs (restricting from role permissions):
```sql
-- Grant type with view:false REPLACES role permissions
INSERT INTO user_permission_overrides (user_id, permission_key, override_type, actions)
VALUES
  -- Grant access to these
  ('user-id', 'system.data-sync', 'grant', '{"view": true}'),
  ('user-id', 'system.data-sync.olt', 'grant', '{"view": true}'),
  ('user-id', 'system.data-sync.olt.pending', 'grant', '{"view": true}'),
  -- Deny access to these (grant type with view:false)
  ('user-id', 'system.data-sync.olt.import', 'grant', '{"view": false}'),
  ('user-id', 'system.data-sync.olt.investigate', 'grant', '{"view": false}');
```

### Permission Resolution Logic
```typescript
// In getUserEffectivePermissions():
// 1. Start with role permissions
// 2. Apply user overrides:
//    - 'grant' with view:true  → CAN access
//    - 'grant' with view:false → CANNOT access (overrides role)
//    - 'revoke' → CANNOT access
```

## Permission Hierarchy

```
system
├── system.health
├── system.infrastructure
├── system.data-sync                    (page access)
│   ├── system.data-sync.maintenance    (group access)
│   │   ├── system.data-sync.maintenance.qcontact
│   │   ├── system.data-sync.maintenance.alignment
│   │   └── ...
│   ├── system.data-sync.olt            (group access)
│   │   ├── system.data-sync.olt.import
│   │   ├── system.data-sync.olt.pending
│   │   └── ...
│   └── ...

people
├── people.staff
│   ├── people.staff.sensitive          (access to sensitive data)
│   └── people.staff.tabs
│       ├── people.staff.tabs.overview
│       ├── people.staff.tabs.employment
│       └── ...
```

## Critical Gotchas

1. **Two-Table Permission Grant**
   - Permission must exist in BOTH `access_permissions` AND `role_permissions`
   - Just adding to `access_permissions` does nothing - it only defines the permission
   - The grant happens in `role_permissions`

2. **Override vs Role**
   - `user_permission_overrides` can grant OR revoke
   - `grant` type with `actions.view: false` = user CANNOT access (despite role)
   - `grant` type with `actions.view: true` = user CAN access
   - Overrides always win over role-based permissions

3. **Flash of Unauthorized Content**
   - Always return empty array while permissions are loading
   - Show loading spinner until permissions resolve
   - WRONG: `if (loading) return ALL_TABS;`
   - RIGHT: `if (loading) return [];`

4. **Client-Side vs Server-Side Search**
   - For small datasets (<500 users), use client-side filtering
   - Provides instant feedback without spinners
   - Server-side filtering creates perceived lag even with debounce

5. **Page vs Group vs Tab Permissions**
   - Page permission (e.g., `system.data-sync`) controls sidebar/page access
   - Group permission (e.g., `system.data-sync.olt`) controls group card visibility
   - Tab permission (e.g., `system.data-sync.olt.pending`) controls individual tab visibility

## CLI Tool: /access Skill

Quick permission management from command line:

```bash
# Check all permissions for a user
node scripts/access-control.mjs check user@example.com

# Grant a permission
node scripts/access-control.mjs grant user@example.com system.data-sync.olt.pending

# Deny a permission (creates override with view:false)
node scripts/access-control.mjs deny user@example.com system.data-sync.olt.import

# List available permissions
node scripts/access-control.mjs list system

# Debug why user can/can't access something
node scripts/access-control.mjs debug user@example.com system.data-sync.olt.import
```

**Skill Documentation:** `.claude/skills/access.md`

## Related

- `.claude/modules/staff.md` - Staff management (uses permissions)
- `.claude/modules/admin.md` - Admin module overview
- `.claude/skills/access.md` - CLI access management skill
- `scripts/access-control.mjs` - CLI implementation
- `src/hooks/usePermission.ts` - Permission checking hook
- `src/lib/permissions/index.ts` - Permission resolution logic
