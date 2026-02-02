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
```bash
# Use CLI script (recommended)
node scripts/access-control.mjs check user@example.com
```

Or via SQL:
```sql
SELECT
  rp.permission_key,
  (rp.actions->>'view')::boolean as can_view,
  'role' as source
FROM users u
JOIN role_permissions rp ON rp.role = u.role
WHERE u.email = $1
UNION ALL
SELECT
  upo.permission_key,
  (upo.actions->>'view')::boolean as can_view,
  'override' as source
FROM user_permission_overrides upo
JOIN users u ON u.id = upo.user_id
WHERE u.email = $1
ORDER BY permission_key;
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
```bash
# Use CLI script (recommended)
node scripts/access-control.mjs debug user@example.com system.data-sync.olt.import
```

Output shows:
- User's role
- Whether role has the permission
- Whether override exists and its value
- Final access decision with reason

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
