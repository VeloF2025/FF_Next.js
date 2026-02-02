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

## Critical Gotchas

1. **Two-Table Permission Grant**
   - Permission must exist in BOTH `access_permissions` AND `role_permissions`
   - Just adding to `access_permissions` does nothing - it only defines the permission
   - The grant happens in `role_permissions`

2. **Override vs Role**
   - `user_permission_overrides` can grant OR revoke
   - Check `is_granted` field (true = grant, false = revoke)
   - Overrides always win over role-based permissions

3. **Client-Side vs Server-Side Search**
   - For small datasets (<500 users), use client-side filtering
   - Provides instant feedback without spinners
   - Server-side filtering creates perceived lag even with debounce

## Related

- `.claude/modules/staff.md` - Staff management (uses permissions)
- `.claude/modules/admin.md` - Admin module overview
- `src/hooks/usePermission.ts` - Permission checking hook
