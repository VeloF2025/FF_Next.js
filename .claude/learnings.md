# FibreFlow - Global Learnings

> Project-wide learnings that apply across all modules.

---

## 2026-01-26: Unified Architecture - Store Data During Processing, Not During Display

**Issue:** Summary page was making live API calls to BOSS API (1Map) and querying maintenance_tickets table on every page view. This was:
1. Slow (API calls add latency)
2. Confusing (some data from DB, some from live API)
3. Unreliable (API timeouts affect user experience)

**Root Cause:** Architectural inconsistency where some DR data was stored in the unified table during processing, but contact info was fetched live during display.

**Solution:** UNIFIED ARCHITECTURE - ALL DR data should be stored in `dr_photo_unified_reviews` during processing (in `process-new-dr.ts`), then display endpoints simply read from the unified table.

**Migration 131 added these columns:**
```sql
-- Subscriber contact from 1Map
subscriber_name, subscriber_phone, subscriber_email, subscriber_language

-- QContact/Maintenance contact
qcontact_name, qcontact_phone, qcontact_email

-- Staff info from 1Map
signup_agent, installer_name
```

**Pattern to follow:**
```typescript
// ✅ GOOD: Fetch and store during processing (process-new-dr.ts)
const [subscriberContact, qContactInfo] = await Promise.all([
  fetchSubscriberContact(dropNumber),  // BOSS API
  fetchQContactInfo(dropNumber),       // maintenance_tickets
]);

await pool.query(`
  INSERT INTO dr_photo_unified_reviews (
    drop_number, subscriber_name, subscriber_phone, ...
  ) VALUES ($1, $2, $3, ...)
`, [dropNumber, subscriberContact?.subscriber_name, ...]);

// ❌ BAD: Fetch live during display (summary.ts - OLD approach)
const bossData = await fetchBossApiData(dropNumber);  // Live API call on every view
```

**Summary API now simply reads:**
```typescript
// ✅ GOOD: Read from unified table only
const result = await pool.query(`
  SELECT drop_number, subscriber_name, subscriber_phone, ...
  FROM dr_photo_unified_reviews
  WHERE drop_number = $1
`, [dropNumber]);
```

**For existing DRs:** Run `node scripts/backfill-contact-info.js` to populate contact info for DRs processed before this change.

**Key Principle:** The unified table (`dr_photo_unified_reviews`) is the single source of truth for DR data. All data should be stored there during processing, not fetched live during display.

**Affected Files:**
- `pages/api/activate/process-new-dr.ts` - Stores contact info
- `pages/api/activate/summary.ts` - Reads from unified table only
- `pages/api/activate/[dropNumber].ts` - Reads from unified table only
- `scripts/migrations/131_unified_contact_fields.sql` - Added columns
- `scripts/backfill-contact-info.js` - Backfill for existing DRs

### BOSS API Usage Classification

**BOSS API Host:** `http://100.96.203.105:8003` (Docker container on Velocity server)

The BOSS API is a caching layer for 1Map photo data. Here's when to use it:

**✅ LEGITIMATE BOSS API Calls:**

| Endpoint | Purpose | When Called |
|----------|---------|-------------|
| `dr-acknowledgment.ts` | Check if DR exists, get photo count for WhatsApp ack | Once per DR submission |
| `ensure-data.ts` | Download photos before QA review | Once when opening QA Wizard |
| `refresh.ts` | Manual refresh when user clicks "Refresh" | On-demand, user-initiated |
| `process-new-dr.ts` | Fetch photos/contact info during processing | Once during DR processing |
| `photo/[...path].ts` | Serve actual photo images | Every photo display (required) |

**❌ NEVER Call BOSS API From:**

| Endpoint | Why |
|----------|-----|
| `[dropNumber].ts` GET | Page view - use unified table |
| `summary.ts` | Page view - use unified table |
| Any listing/dashboard | Use unified table |

**Key Principle:** BOSS API calls are only legitimate for:
1. **Initial processing** (once per DR)
2. **Photo serving** (images can't be stored in DB)
3. **User-initiated refresh** (explicit action)

Never for passive page views or data display.

---

## 2026-01-22: Use Dev Mode for Local Development

**Issue:** Repeated `ChunkLoadError` and React error #423 when running production build locally (`npm run build && npm start`). After each rebuild, browser tries to load old cached chunk URLs that no longer exist.

**Symptoms:**
- `ChunkLoadError: Loading chunk XXXX failed`
- `React error #423` (hydration mismatch)
- Page stuck loading or shows stale content
- Must hard-refresh (Ctrl+Shift+R) after every rebuild

**Root Cause:** Production builds generate unique chunk hashes (e.g., `runtime-5044df1c70f18193.js`). Browser caches these URLs aggressively. After rebuild, hashes change but browser still requests old URLs → 400 errors.

**Solution:** Use `npm run dev` for local development instead of production mode.

```bash
# ✅ For local development
PORT=3004 npm run dev

# ❌ Avoid for rapid iteration (causes chunk caching issues)
npm run build && PORT=3005 npm start
```

**Benefits of Dev Mode:**
- Hot Module Replacement (HMR) - updates modules in place without full reload
- No chunk caching issues - dev server handles module updates
- Instant refresh on file changes - no manual rebuild needed
- Better error messages (not minified)
- Source maps for debugging

**When to Use Production Mode:**
- Final testing before deploy
- Performance testing
- Reproducing production-only bugs

**Affected Areas:** All modules - this is a Next.js/webpack behavior, not module-specific.

---

## 2026-01-22: Null-Safe Search Pattern (TODO: Global Implementation)

**Issue:** Search functionality crashed with `TypeError: Cannot read properties of undefined (reading 'toLowerCase')` when filtering data with potentially null/undefined fields.

**Bad Pattern:**
```typescript
// ❌ Crashes if member.name or member.employeeId is undefined
const filtered = staff.filter(member => {
  return member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
         member.employeeId.toLowerCase().includes(searchTerm.toLowerCase());
});
```

**Good Pattern:**
```typescript
// ✅ Null-safe search with early return and optional chaining
const filtered = staff.filter(item => {
  const search = searchTerm.toLowerCase();
  return !searchTerm ||  // Early return if no search term
    item.name?.toLowerCase().includes(search) ||
    item.employeeId?.toLowerCase().includes(search) ||
    item.email?.toLowerCase().includes(search) ||
    item.phone?.toLowerCase().includes(search) ||
    item.position?.toLowerCase().includes(search) ||
    item.department?.toLowerCase().includes(search);
});
```

**Key Principles:**
1. **Always use optional chaining (`?.`)** on any field that could be null/undefined
2. **Early return for empty search** - `!searchTerm ||` prevents unnecessary processing
3. **Search multiple fields** - name, ID, email, phone, position, department for better UX
4. **Case insensitive** - convert both search term and values to lowercase

**TODO: Audit and fix search in these pages:**
- [ ] `/staff` - ✅ Fixed (2026-01-22)
- [ ] `/projects` - needs audit
- [ ] `/suppliers` - needs audit
- [ ] `/contractors` - needs audit
- [ ] `/clients` - needs audit
- [ ] `/fleet/vehicles` - needs audit
- [ ] `/assets` - needs audit
- [ ] `/procurement/*` tables - needs audit
- [ ] Any DataGrid/table with search functionality

**Affected Areas:** All list pages with search/filter functionality.

---

## 2026-01-25: Database Connection Pattern - Use Inline pg Pool

**Issue:** Using `import db from '@/lib/db'` and `db.connect()` causes runtime errors in production builds:
```
TypeError: s.default.connect is not a function
```

**Root Cause:** The `lib/db.ts` default export doesn't work correctly when compiled. The minified code (`s.default.connect`) fails to resolve the Pool's connect method.

**Bad Pattern:**
```typescript
// ❌ Causes runtime errors in production
import db from '@/lib/db';

async function handler(req, res) {
  const client = await db.connect();  // TypeError: s.default.connect is not a function
  // ...
}
```

**Good Pattern:**
```typescript
// ✅ Works reliably in production
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function handler(req, res) {
  const client = await pool.connect();
  try {
    // ... use client
  } finally {
    client.release();
  }
}
```

**Key Points:**
1. **Use inline Pool from 'pg'** - not the lib/db module
2. **Always use SSL** - `ssl: { rejectUnauthorized: false }` for Neon
3. **Always release client** - in finally block to prevent connection leaks
4. **Use HTTP, not WebSocket** - `pg` driver uses HTTP which is stable; `@neondatabase/serverless` uses WebSocket which fails when database sleeps

**When to use each driver:**
- `pg` (HTTP) - Stable, recommended for API routes
- `@neondatabase/serverless` (WebSocket) - Only if you need real-time/streaming features and can handle connection drops

**Affected Areas:** All API routes that need database connections, especially in `/pages/api/`.

---

## 2026-01-25: Config Lookup Fallback Pattern

**Issue:** `TypeError: Cannot read properties of undefined (reading 'icon')` when accessing properties from a config lookup where the key doesn't exist.

**Root Cause:** Using a config object to map status/type values to display properties without handling unknown values.

**Bad Pattern:**
```typescript
// ❌ Crashes if vehicle.status is not in statusConfig
const statusConfig = {
  active: { label: 'Active', icon: Car },
  maintenance: { label: 'Maintenance', icon: Wrench },
  retired: { label: 'Retired', icon: XCircle },
};

const status = statusConfig[vehicle.status];
const StatusIcon = status.icon;  // TypeError if status is undefined
```

**Good Pattern:**
```typescript
// ✅ Fallback for unknown values
const status = statusConfig[vehicle.status as keyof typeof statusConfig] || {
  label: vehicle.status || 'Unknown',
  color: 'bg-gray-100 text-gray-800',
  icon: Car,  // Default icon
};
const StatusIcon = status.icon;  // Always defined
```

**Key Points:**
1. **Always provide a fallback** when using config lookups with dynamic keys
2. **Use the raw value as label** - `vehicle.status || 'Unknown'` shows actual value
3. **Neutral styling for unknowns** - gray color indicates unexpected state
4. **Default icon** - use a sensible default that won't look broken

**Also Consider:**
- Database cleanup: Fix inconsistent values at the source (e.g., `inactive` → `retired`)
- Add new values to config if they're legitimate statuses

**Affected Areas:** Any component using config objects for status/type display (vehicles, projects, staff, etc.).

---

## 2026-01-25: Users Table Schema - Use first_name/last_name, Not name

**Issue:** `column "name" does not exist` or `column et.name does not exist` when querying users table for display names.

**Root Cause:** The `users` table has `first_name` and `last_name` columns, NOT a `name` column. This is a common mistake when writing queries that JOIN to the users table.

**Bad Pattern:**
```typescript
// ❌ Crashes - column "name" doesn't exist
const result = await client.query(`
  SELECT id, email, name FROM users WHERE role = 'admin'
`);

// ❌ Crashes when joining
const result = await client.query(`
  SELECT m.*, u.name as assigned_to_name
  FROM records m
  LEFT JOIN users u ON m.assigned_to = u.id
`);
```

**Good Pattern:**
```typescript
// ✅ Use COALESCE with first_name and last_name
const result = await client.query(`
  SELECT id, email, first_name, last_name,
         COALESCE(first_name || ' ' || last_name, first_name, last_name, email) as display_name
  FROM users
  WHERE role = 'admin'
`);

// ✅ Same pattern for JOINs
const result = await client.query(`
  SELECT m.*,
         COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.last_name, u.email) as assigned_to_name
  FROM records m
  LEFT JOIN users u ON m.assigned_to = u.id
`);
```

**COALESCE Explained:**
The pattern `COALESCE(first_name || ' ' || last_name, first_name, last_name, email)` handles all cases:
1. Both names exist: "John Smith"
2. Only first_name: "John"
3. Only last_name: "Smith"
4. Neither name: falls back to email

**Users Table Schema:**
```sql
users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),  -- NOT "name"
  last_name VARCHAR(100),
  role VARCHAR(50),  -- 'admin', 'manager', 'user'
  is_active BOOLEAN DEFAULT true,
  ...
)
```

**Affected Areas:** Any API route or query that JOINs to the users table or needs to display user names. Common cases:
- Escalation lookups (escalated_to, escalated_by)
- Assignment lookups (assigned_to, created_by)
- Audit trails (modified_by, approved_by)
- Admin user dropdowns

---

## 2026-01-26: Tab-Based Navigation Pattern

**Context:** FibreFlow modules are migrating from sidebar sub-items to horizontal tab navigation at the top of each page. This provides a cleaner UI and better module organization.

**Architecture:**

```
src/modules/navigation/           # Navigation system
├── config/
│   ├── modules/                  # Per-module tab configs
│   │   ├── maintenance.config.ts
│   │   └── [module].config.ts
│   ├── registry.ts               # Module registration
│   └── index.ts                  # Exports
├── components/
│   ├── ModuleTabs.tsx            # Horizontal tab bar
│   └── SubTabs.tsx               # Sub-tab navigation
├── hooks/
│   └── useModuleTabs.ts          # Tab state management
└── types.ts                      # TypeScript types

src/components/module-page/       # Page wrapper
├── ModulePage.tsx                # Unified page wrapper
├── ModuleHeader.tsx              # Header with icon/title/actions
└── types.ts
```

**Module Config Pattern:**

```typescript
// src/modules/navigation/config/modules/[module].config.ts
import type { ModuleNavigationConfig } from '../../types';

export const [module]Config: ModuleNavigationConfig = {
  moduleId: '[module]',
  moduleName: '[Module Name]',
  description: '[Description]',
  basePath: '/[module]',
  icon: ModuleIcon,
  tabs: [
    { id: 'dashboard', label: 'Dashboard', icon: Icon, path: '/[module]' },
    { id: 'sub-page', label: 'Sub Page', icon: Icon, path: '/[module]/sub-page' },
  ],
};
```

**Page Wrapper Pattern:**

```typescript
// app/(main)/[module]/[page]/client.tsx
import { ModulePage } from '@/components/module-page';
import { [module]Config } from '@/modules/navigation';

export default function PageClient() {
  const headerActions = <button>Action</button>;  // Optional

  return (
    <ModulePage config={[module]Config} headerActions={headerActions}>
      <div>{/* Page content */}</div>
    </ModulePage>
  );
}
```

**Sidebar Reduction:**

```typescript
// Before: 7 items
items: [
  { to: '/module', label: 'Dashboard' },
  { to: '/module/page1', label: 'Page 1' },
  // ... 5 more items
]

// After: 1 item (tabs handle sub-navigation)
items: [
  { to: '/module', label: 'Module Name', icon: ModuleIcon },
]
```

**Key Files:**
| Component | Location |
|-----------|----------|
| ModulePage | `src/components/module-page/ModulePage.tsx` |
| ModuleTabs | `src/modules/navigation/components/ModuleTabs.tsx` |
| useModuleTabs | `src/modules/navigation/hooks/useModuleTabs.ts` |
| Configs | `src/modules/navigation/config/modules/*.config.ts` |

**Reference Implementation:**
- Module: Maintenance
- Commit: `96ea3f84` - feat(maintenance): migrate to horizontal tab navigation
- Skill: `/navigation` - Full migration process

**Affected Areas:** All modules being migrated to tab-based navigation. Current status:
- [x] Maintenance - Completed (2026-01-26)
- [x] Activate - Completed (2026-01-26) - Dashboard, QA Centre, Reports tabs
- [x] Assets - Completed (2026-01-26)
- [ ] Procurement - Pending
- [ ] Fleet - Pending
- [ ] Projects - Pending
- [ ] HR/Staff - Pending

---

## 2026-01-26: API Response Structure Must Match Component Expectations

**Issue:** `Cannot read properties of undefined (reading 'filter')` when clicking the Team tab on Project Detail page.

**Root Cause:** The API returned a flat array but the component expected a structured object with `members`, `stats`, and `primaryManager` properties.

**Bad Pattern (API):**
```typescript
// ❌ Returns flat array - component will crash trying to access .members
const response = teamMembers.map(member => ({...}));
return apiResponse.success(res, response);
```

**Good Pattern (API):**
```typescript
// ✅ Returns structured object matching component expectations
const members = teamMembers.map(member => ({...}));
const primaryManager = members.find(m => m.is_primary) || null;
const stats = {
  staff: members.filter(m => m.person_type === 'staff').length,
  contractors: members.filter(m => m.person_type === 'contractor').length,
  total: members.length,
};
return apiResponse.success(res, { primaryManager, members, stats });
```

**Component Defensive Pattern:**
```typescript
// ✅ Always add defensive null checks even when API should return correct structure
const members = teamData.members || [];
const stats = teamData.stats || { staff: 0, contractors: 0, total: 0 };
const filteredMembers = members.filter(m => ...);
```

**Key Learnings:**
1. **Document API response shape** in component interfaces
2. **Add defensive defaults** for all nested properties
3. **Test API responses** before building UI components
4. **Match snake_case vs camelCase** - be consistent (this codebase uses snake_case for DB fields)

**Affected Areas:** All new tab components that consume project APIs:
- `ProjectTeamTab.tsx` - uses `/api/projects/[projectId]/team`
- `ProjectProcurementTab.tsx` - uses `/api/projects/[projectId]/procurement-summary`
- `ProjectMaintenanceTab.tsx` - uses `/api/projects/[projectId]/maintenance-summary`

---

## 2026-01-26: Project Hub Database Views

**Context:** Sprint 1 created two database views for unified project data:

**v_project_team View:**
```sql
-- Unified staff + contractors for a project
SELECT
  sp.project_id,
  sp.staff_id::text as person_id,
  'staff' as person_type,
  COALESCE(s.first_name || ' ' || s.last_name, 'Unknown') as name,
  s.email, s.phone, sp.role,
  sp.is_active, sp.is_primary
FROM staff_projects sp
JOIN staff s ON s.id = sp.staff_id
UNION ALL
SELECT
  cp.project_id,
  cp.contractor_id::text as person_id,
  'contractor' as person_type,
  c.company_name as name,
  c.email, c.phone, cp.role,
  cp.is_active, cp.is_primary_contractor as is_primary
FROM contractor_projects cp
JOIN contractors c ON c.id = cp.contractor_id;
```

**PM Tracking Pattern:**
- Old: `projects.project_manager` (UUID to staff)
- New: `staff_projects.is_primary` (boolean flag)

Benefits:
- Single source of truth in junction table
- Supports multiple PMs per project if needed
- Works with unified team view

**Migration Reference:**
- Migration: `scripts/migrations/130_system_integration.sql`
- PM Migration: `scripts/migrations/run-pm-migration.js`

---

## 2026-01-26: Nokia OES Format Change - Stack Ref. Column Added

**Issue:** OES import preview showed wrong data - Status displayed dB values (`-26.21`), Team displayed coordinates (`-21.307682`).

**Root Cause:** Nokia changed their OES Excel report format - added "Stack Ref." column at position E (index 4), shifting all subsequent columns by 1.

**Old Format (13 columns):**
```
A: Drop Number, B: Serial, C: Timestamp, D: OLT Address,
E: ONT Rx SIG, F: Link Budget ONT→OLT, G: OLT Rx SIG, H: Link Budget OLT→ONT,
I: Status, J: Latitude, K: Longitude, L: Current ONT RX, M: Team
```

**New Format (14 columns) - Jan 2026:**
```
A: Drop Number, B: Serial, C: Timestamp, D: OLT Address,
E: Stack Ref. ← NEW!
F: ONT Rx SIG, G: Link Budget ONT→OLT, H: OLT Rx SIG, I: Link Budget OLT→ONT,
J: Status, K: Latitude, L: Longitude, M: Current ONT RX, N: Team
```

**Fix Applied:**
1. Updated column indices in `parseOESExcel()` (row[4] → row[5], etc.)
2. Added `stack_ref` field to OESRow interface
3. Added `stack_ref VARCHAR(100)` column to `oes_activations` table
4. Updated INSERT/UPSERT query to include `stack_ref`

**Reference:**
- File: `pages/api/activate/import-oes.ts`
- Commit: `79e97a07` - fix(oes-import): update parser for new Nokia OES format with Stack Ref column

**Lesson:** When external data sources change format, check column positions first. The preview showing numeric values in text fields is a clear sign of column misalignment.

---

## 2026-01-26: Excel Import Validation Pattern

**Context:** All Excel imports (OES, ARCH, OLT Report) now have format validation to detect column misalignment before data corruption occurs.

**Validation Pattern:**

```typescript
// 1. Define expected headers
const EXPECTED_HEADERS = ['Drop Number', 'Serial Number', 'Status', 'Team'];

// 2. Validate headers at key positions
function validateHeaders(headers: string[]): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // Check column count
  if (headers.length < 14) {
    warnings.push(`Column count mismatch: expected 14, got ${headers.length}`);
  }

  // Check key header positions contain expected keywords
  const expectedAt = { 0: 'drop', 9: 'status', 13: 'team' };
  for (const [idx, keyword] of Object.entries(expectedAt)) {
    if (!headers[+idx]?.toLowerCase().includes(keyword)) {
      warnings.push(`Column ${idx}: expected "${keyword}", got "${headers[+idx]}"`);
    }
  }

  return { valid: warnings.length === 0, warnings };
}

// 3. Validate data sample for alignment issues
function validateDataSample(rows: Row[]): string[] {
  const warnings: string[] = [];
  const sampleSize = Math.min(10, rows.length);

  let badStatusCount = 0;
  for (let i = 0; i < sampleSize; i++) {
    // Status should be text like "Active", not numeric like "-26.21"
    if (!isNaN(parseFloat(rows[i].status))) badStatusCount++;
  }

  if (badStatusCount > sampleSize / 2) {
    warnings.push(`⚠️ Status contains numeric values. Columns may be misaligned!`);
  }

  return warnings;
}
```

**API Response Pattern:**
```typescript
return res.status(200).json({
  success: true,
  preview: rows,
  totalRows: rows.length,
  warnings: warnings.length > 0 ? warnings : undefined,
  headerMismatch,
});
```

**UI Display Pattern:**
```tsx
{formatWarnings.length > 0 && (
  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-lg p-4">
    <AlertTriangle className="w-5 h-5 text-amber-600" />
    <h4>Format Validation Warnings</h4>
    <ul>
      {formatWarnings.map((w, i) => <li key={i}>{w}</li>)}
    </ul>
  </div>
)}
```

**Files with validation:**
- `pages/api/activate/import-oes.ts` - OES Import (14 columns)
- `pages/api/activate/import-offline.ts` - ARCH Import (Summary/Audit formats)
- `pages/api/system/olt-report/import.ts` - OLT Report (22+ columns)

**Key Detection Patterns:**
| Issue | Detection |
|-------|-----------|
| Column count changed | `headers.length !== expected` |
| Column shifted | Numeric value in text field |
| Wrong format | Missing expected keywords in headers |
| Coordinate in text field | `/^-?\d+\.\d+$/` matches team/status |

---

## 2026-01-26: Type Casting in PostgreSQL JOINs

**Issue:** `operator does not exist: text = uuid` or `operator does not exist: character varying = uuid` when joining tables with mismatched ID column types.

**Root Cause:** Some tables store `project_id` as UUID, others as TEXT or VARCHAR. PostgreSQL requires explicit casting.

**Bad Pattern:**
```sql
-- ❌ Fails if maintenance_tickets.project_id is TEXT but projects.id is UUID
SELECT * FROM maintenance_tickets mt
JOIN projects p ON mt.project_id = p.id
```

**Good Pattern:**
```sql
-- ✅ Cast both sides to text for safe comparison
SELECT * FROM maintenance_tickets mt
JOIN projects p ON mt.project_id::text = p.id::text
```

**Affected Tables (project_id column types):**
- `projects.id` - UUID
- `staff_projects.project_id` - UUID
- `maintenance_tickets.project_id` - TEXT
- `rfqs.project_id` - VARCHAR

**Best Practice:** When creating views that join across multiple tables, always cast to `::text` for safety.

---

## 2026-01-26: CSS Variables Pattern for Component Styling

**Issue:** Components using hardcoded Tailwind dark mode classes (`bg-white dark:bg-gray-800`) created inconsistency when the design system evolved.

**Root Cause:** Hardcoded color values scattered across components make theme changes difficult and create visual inconsistencies.

**Bad Pattern:**
```tsx
// ❌ Hardcoded dark mode classes - hard to maintain
<div className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
  <span className="text-gray-900 dark:text-white">Primary</span>
  <span className="text-gray-600 dark:text-gray-400">Secondary</span>
</div>
```

**Good Pattern:**
```tsx
// ✅ CSS variables - centralized theme control
<div className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
  <span className="text-[var(--ff-text-primary)]">Primary</span>
  <span className="text-[var(--ff-text-secondary)]">Secondary</span>
</div>
```

**FibreFlow CSS Variables:**
| Variable | Light Mode | Dark Mode | Usage |
|----------|------------|-----------|-------|
| `--ff-bg-primary` | white | gray-900 | Page background |
| `--ff-bg-secondary` | white | gray-800 | Card backgrounds |
| `--ff-bg-tertiary` | gray-50 | gray-900/50 | Nested backgrounds, table headers |
| `--ff-text-primary` | gray-900 | white | Headings, main text |
| `--ff-text-secondary` | gray-600 | gray-400 | Labels, descriptions |
| `--ff-text-tertiary` | gray-400 | gray-500 | Muted text, placeholders |
| `--ff-border-light` | gray-200 | gray-700 | Card borders, dividers |
| `--ff-primary-500` | blue-600 | blue-500 | Primary actions, links |

**When to Keep Semantic Colors:**
Status indicators should stay as Tailwind classes (not CSS variables):
- `text-blue-500` - Installed count
- `text-purple-500` - Activated count
- `text-yellow-500` - Pending/Warning
- `text-green-500` - Success/Reviewed
- `text-red-500` - Error/Failed

**Reference:**
- Commit: `2645549f` - fix(activate): update DrListPage styling to match UI theme spec
- File: `src/modules/activate/components/DrListPage.tsx`

---

## 2026-01-26: ModulePage Content Wrapper Pattern

**Issue:** Double padding when components wrap their own content in padded containers, but ModulePage already provides `p-6` padding.

**Root Cause:** Content components were designed before ModulePage existed, and had their own outer padding/background.

**Bad Pattern:**
```tsx
// ❌ Component has its own padding - creates double padding inside ModulePage
function MyComponent() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* content */}
      </div>
    </div>
  );
}
```

**Good Pattern:**
```tsx
// ✅ Component uses space-y-6 for internal spacing only
function MyComponent() {
  return (
    <div className="space-y-6">
      {/* ModulePage provides p-6 padding, bg comes from layout */}
      <Card>...</Card>
      <Card>...</Card>
    </div>
  );
}
```

**ModulePage Structure:**
```tsx
<ModulePage config={moduleConfig}>
  {/* Header with icon, title, description */}
  {/* Tab navigation with px-6 */}
  <div className="p-6">  {/* Content area - padding provided here */}
    {children}           {/* Your component goes here - NO outer padding needed */}
  </div>
</ModulePage>
```

**Checklist When Converting to ModulePage:**
1. Remove outer `min-h-screen bg-* p-*` wrapper
2. Remove `max-w-7xl mx-auto` container (unless specifically needed)
3. Use `space-y-6` for vertical spacing between sections
4. Keep card/section backgrounds (`bg-[var(--ff-bg-secondary)]`)

**Reference:**
- Component: `src/components/module-page/ModulePage.tsx`
- Example: `src/modules/activate/components/DrListPage.tsx`

---

## 2026-01-26: Route Restructuring with Redirect Pages

**Context:** FibreFlow is consolidating project-related modules under `/projects/` namespace for cleaner URL structure.

**Pattern:** Old routes become simple redirect pages, new routes contain the actual content.

**Redirect Page Pattern:**
```tsx
// pages/health-safety/index.tsx (OLD location - now a redirect)
import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/projects/health-safety',
      permanent: true,  // 301 redirect for SEO
    },
  };
};

export default function RedirectPage() {
  return null;  // Never rendered
}
```

**New Page Location:**
```tsx
// pages/projects/health-safety/index.tsx (NEW location)
import { HealthSafetyDashboard } from '@/modules/health-safety/components';

export default function HealthSafetyPage() {
  return <HealthSafetyDashboard />;
}
```

**Route Restructuring Map:**
| Old Route | New Route | Status |
|-----------|-----------|--------|
| `/health-safety/*` | `/projects/health-safety/*` | ✅ Completed |
| `/pipeline/*` | `/projects/pipeline/*` | ✅ Completed |
| `/daily-progress` | `/projects/progress` | ✅ Completed |
| `/tasks` | `/projects/tasks` | ✅ Completed |

**Benefits:**
1. **SEO Friendly** - 301 redirects preserve link juice
2. **Backwards Compatible** - Old bookmarks/links still work
3. **Clean Namespace** - Related modules grouped under `/projects/`
4. **Gradual Migration** - Can migrate one module at a time

**Sidebar Update:**
When restructuring routes, update sidebar config to point to new locations:
```typescript
// src/components/layout/sidebar/config/projectSection.ts
items: [
  { to: '/projects/health-safety', label: 'Health & Safety' },  // Not /health-safety
  { to: '/projects/pipeline', label: 'Pipeline' },              // Not /pipeline
]
```

**Reference:**
- Commit: `4268067f` - refactor(routes): move Health & Safety and Pipeline under /projects
- Navigation Config: `src/modules/navigation/config/modules/projects.config.ts`

---

## 2026-01-26: Filter-Aware CSV Export Pattern

**Context:** All CSV/Excel exports should reflect the current filter state and include filter info in the filename.

**Pattern Components:**

1. **Dynamic Button Text** - Shows what's being exported:
```tsx
// In header/toolbar component
const hasFilters = filter?.status || filter?.type || filter?.searchTerm;
const exportLabel = hasFilters
  ? `Export ${filter?.status || 'Filtered'}`
  : 'Export All';

<button onClick={onExport} title={`Export ${hasFilters ? 'filtered' : 'all'} data to CSV`}>
  <Download className="h-4 w-4" />
  {exportLabel}
</button>
```

2. **Descriptive Filename** - Includes active filters:
```typescript
// In export handler
const filterParts: string[] = [];
if (filter.status) filterParts.push(filter.status);
if (filter.department) filterParts.push(filter.department.replace(/\s+/g, '-'));
if (filter.searchTerm) filterParts.push('search');
const filterSuffix = filterParts.length > 0 ? `-${filterParts.join('-')}` : '-all';
a.download = `staff${filterSuffix}-${new Date().toISOString().split('T')[0]}.csv`;
// Result: "staff-active-Engineering-2026-01-26.csv"
```

3. **API-Side Filtering** (if export via API endpoint):
```typescript
// pages/api/module/export.ts
const filterParts: string[] = [];
if (filters.direction) filterParts.push(filters.direction);
if (filters.status) filterParts.push(filters.status);
if (filters.project) filterParts.push(filters.project.replace(/\s+/g, '-'));

const filterSuffix = filterParts.length > 0 ? `-${filterParts.join('-')}` : '-all';
const filename = `module_export${filterSuffix}-${new Date().toISOString().split('T')[0]}.csv`;

res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
```

**Components Updated (2026-01-26):**
| Module | Component | Filter Fields |
|--------|-----------|---------------|
| Staff | StaffList, StaffListHeader | status, department, position |
| Clients | ClientList, ClientListHeader | status, type |
| Projects | ProjectList, ProjectListHeader | status, priority |
| WA Logs | LogsTab, export.ts API | direction, status, project, drop_number |
| Activate DR List | DrListPage | statusFilter, projectFilter |
| Serial Mismatch | SerialMismatchReports | status, team, zone |
| Serial Swap | SerialSwapReports | status |
| Offline Devices | OfflineDevicesReports | zone, bucket, matchStatus, serialMismatchOnly |

**Reference Commit:** `51dbdd1e` - feat(exports): add filter-aware CSV exports across all modules

**Key Principles:**
1. **Export what's shown** - The exported data should match what the user sees on screen
2. **Filename tells the story** - User can identify export contents from filename alone
3. **Dynamic button feedback** - User knows what they're exporting before clicking
4. **Pass filters to header** - Header component needs filter state for dynamic button text

---

## 2026-01-26: Access Control System - Settings vs Dedicated Page

**Context:** FibreFlow has a comprehensive RBAC (Role-Based Access Control) system accessible at Settings > Access Control tab.

**Location:** `/settings` → Access Control tab (NOT a separate page in System section)

**Components:**
| Component | Location | Purpose |
|-----------|----------|---------|
| `AccessControlTab.tsx` | `src/components/settings/AccessControlTab.tsx` | Main 1089-line RBAC UI |
| `UserPermissionsModal` | Inside AccessControlTab | Individual user permission overrides |
| Settings page | `src/pages/Settings.tsx` | Tab container |

**Three Sub-Tabs:**

1. **Users (61)** - User management
   - Search, filter by role/status
   - Role dropdown selector (immediate change)
   - "Permissions" button opens individual override modal
   - "Deactivate" action

2. **Roles (9)** - Role permission matrix
   - Role list with user counts
   - Permission grid: VIEW | CREATE | EDIT columns
   - Editable checkboxes per permission
   - Super Admin is not editable (71 permissions)

3. **Permissions** - Permission hierarchy tree
   - 12 modules: Dashboard, Projects, Activations, Field Operations, Maintenance, People, Clients, Contractors, Procurement, Assets, Fleet, Communications
   - Expandable to show sub-permissions

**Role Hierarchy (levels):**
```
6: super_admin (all permissions, not editable)
5: system
4: admin (Administrator)
3: manager
2: technician (Field Technician)
1: viewer
```

**Individual Permission Overrides:**
The `UserPermissionsModal` allows granting/revoking specific permissions beyond the user's role:
- From Role (checkbox) - inherited from role
- Custom Grant (green) - manually granted
- Custom Revoke (red X) - manually revoked
- No Access (unchecked)
- Auto-save functionality
- "Show only custom overrides" filter

**Database Tables:**
| Table | Purpose |
|-------|---------|
| `access_permissions` | Permission definitions |
| `role_permissions` | Role-to-permission mappings |
| `user_permission_overrides` | Individual user grants/revokes with expiry |

**APIs:**
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/permissions` | GET | List all permissions (flat or tree) |
| `/api/admin/roles` | GET | List roles with permissions |
| `/api/admin/users/[userId]/permissions` | GET/POST/DELETE | User permission overrides |

**Key Learning:** Don't create duplicate Access Control pages. The functionality already exists in Settings.

**Reference Files:**
- `src/components/settings/AccessControlTab.tsx` - Main component (1089 lines)
- `src/lib/permissions/index.ts` - Permission service
- `src/lib/auth/middleware.ts` - Auth middleware with `withAuth`, `withRole`, `withPermission`

---

## 2026-01-26: Settings Page Full-Width for Data Tables

**Issue:** Access Control tab data table was constrained by `max-w-4xl` container, making the user table cramped.

**Solution:** Conditionally remove width constraints for tabs that need full width (like data tables).

**Pattern:**
```tsx
// src/pages/Settings.tsx
const isFullWidth = activeTab === 'access';

return (
  <div className={`p-6 ${isFullWidth ? '' : 'max-w-4xl mx-auto'}`}>
    {renderTabContent()}
  </div>
);
```

**When to Use Full Width:**
- Data tables with many columns
- Complex forms with side-by-side layouts
- Permission matrices

**When to Keep Constrained:**
- Simple forms (General settings)
- Theme selection
- Toggle lists

---

## 2026-01-26: Photo Fetching API Architecture (BOSS API)

**Current Implementation**: All photo fetching goes through the BOSS API Docker container on Velocity server.

**BOSS API Host:** `http://100.96.203.105:8003`

**API Endpoints Used:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/record/{dropNumber}` | GET | Get DR metadata (photo list, serials, status) |
| `/api/download/{dropNumber}` | POST | Trigger photo download from 1Map cloud to local cache |
| `/api/photo/{dropNumber}/{filename}` | GET | Serve actual photo file |
| `/health` | GET | Health check |

**Data Flow:**
```
1Map Cloud → BOSS API (caching layer) → FibreFlow APIs → Browser
    ↓                   ↓
  Source          Local cache at:
                  /var/lib/docker/volumes/boss_dr_photos/_data/{DR}/
```

**Files using BOSS API:**

| File | Endpoint Used | When |
|------|---------------|------|
| `dr-acknowledgment.ts` | `/api/record/` | DR submission (check photo count) |
| `process-new-dr.ts` | `/api/record/` | Initial processing |
| `ensure-data.ts` | `/api/record/`, `/api/download/` | QA Wizard open (sync new photos) |
| `refresh.ts` | `/api/record/`, `/api/download/` | User-initiated refresh |
| `fetch-photos.ts` | `/api/record/`, `/api/download/` | Legacy photo fetch |
| `extract-data.ts` | `/api/photo/` | VLM data extraction (actual image URLs) |
| `photo/[...path].ts` | `/api/photo/` | Photo proxy (serves to browser) |
| `health-check.ts` | `/health` | System health check |
| `photoFetchService.ts` | `/api/record/`, `/api/download/` | Service layer with retry logic |

**Environment Variable:**
```bash
ONEMAP_HOST=http://100.96.203.105:8003  # Default if not set
BOSS_API_HOST=http://100.96.203.105:8003  # Alias used in some files
VELOCITY_PHOTO_URL=http://100.96.203.105:8003  # For photo proxy
```

**Note:** "BOSS API", "ONEMAP_HOST", and "Velocity Photo API" all refer to the same service - the Docker container on Velocity that caches 1Map data.

---

## 2026-01-26: Unified WhatsApp Bridge Architecture

**Context:** Consolidated two separate WhatsApp services (sender on 8081, receiver/bridge on 8083) into a single unified service on port 8083.

**Why Unified?**
1. Single service handles both sending AND receiving
2. Groups managed via database (`wa_monitored_groups`), not hardcoded
3. No service restart needed to add new groups (use `/reload-groups`)
4. Reduced complexity and potential for session conflicts

**Architecture:**
```
                    ┌─────────────────────────────────────────────────────┐
                    │           UNIFIED BRIDGE (VPS:8083)                 │
                    │              +27 63 841 2276                        │
                    ├─────────────────────────────────────────────────────┤
FibreFlow APIs ───► │  SEND                    │  RECEIVE                │
wa-feedback:8092    │  • /send-message         │  • DR submissions       │
                    │  • /delete-message       │  • Maintenance photos   │
                    │  • /react                │  • Admin commands       │
                    │  • /groups               │                         │
                    │  • /reload-groups        │                         │
                    └─────────────────────────────────────────────────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
              SQLite (local)        Neon DB               Command Bot
              messages.db        wa_monitored_groups        (8086)
```

**Key Services:**

| Service | Server | Port | Purpose |
|---------|--------|------|---------|
| `whatsapp-bridge` | VPS (72.61.197.178) | 8083 | Unified send + receive |
| `wa-command-bot` | VPS | 8086 | WhatsApp admin commands |
| `wa-feedback` | Velocity (100.96.203.105) | 8092 | Proxy to VPS bridge |
| ~~`whatsapp-sender`~~ | ~~VPS~~ | ~~8081~~ | **DISABLED** - merged into bridge |

**Unified Bridge Endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check with connection status |
| `/send-message` | POST | Send message with @mention support |
| `/delete-message` | POST | Delete sent message (within 1 hour) |
| `/react` | POST | Send emoji reaction (👍 or ❌) |
| `/groups` | GET | List monitored groups from database |
| `/reload-groups` | GET | Reload groups from DB without restart |
| `/list-recent` | GET | List deletable messages from last hour |

**DB-Driven Groups Pattern:**

Groups are stored in `wa_monitored_groups` table and loaded into memory at startup:

```go
type MonitoredGroup struct {
    ID          string
    GroupJID    string    // e.g., "120363418298130331@g.us"
    GroupName   string    // e.g., "Lawley"
    ProjectName string    // e.g., "Lawley"
    GroupType   string    // "dr_submission", "maintenance", "admin"
    Description string
    IsActive    bool
}
```

**Group Types:**
- `dr_submission` - DR photo submissions → processed and acknowledged
- `maintenance` - Maintenance photos → 👍 reaction on success, ❌ on failure
- `admin` - WhatsApp commands only (for wa-command-bot)

**Adding New Groups:**

1. **Via FibreFlow UI:** `/communications/whatsapp` → Groups tab
2. **Via Direct SQL:**
```sql
INSERT INTO wa_monitored_groups (group_jid, group_name, project_name, group_type, description)
VALUES ('120363XXXXXXXXXX@g.us', 'Group Name', 'Project', 'dr_submission', 'Description');
```
3. **Reload without restart:**
```bash
curl http://72.61.197.178:8083/reload-groups
```

**Finding Group JID:**
1. Add the bridge phone (+27 63 841 2276) to the WhatsApp group
2. Send any message in the group
3. Check bridge logs: `ssh root@72.61.197.178 "tail -20 /opt/whatsapp-bridge/bridge.log"`
4. Look for line: `📝 Storing message from GROUP_JID`

**Fallback Behavior:**
The bridge has a hardcoded `PROJECTS` map as fallback if DB is unreachable. DB-loaded groups take priority.

**Key Files:**
| File | Location | Purpose |
|------|----------|---------|
| `main.go` | `/home/louis/whatsapp-bridge-go/` (Velocity) | Bridge source code |
| `whatsapp-bridge` | `/opt/whatsapp-bridge/` (VPS) | Compiled binary |
| `wa-feedback-service.js` | `/home/louis/wa-feedback-service/` (Velocity) | Proxy service |
| `wa-monitor.md` | `.claude/modules/` | Full documentation |

**Reference:**
- Plan: `.claude/plans/toasty-jumping-pearl.md` (Unified WhatsApp Bridge Implementation)
- Module doc: `.claude/modules/wa-monitor.md`

---
