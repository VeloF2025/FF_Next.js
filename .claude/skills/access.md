# /access - User Permission Management

Manage user permissions, check access, grant/deny overrides, and debug permission issues.

## Trigger
- `/access` - Show help
- `/access check <email>` - Check user's permissions
- `/access grant <email> <permission>` - Grant permission
- `/access deny <email> <permission>` - Deny permission
- `/access list [module]` - List available permissions
- `/access debug <email> <permission>` - Debug why user can/can't access

---

## Commands

### Check User Permissions
```
/access check <email>
```
Shows all effective permissions for a user including:
- Role-based permissions
- User-specific overrides
- Final resolved access

### Grant Permission
```
/access grant <email> <permission>
```
Grants a specific permission to a user via override.

### Deny Permission
```
/access deny <email> <permission>
```
Denies a specific permission to a user (overrides role permissions).

### List Permissions
```
/access list [module]
```
Lists all available permission keys. Optional module filter:
- `system` - System permissions
- `people` - People/staff permissions
- `projects` - Project permissions
- `procurement` - Procurement permissions

### Debug Permission
```
/access debug <email> <permission>
```
Explains why a user can or cannot access a specific permission.

---

## Implementation

<access-skill>

### Step 1: Parse Command
Extract the command and arguments from user input.

### Step 2: Execute Based on Command

#### For `check`:
```typescript
// Query user's effective permissions
const query = `
  SELECT
    u.email,
    u.role,
    ap.key as permission_key,
    CASE
      WHEN upo.id IS NOT NULL THEN
        CASE WHEN (upo.actions->>'view')::boolean = false THEN false ELSE true END
      ELSE true
    END as can_view,
    CASE WHEN upo.id IS NOT NULL THEN 'override' ELSE 'role' END as source
  FROM users u
  LEFT JOIN role_permissions rp ON rp.role = u.role
  LEFT JOIN access_permissions ap ON ap.id = rp.permission_id
  LEFT JOIN user_permission_overrides upo ON upo.user_id = u.id AND upo.permission_key = ap.key
  WHERE u.email = $1
  ORDER BY ap.key
`;
```

#### For `grant`:
```typescript
// Insert or update override with view: true
const query = `
  INSERT INTO user_permission_overrides (user_id, permission_key, override_type, actions, granted_at)
  SELECT u.id, $2, 'grant', '{"view": true}'::jsonb, NOW()
  FROM users u WHERE u.email = $1
  ON CONFLICT (user_id, permission_key)
  DO UPDATE SET actions = '{"view": true}'::jsonb, override_type = 'grant'
`;
```

#### For `deny`:
```typescript
// Insert or update override with view: false
const query = `
  INSERT INTO user_permission_overrides (user_id, permission_key, override_type, actions, granted_at)
  SELECT u.id, $2, 'grant', '{"view": false}'::jsonb, NOW()
  FROM users u WHERE u.email = $1
  ON CONFLICT (user_id, permission_key)
  DO UPDATE SET actions = '{"view": false}'::jsonb, override_type = 'grant'
`;
```

#### For `list`:
```typescript
// List all permissions, optionally filtered by module
const query = `
  SELECT key, label, type, parent_key
  FROM access_permissions
  WHERE key LIKE $1 || '%'
  ORDER BY key
`;
```

#### For `debug`:
```typescript
// Show detailed permission resolution
const query = `
  WITH user_info AS (
    SELECT id, email, role FROM users WHERE email = $1
  ),
  role_perm AS (
    SELECT ap.key, true as has_role_perm
    FROM role_permissions rp
    JOIN access_permissions ap ON ap.id = rp.permission_id
    JOIN user_info u ON rp.role = u.role
    WHERE ap.key = $2
  ),
  user_override AS (
    SELECT
      upo.permission_key,
      upo.override_type,
      upo.actions,
      (upo.actions->>'view')::boolean as can_view
    FROM user_permission_overrides upo
    JOIN user_info u ON upo.user_id = u.id
    WHERE upo.permission_key = $2
  )
  SELECT
    u.email,
    u.role,
    rp.has_role_perm,
    uo.override_type,
    uo.can_view as override_view,
    CASE
      WHEN uo.override_type IS NOT NULL THEN uo.can_view
      WHEN rp.has_role_perm THEN true
      ELSE false
    END as final_access
  FROM user_info u
  LEFT JOIN role_perm rp ON true
  LEFT JOIN user_override uo ON true
`;
```

### Step 3: Format Output

Display results in a clear table format:

```
User: janice@velocityfibre.co.za
Role: admin

Permission                              | Access | Source
----------------------------------------|--------|--------
system.data-sync                        | ✓      | override
system.data-sync.olt                    | ✓      | override
system.data-sync.olt.pending            | ✓      | override
system.data-sync.olt.import             | ✗      | override
system.data-sync.olt.investigate        | ✗      | override
```

</access-skill>

---

## Permission Hierarchy Reference

```
system
├── system.health
├── system.infrastructure
├── system.data-sync
│   ├── system.data-sync.maintenance
│   │   ├── system.data-sync.maintenance.qcontact
│   │   ├── system.data-sync.maintenance.alignment
│   │   ├── system.data-sync.maintenance.three-way
│   │   ├── system.data-sync.maintenance.weekly
│   │   └── system.data-sync.maintenance.wa-tracking
│   ├── system.data-sync.activate
│   │   ├── system.data-sync.activate.oes
│   │   ├── system.data-sync.activate.arch
│   │   └── system.data-sync.activate.manual
│   ├── system.data-sync.olt
│   │   ├── system.data-sync.olt.import
│   │   ├── system.data-sync.olt.pending
│   │   ├── system.data-sync.olt.investigate
│   │   ├── system.data-sync.olt.escalations
│   │   ├── system.data-sync.olt.history
│   │   └── system.data-sync.olt.reporting
│   ├── system.data-sync.qfield
│   │   └── system.data-sync.qfield.projects
│   └── system.data-sync.history
│       └── system.data-sync.history.timeline

people
├── people.staff
│   ├── people.staff.sensitive
│   └── people.staff.tabs
│       ├── people.staff.tabs.overview
│       ├── people.staff.tabs.performance
│       ├── people.staff.tabs.employment
│       ├── people.staff.tabs.compliance
│       ├── people.staff.tabs.vehicles
│       ├── people.staff.tabs.disciplinary
│       ├── people.staff.tabs.documents
│       ├── people.staff.tabs.projects
│       ├── people.staff.tabs.notes
│       └── people.staff.tabs.activity
```

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `users` | User accounts with role |
| `access_permissions` | Permission definitions |
| `role_permissions` | Role-to-permission mapping |
| `user_permission_overrides` | Per-user overrides |

---

## Examples

### Restrict user to only OLT Pending tab
```
/access grant janice@velocityfibre.co.za system.data-sync
/access grant janice@velocityfibre.co.za system.data-sync.olt
/access grant janice@velocityfibre.co.za system.data-sync.olt.pending
/access deny janice@velocityfibre.co.za system.data-sync.olt.import
/access deny janice@velocityfibre.co.za system.data-sync.olt.investigate
/access deny janice@velocityfibre.co.za system.data-sync.olt.escalations
/access deny janice@velocityfibre.co.za system.data-sync.olt.history
/access deny janice@velocityfibre.co.za system.data-sync.olt.reporting
```

### Check why user can't access staff sensitive data
```
/access debug mishke@velocityfibre.co.za people.staff.sensitive
```

### List all system permissions
```
/access list system
```
