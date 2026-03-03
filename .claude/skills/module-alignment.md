---
name: module-alignment
description: Align RBAC permissions, Help Center docs, and Chatbot with new modules
version: 1.0.0
triggers:
  - /align
  - /module-alignment
  - align module
  - align rbac help chatbot
---

# /align - Module Alignment (RBAC + Help Center + Chatbot)

When a new module or major feature is added to FibreFlow, three cross-cutting systems need alignment:
1. **RBAC** — Permission entries in `access_permissions` + `role_permissions`
2. **Help Center** — User manual section in `docs/user-manuals/source/fibreflow-complete.md`
3. **Chatbot** — Topic + quick questions in `ChatWidget.tsx` + data queries in `pages/api/chat/query.ts`

## Usage
```
/align <module-name>              # Align all three systems for a module
/align <module-name> rbac         # RBAC only
/align <module-name> help         # Help center only
/align <module-name> chatbot      # Chatbot only
```

## Workflow

### Step 1: Gap Analysis

Scan the module for existing coverage:

```bash
# Check RBAC entries
grep -r "rbacKey" src/modules/navigation/config/modules/<module>.config.ts

# Check if module has permission entries
# Query: SELECT * FROM access_permissions WHERE key LIKE '<module>%'

# Check help center manual
grep -n "<module>" docs/user-manuals/source/fibreflow-complete.md

# Check chatbot topics
grep -n "<module>" src/modules/help-center/components/ChatWidget.tsx

# Check chatbot queries
grep -n "<module>" pages/api/chat/query.ts

# List API routes
ls pages/api/<module>/
```

### Step 2: RBAC Migration

Create a new migration in `scripts/migrations/sql/`:

```sql
-- Migration NNN: RBAC — <Module Name>

-- Module entry
INSERT INTO access_permissions (type, key, label, description, sort_order) VALUES
    ('module', '<module-key>', '<Module Label>', '<Description>', <sort>)
ON CONFLICT (key) DO NOTHING;

-- Page entries
INSERT INTO access_permissions (type, key, parent_key, label, route, sort_order) VALUES
    ('page', '<module-key>.<page>', '<module-key>', '<Page Label>', '<route>', <sort>)
ON CONFLICT (key) DO NOTHING;

-- Role permissions (9 system roles)
-- super_admin, admin: full CRUD
-- manager, project_manager, site_supervisor: view + create + edit
-- technician, contractor: submit (create/edit on main page), view-only on reports
-- client: view-only on main + reports
-- viewer: view-only on all
```

**Role Permission Matrix Template:**

| Role | Module | Main Page | Reports | Export |
|------|--------|-----------|---------|--------|
| super_admin | CRUD | CRUD | CRUD | CRUD |
| admin | CRUD | CRUD | CRUD | CRUD |
| manager | VCE | VCE | VCE | VCE |
| project_manager | VCE | VCE | VCE | VCE |
| site_supervisor | VCE | VCE | VCE | VCE |
| technician | V | VCE | V | V |
| contractor | V | VCE | V | V |
| client | V | V | V | - |
| viewer | V | V | V | V |

Legend: V=view, C=create, E=edit, D=delete

### Step 3: Update Nav Config

Update `src/modules/navigation/config/modules/<module>.config.ts`:
- Change generic `rbacKey: 'field'` (or similar) to specific keys matching the migration

Update sidebar config (e.g., `src/components/layout/sidebar/config/<section>.ts`):
- Change module-level rbacKey to match the new module permission key

### Step 4: API Route Permission Checks

For each API route in `pages/api/<module>/`:

```typescript
// Before:
import { withAuth } from '@/lib/auth/middleware';
export default withAuth(handler);

// After:
import { withAuth, withPermission } from '@/lib/auth/middleware';
export default withAuth(withPermission('<module-key>.<page>')(handler));
```

**Route → Permission mapping:**
- GET endpoints (read): `<module>.main` or `<module>.<page>` view
- POST/PUT/PATCH (write): `<module>.main` or `<module>.<page>` create/edit
- Export endpoints: `<module>.export` view
- Webhook endpoints (no auth): skip — do not add withPermission

### Step 5: Help Center Manual

Edit `docs/user-manuals/source/fibreflow-complete.md`:

Required sections:
1. **Navigation path** — Sidebar -> Module Name (must match actual sidebar label)
2. **Route** — actual URL path (e.g., `/field-ops`, not `/construction-qa`)
3. **Overview** — module purpose and key capabilities
4. **Dashboard/Main View** — metrics, filters, view modes
5. **Key Workflows** — step-by-step user flows
6. **Access Control** — role permission table matching the RBAC migration

After editing, regenerate:
```bash
npm run embed-manual
```

This updates `src/modules/help-center/data/manual-content.ts` (auto-generated, do not edit manually).

### Step 6: Chatbot Updates

**ChatWidget.tsx** — Add new topic to `TOPICS` array:
```typescript
{ id: '<module-id>', label: '<Module Label>', icon: <IconName className="w-4 h-4" />, color: 'text-<color>-400' },
```

Add quick questions in `getQuickQuestions()`:
```typescript
'<module-id>': [
  'How does <module> work?',
  'How do I <key-action-1>?',
  'How do I <key-action-2>?',
  'What are the <key-feature>?',
],
```

**pages/api/chat/query.ts** — Add pre-defined queries:
```typescript
{
  id: '<module>_summary',
  name: '<Module> Summary',
  description: '<Module> counts by status',
  sql: `SELECT status, COUNT(*) as count FROM <table> GROUP BY status ORDER BY count DESC`,
  format: 'table',
},
```

### Step 7: Build & Verify

```bash
npm run build                    # Type check + build
npm run embed-manual             # Regenerate manual content
```

Verification queries:
```sql
-- Verify RBAC entries
SELECT * FROM access_permissions WHERE key LIKE '<module>%';
SELECT rp.role, rp.permission_key, rp.actions
FROM role_permissions rp
WHERE rp.permission_key LIKE '<module>%'
ORDER BY rp.role, rp.permission_key;
```

## Files Modified (typical)

| File | Change |
|------|--------|
| `scripts/migrations/sql/NNN_<module>_rbac.sql` | NEW — RBAC migration |
| `src/modules/navigation/config/modules/<module>.config.ts` | Update rbacKeys |
| `src/components/layout/sidebar/config/<section>.ts` | Update rbacKey |
| `pages/api/<module>/*.ts` | Add withPermission |
| `docs/user-manuals/source/fibreflow-complete.md` | Add/update section |
| `src/modules/help-center/data/manual-content.ts` | Auto-regenerated |
| `src/modules/help-center/components/ChatWidget.tsx` | Add topic + questions |
| `pages/api/chat/query.ts` | Add data queries |

## Reference

- RBAC schema: `scripts/migrations/097_access_control.sql`
- System roles: `scripts/migrations/120_custom_roles.sql`
- Previous alignment: `scripts/migrations/sql/239_construction_qa_rbac.sql`
- Middleware: `src/lib/auth/middleware.ts` (withAuth, withPermission, withRole)
