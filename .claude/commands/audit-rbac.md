# /audit-rbac - RBAC System Audit

Comprehensive audit of the Role-Based Access Control (RBAC) system covering database tables, API endpoints, UI components, and permission enforcement.

## Usage

```
/audit-rbac                # Full RBAC audit
/audit-rbac db             # Database schema and data only
/audit-rbac api            # API endpoints only
/audit-rbac ui             # UI components only
/audit-rbac enforcement    # Permission enforcement checks
```

---

## 1. DATABASE AUDIT

### 1.1 Schema Verification

**Tables exist:**
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('access_permissions', 'role_permissions', 'user_permission_overrides');
```

**Expected:** 3 tables

### 1.2 Permission Data Integrity

**Count permissions by type:**
```sql
SELECT type, COUNT(*) as count
FROM access_permissions
WHERE is_active = true
GROUP BY type
ORDER BY CASE type WHEN 'module' THEN 1 WHEN 'page' THEN 2 WHEN 'tab' THEN 3 WHEN 'action' THEN 4 END;
```

**Expected counts:**
| Type | Expected |
|------|----------|
| module | 14 |
| page | 50+ |
| tab | 15+ |

**Verify hierarchy integrity (no orphan children):**
```sql
SELECT ap.key, ap.parent_key
FROM access_permissions ap
LEFT JOIN access_permissions parent ON ap.parent_key = parent.key
WHERE ap.parent_key IS NOT NULL AND parent.key IS NULL;
```

**Expected:** Zero rows (no orphaned children)

### 1.3 Role Permissions

**All roles have permissions:**
```sql
SELECT DISTINCT role, COUNT(*) as permission_count
FROM role_permissions
GROUP BY role
ORDER BY role;
```

**Expected roles:**
| Role | Min Permissions |
|------|-----------------|
| super_admin | All (14 modules + all children) |
| admin | All |
| manager | All |
| technician | Subset |
| viewer | View-only |
| contractor | Limited subset |

### 1.4 User Data

**Users have valid roles:**
```sql
SELECT role, COUNT(*) as user_count
FROM users
GROUP BY role
ORDER BY user_count DESC;
```

**Super admin has 'all' permission:**
```sql
SELECT id, email, role, permissions
FROM users
WHERE role = 'super_admin';
```

**Expected:** Super admins have `permissions: ["all"]`

### 1.5 Override Data

**Active overrides:**
```sql
SELECT
  u.email,
  upo.permission_key,
  upo.override_type,
  upo.actions,
  upo.reason,
  upo.expires_at
FROM user_permission_overrides upo
JOIN users u ON u.id = upo.user_id
WHERE upo.expires_at IS NULL OR upo.expires_at > NOW()
ORDER BY upo.granted_at DESC;
```

---

## 2. API ENDPOINTS AUDIT

### 2.1 Permissions API

| Endpoint | Method | Expected Response |
|----------|--------|-------------------|
| `/api/admin/permissions` | GET | List all permissions |
| `/api/admin/permissions?tree=true` | GET | Hierarchical tree |
| `/api/admin/permissions?type=module` | GET | Modules only |
| `/api/admin/permissions/me` | GET | Current user's permissions |

**Test commands:**
```bash
# Flat list
curl -s "http://localhost:3005/api/admin/permissions" | jq '.data.total'

# Tree structure
curl -s "http://localhost:3005/api/admin/permissions?tree=true" | jq '.data.tree | length'

# Current user
curl -s "http://localhost:3005/api/admin/permissions/me" | jq '.data.permissions | length'
```

### 2.2 Roles API

| Endpoint | Method | Expected Response |
|----------|--------|-------------------|
| `/api/admin/roles` | GET | List all roles |
| `/api/admin/roles?role=admin` | GET | Single role permissions |

**Test commands:**
```bash
# All roles
curl -s "http://localhost:3005/api/admin/roles" | jq '.data.roles'

# Admin role permissions
curl -s "http://localhost:3005/api/admin/roles?role=admin" | jq '.data.permissions | length'
```

### 2.3 Users API

| Endpoint | Method | Expected Response |
|----------|--------|-------------------|
| `/api/admin/users` | GET | List all users |
| `/api/admin/users/[id]` | GET | User with permissions |
| `/api/admin/users/[id]` | PATCH | Update user role |
| `/api/admin/users/provision-from-staff` | POST | Provision staff as users |

**Test commands:**
```bash
# List users
curl -s "http://localhost:3005/api/admin/users" | jq '.data.users | length'

# Get specific user
curl -s "http://localhost:3005/api/admin/users/{USER_ID}" | jq '.data'
```

### 2.4 Auth Protection

**All admin APIs require authentication:**
```bash
# Without auth - should return 401
curl -s "http://localhost:3005/api/admin/permissions" | jq '.error'
```

**Expected:** `401 Unauthorized` without auth cookie

---

## 3. UI COMPONENTS AUDIT

### 3.1 Access Control Tab Location

**File:** `src/components/settings/AccessControlTab.tsx`
**Route:** Settings > Access Control

### 3.2 Theme Compliance

**Required CSS variables (check for hardcoded colors):**
```bash
grep -n "bg-white\|bg-gray-50\|bg-gray-100\|text-gray-900\|border-gray-200" src/components/settings/AccessControlTab.tsx
```

**Expected:** Zero results (should use CSS variables like `var(--ff-bg-secondary)`)

### 3.3 Sub-tabs Functionality

| Tab | Features | Status Check |
|-----|----------|--------------|
| **Users** | List, search, filter by role, edit role, toggle active | API: `/api/admin/users` |
| **Roles** | Role list, permission matrix, edit permissions | API: `/api/admin/roles` |
| **Permissions** | Hierarchical tree view with module/page/tab badges | API: `/api/admin/permissions?tree=true` |

### 3.4 Provisioning Button

**Feature:** "Add Staff as Users" button
**API:** `POST /api/admin/users/provision-from-staff`
**Expected behavior:**
1. Creates user records for staff without accounts
2. Maps position to auth role
3. Sets status to pending (no password)
4. Links user to staff record

### 3.5 Visual Checks (Screenshots)

For each tab, verify:
- [ ] Table headers visible
- [ ] Data loads correctly
- [ ] Search/filter works
- [ ] Actions (edit, toggle) respond
- [ ] Badges styled correctly
- [ ] No console errors

---

## 4. PERMISSION ENFORCEMENT AUDIT

### 4.1 Role-Based Access (Current Implementation)

**Files using role checks:**
```bash
grep -rn "withRole\|requireRole" pages/api/ --include="*.ts" | head -20
```

### 4.2 Permission Service Functions

**File:** `src/lib/permissions/index.ts`

| Function | Purpose |
|----------|---------|
| `getPermissions(type?)` | List all/filtered permissions |
| `getPermissionTree()` | Hierarchical structure |
| `getRoles()` | List all roles |
| `getRolePermissions(role)` | Permissions for a role |
| `userHasPermission(userId, key, action)` | Check specific permission |
| `getUserEffectivePermissions(userId)` | All effective permissions |
| `getUserPermissionOverrides(userId)` | User's overrides |
| `grantUserPermission(...)` | Add grant override |
| `revokeUserPermission(...)` | Add revoke override |
| `canViewModule(userId, moduleKey)` | Check module access |
| `canAccessPage(userId, pageKey)` | Check page access |
| `getAccessibleModules(userId)` | Modules user can view |
| `getAccessiblePages(userId, moduleKey)` | Pages in module user can view |

### 4.3 Database Functions

**Verify functions exist:**
```sql
SELECT proname, proargtypes
FROM pg_proc
WHERE proname IN ('user_has_permission', 'get_user_permissions');
```

### 4.4 Permission Enforcement Points (TODO)

**Areas requiring permission checks:**
1. **Sidebar navigation** - Hide inaccessible modules
2. **Tab rendering** - Hide inaccessible tabs
3. **Action buttons** - Disable/hide based on create/edit/delete
4. **API endpoints** - Verify permission before action

---

## 5. QUICK DATABASE CHECKS

### One-Command Schema Check
```bash
DATABASE_URL='postgresql://neondb_owner:$NEON_DB_PASSWORD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require' node -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
(async () => {
  const perms = await sql\`SELECT type, COUNT(*) as c FROM access_permissions WHERE is_active = true GROUP BY type\`;
  const roles = await sql\`SELECT DISTINCT role FROM role_permissions\`;
  const users = await sql\`SELECT role, COUNT(*) as c FROM users GROUP BY role\`;
  console.log('Permissions:', perms);
  console.log('Roles:', roles.map(r => r.role));
  console.log('Users by role:', users);
})();
"
```

---

## 6. AUDIT REPORT TEMPLATE

```markdown
# RBAC System Audit Report
## Date: YYYY-MM-DD HH:MM
## Auditor: Claude Code

---

## Executive Summary
- **Overall Status:** [HEALTHY | ISSUES | CRITICAL]
- **Database:** [OK | ISSUES]
- **APIs:** [OK | ISSUES]
- **UI:** [OK | ISSUES]
- **Enforcement:** [OK | NOT IMPLEMENTED | PARTIAL]

---

## 1. Database
| Check | Status | Notes |
|-------|--------|-------|
| Tables exist | ✅/❌ | |
| Permission count | ✅ N perms | |
| Hierarchy integrity | ✅/❌ | |
| Role permissions seeded | ✅/❌ | |
| Super admin has 'all' | ✅/❌ | |

## 2. API Endpoints
| Endpoint | Status | Response Time |
|----------|--------|---------------|
| GET /api/admin/permissions | ✅ 200 | Xms |
| GET /api/admin/roles | ✅ 200 | Xms |
| GET /api/admin/users | ✅ 200 | Xms |
| POST /api/admin/users/provision-from-staff | ✅ 200 | Xms |

## 3. UI Components
| Feature | Status | Notes |
|---------|--------|-------|
| Users tab | ✅/❌ | |
| Roles tab | ✅/❌ | |
| Permissions tab | ✅/❌ | |
| Theme compliance | ✅/❌ | |
| Provisioning button | ✅/❌ | |

## 4. Permission Enforcement
| Area | Implemented | Notes |
|------|-------------|-------|
| API auth (withRole) | ✅ | Admin routes protected |
| Sidebar hiding | ❌ TODO | |
| Tab hiding | ❌ TODO | |
| Action buttons | ❌ TODO | |

---

## Issues Found
1. **[SEVERITY]** Description - Location

---

## Recommendations
1. Implement sidebar permission filtering using `getAccessibleModules()`
2. Add `usePermission` hook for UI components
3. Apply permission checks to action buttons

---

## Sign-off
- Auditor: Claude Code
- Date: YYYY-MM-DD
```

---

## RELATED DOCUMENTATION

| Resource | Location |
|----------|----------|
| RBAC KB Module | `.claude/modules/rbac.md` |
| Migration SQL | `scripts/migrations/097_access_control.sql` |
| Permission Service | `src/lib/permissions/index.ts` |
| UI Component | `src/components/settings/AccessControlTab.tsx` |
| Full Audit | `.claude/commands/audit.md` |

---

## RBAC ARCHITECTURE REFERENCE

### Database Schema
```
access_permissions (70+ rows)
├── id (UUID)
├── type ('module' | 'page' | 'tab' | 'action')
├── key (unique, hierarchical: 'procurement.sourcing.boq')
├── parent_key (FK to self)
├── label, description, route
└── is_active, sort_order

role_permissions (420+ rows = 6 roles × 70 permissions)
├── id (UUID)
├── role ('super_admin' | 'admin' | 'manager' | 'technician' | 'viewer' | 'contractor')
├── permission_key (FK to access_permissions.key)
└── actions (JSONB: {view, create, edit, delete})

user_permission_overrides
├── id (UUID)
├── user_id (FK to users.id)
├── permission_key (FK to access_permissions.key)
├── override_type ('grant' | 'revoke')
├── actions (JSONB)
├── granted_by, granted_at, expires_at, reason
└── UNIQUE(user_id, permission_key)
```

### Permission Resolution Order
1. Check `users.permissions` for `['all']` → super admin bypass
2. Get `role_permissions` for user's role
3. Check `user_permission_overrides` (grant > revoke)
4. Return effective permission
