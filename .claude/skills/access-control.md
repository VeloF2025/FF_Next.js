---
name: access-control
description: Audit and update RBAC permission definitions when features change
version: 1.0.0
triggers:
  - /access-control
  - audit access control
  - update permissions
  - rbac audit
---

# /access-control - RBAC Permission Audit & Update

Audit the access control system when new features/endpoints are added. Ensures all new API routes have auth middleware and permission entries exist in the database.

## Usage
```
/access-control              # Full audit
/access-control <module>     # Audit specific module
```

## Workflow

### Step 1: Scan Recent Changes
```bash
# Find new/modified API endpoints in recent commits
git log --oneline --name-only -20 | grep "pages/api/"

# Find new/modified pages
git log --oneline --name-only -20 | grep -E "^(src/app|pages/)" | grep -v api
```

### Step 2: Audit API Auth Middleware

For each API route file, verify it has proper authentication:

**Required patterns** (at least one):
```typescript
export default withAuth(handler);
export default withAuth(withRole('admin')(handler));
export default withAuth(withPermission('module.action')(handler));
```

**Exceptions** (no auth required):
- `/api/auth/*` - Login/register/reset
- `/api/system/health` - Health check
- `/api/activate/dr-acknowledgment` - Bridge secret auth
- `/api/wa-monitor-*` webhook endpoints - Bridge secret auth
- `/api/qfield` - Webhook auth
- `/api/version` - Public

**Check command:**
```bash
# Find API routes WITHOUT withAuth
for f in $(find pages/api -name "*.ts" -not -path "*/auth/*"); do
  if ! grep -q "withAuth\|withFleetAuth\|BRIDGE_SECRET\|withOptionalAuth" "$f"; then
    echo "UNPROTECTED: $f"
  fi
done
```

### Step 3: Check Permission Database Entries

Query `access_permissions` table for completeness:

```sql
-- List all modules in permission system
SELECT DISTINCT module FROM access_permissions ORDER BY module;

-- Check if new module has entries
SELECT key, type, label FROM access_permissions
WHERE module = '<module>' ORDER BY type, key;

-- Find modules with pages but no permission entries
-- Compare against sidebar navigation config
```

**14 modules should be seeded:** Dashboard, Projects, Activate, Field, Maintenance, People, Clients, Contractors, Procurement, Assets, Fleet, Communications, Analytics, System

### Step 4: Seed Missing Permissions

If new features need permission entries, insert them:

```sql
-- Add new page permission
INSERT INTO access_permissions (module, key, type, label, description, parent_key, sort_order)
VALUES ('<module>', '<module>.<page>', 'page', '<Label>', '<Description>', '<module>', 10)
ON CONFLICT (key) DO NOTHING;

-- Add role permissions for new entry
INSERT INTO role_permissions (role, permission_key, actions)
VALUES
  ('super_admin', '<module>.<page>', '{"view": true, "create": true, "edit": true, "delete": true}'),
  ('admin', '<module>.<page>', '{"view": true, "create": true, "edit": true, "delete": false}'),
  ('manager', '<module>.<page>', '{"view": true, "create": false, "edit": false, "delete": false}'),
  ('viewer', '<module>.<page>', '{"view": true, "create": false, "edit": false, "delete": false}')
ON CONFLICT (role, permission_key) DO NOTHING;
```

### Step 5: Report

```
╔══════════════════════════════════════════════════════════════╗
║                ACCESS CONTROL AUDIT                          ║
╠══════════════════════════════════════════════════════════════╣
║ API routes scanned:     N                                    ║
║ Protected:              N (withAuth/withRole/withPermission) ║
║ Exempt (webhook/public):N                                    ║
║ UNPROTECTED:            N ⚠️                                 ║
║                                                              ║
║ Permission entries:     N modules, N pages, N tabs           ║
║ New entries added:      N                                    ║
║ Role mappings updated:  N                                    ║
╚══════════════════════════════════════════════════════════════╝
```

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/auth/middleware.ts` | withAuth, withRole, withPermission |
| `src/lib/auth/types.ts` | AuthRole, ROLE_HIERARCHY |
| `src/lib/permissions/index.ts` | userHasPermission() |
| `scripts/migrations/097_access_control.sql` | DB schema |
| `.claude/modules/rbac.md` | Full RBAC docs |
| `.claude/skills/access.md` | User-level permission management |

## Database Tables

| Table | Purpose |
|-------|---------|
| `access_permissions` | Permission definitions (module/page/tab/action) |
| `role_permissions` | Role-to-permission default mappings |
| `user_permission_overrides` | Per-user grants/revokes |

## Role Hierarchy

| Role | Level | Typical Access |
|------|-------|----------------|
| `super_admin` | 6 | Everything (bypasses all checks) |
| `system` | 5 | System operations |
| `admin` | 4 | All modules, manage users |
| `manager` | 3 | Team data, create/edit |
| `technician` | 2 | Field operations, own data |
| `viewer` | 1 | Read-only |
| `contractor` | - | Dashboard, projects, field, activate only |
