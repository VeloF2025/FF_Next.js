# FibreFlow Implementation Workflow

Implement all tasks assigned to you and ONLY those task(s) that have been assigned to you.

## Implementation Process

### 1. Understand Requirements
- Read specification: `spec.md`, `requirements.md`, or `.agent-os/specs/[spec-name]/`
- Review visuals (if any): `.agent-os/specs/[spec-name]/planning/visuals/`
- Clarify with user if requirements are unclear or conflicting

### 2. Research Existing Patterns
- **Use Grep** to find similar implementations in codebase
- **Read CLAUDE.md** for FibreFlow standards (API response format, modular architecture, database patterns)
- **Check docs/DATABASE_TABLES.md** for schema conventions
- **Review similar modules** in `src/modules/` for architectural patterns
- **Use antihall validator** to verify referenced code exists

### 3. Plan Database Changes (If Needed)
**FibreFlow is database-first** - plan schema before writing code:

```sql
-- Create migration script in scripts/migrations/YYYY-MM-DD-feature-name.ts
CREATE TABLE new_table (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  column_name TYPE CONSTRAINTS,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX idx_table_column ON table_name(column_name);
```

**Critical Rules**:
- ✅ Use direct SQL (NO ORM)
- ✅ Use Neon serverless client: `@neondatabase/serverless`
- ✅ Test migration on development database first
- ✅ Document schema in `docs/DATABASE_TABLES.md`

### 4. Implement Following FibreFlow Standards

#### Modular Architecture (For New Features)
Create self-contained module in `src/modules/{module-name}/`:
```
src/modules/{module-name}/
├── types/{module}.types.ts       # TypeScript interfaces
├── services/
│   ├── {module}Service.ts        # Business logic
│   └── {module}ApiService.ts     # Frontend API client
├── utils/{module}Helpers.ts      # Helper functions
├── components/                   # UI components
│   ├── {Module}Dashboard.tsx
│   └── index.ts
└── hooks/use{Module}.ts          # Custom hooks (optional)
```

#### API Endpoints (Flattened Routes)
```bash
# ✅ CORRECT - Works in production
pages/api/resource-action.ts
pages/api/resource-action-update.ts

# ❌ WRONG - Returns 404 in Vercel production
pages/api/resource/[id]/action.ts
```

**Always use standardized responses**:
```typescript
import { apiResponse } from '@/lib/apiResponse';

export default async function handler(req, res) {
  try {
    const data = await fetchData();
    return apiResponse.success(res, data);
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}
```

#### Component Structure (< 200 lines)
```typescript
// ✅ Good - Extract logic to hooks
function MyComponent() {
  const { data, loading, error, actions } = useMyFeature();

  if (loading) return <Loading />;
  if (error) return <Error message={error} />;

  return <div>{/* UI only */}</div>;
}

// hooks/useMyFeature.ts
export function useMyFeature() {
  // All business logic here
  const [data, setData] = useState(null);
  // ... complex logic
  return { data, loading, error, actions };
}
```

#### Database Queries (Direct SQL)
```typescript
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);

// SELECT
const users = await sql`SELECT * FROM users WHERE active = true`;

// INSERT with RETURNING
const newUser = await sql`
  INSERT INTO users (name, email)
  VALUES (${name}, ${email})
  RETURNING *
`;

// UPDATE
await sql`
  UPDATE users
  SET name = ${newName}
  WHERE id = ${userId}
`;
```

### 5. Test Locally (Production Build)
```bash
# Build for production mode (dev mode has Watchpack bug)
npm run build

# Start on port 3005
PORT=3005 npm start

# Test at http://localhost:3005
# Verify:
# - Feature works as specified
# - No console errors
# - API endpoints return correct data
# - Database queries succeed
# - Forms validate properly
# - Error handling works
```

### 6. Deploy Feature Branch to Dev
```bash
# Commit and push feature branch
git add <files>
git commit -m "feat: description of changes"
git push origin feature/<name>

# Deploy feature branch to dev.fibreflow.app
ssh velo@100.96.203.105 "cd /home/velo/fibreflow-dev && git fetch origin && git checkout feature/<name> && git pull origin feature/<name> && npm install && npm run build && echo 'velo2026' | sudo -S systemctl restart fibreflow-dev.service"

# Test at https://dev.fibreflow.app
```

**Verification Checklist**:
- [ ] Page loads without errors
- [ ] User can log in (Clerk authentication)
- [ ] Feature works as specified
- [ ] Data persists to database correctly
- [ ] API responses match expected format
- [ ] Error handling displays user-friendly messages
- [ ] Mobile responsive (test in DevTools)

### 7. Get Hein's Approval
**CRITICAL**: Do NOT merge to master without Hein's explicit approval after testing on dev.fibreflow.app.

### 8. Merge to Master & Promote (After Approval)
```bash
# Merge feature branch to master
git checkout master
git pull origin master
git merge feature/<name>
git push origin master

# Promote to staging (after hours only, with Hein's approval)
ssh velo@100.96.203.105 "cd /home/velo/fibreflow-staging && git fetch origin && git checkout <COMMIT> && npm install && npm run build && echo 'velo2026' | sudo -S systemctl restart fibreflow.service"

# Promote to production (after hours only, with Hein's approval)
ssh velo@100.96.203.105 "cd /home/velo/fibreflow-production && git fetch origin && git checkout <COMMIT> && npm install && npm run build && echo 'velo2026' | sudo -S systemctl restart fibreflow-production.service"

# Verify at https://app.fibreflow.app
```

**NEVER push directly to master. NEVER use ALLOW_MASTER_PUSH=1.**

### 9. Update Documentation
```bash
# Required documentation updates:
# 1. Update CHANGELOG.md
docs/CHANGELOG.md - Add deployment entry with date, feature, changes

# 2. Update page logs (if UI changed)
docs/page-logs/{page-name}.md - Document changes, file:line references, testing

# 3. Update database docs (if schema changed)
docs/DATABASE_TABLES.md - Add new tables, columns, indexes

# 4. Update module README (if module created/modified)
src/modules/{module}/README.md - API contracts, usage examples
```

### 10. Mark Tasks Complete
Update task list to mark completed tasks:
```markdown
# .agent-os/specs/[spec-name]/tasks.md
- [x] Implement database schema
- [x] Create API endpoints
- [x] Build UI components
- [x] Deploy to development
- [x] Get user approval
- [x] Deploy to production
- [x] Update documentation
```

## Guide Your Implementation Using

### FibreFlow Standards (CRITICAL)
1. **CLAUDE.md** - Complete project context (8,900+ lines)
   - Tech stack, deployment workflow, coding standards
   - API response format, database patterns, modular architecture

2. **docs/DATABASE_TABLES.md** - Database schema reference
   - Existing tables and their purposes
   - Naming conventions, index patterns

3. **lib/apiResponse.ts** - Standardized API responses
   - Success, error, validation formats

4. **src/modules/** - Modular architecture examples
   - wa-monitor, rag, procurement modules
   - Self-contained, plug-and-play structure

### Existing Codebase Patterns
- Search for similar implementations using Grep
- Follow established naming conventions
- Reuse existing utilities and helpers
- Maintain consistency with current code style

### Specification Documents
- Requirements.md, spec.md, or tasks.md in `.agent-os/specs/[spec-name]/`
- Visuals (if provided) in `.agent-os/specs/[spec-name]/planning/visuals/`

## Self-Verify and Test

### Automated Testing
```bash
# Run tests (if written)
npm test

# Run specific test file
npm test path/to/test.spec.ts

# Type checking
npm run type-check

# Linting
npm run lint
```

### Browser Testing (For UI Features)
1. **Open browser** to http://localhost:3005 (or dev.fibreflow.app)
2. **Test as a user** - complete full user flow
3. **Check DevTools console** - no errors
4. **Test edge cases**:
   - Empty states (no data)
   - Error states (API failure)
   - Loading states (slow network)
   - Validation errors (invalid input)
5. **Test mobile responsive** - DevTools device toolbar
6. **Take screenshots** (optional) - store in `.agent-os/specs/[spec-name]/verification/screenshots/`

### Database Verification
```bash
# Connect to Neon database
psql postgresql://neondb_owner:npg_aRNLhZc1G2CD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb

# Verify schema changes
\d table_name

# Check data inserted correctly
SELECT * FROM table_name LIMIT 10;

# Verify indexes exist
\di table_name*
```

## Common Pitfalls to Avoid

### ❌ Don't Do This
- Use development mode (`npm run dev`) - Has Watchpack bug
- Use nested dynamic API routes - Returns 404 in production
- Use any ORM - FibreFlow uses direct SQL only
- Deploy to production without testing on dev first
- Skip documentation updates
- Exceed file size limits (300 lines, components 200 lines)
- Mix business logic with UI in components
- Use generic parameter names like `[id]`

### ✅ Always Do This
- Build in production mode: `npm run build`
- Use flattened API routes
- Write direct SQL queries with Neon client
- Test on dev.fibreflow.app before production
- Update CHANGELOG.md and page logs
- Keep files under size limits (extract to hooks/services)
- Separate business logic into hooks
- Use descriptive parameter names: `[contractorId]`, `[projectId]`

## Success Criteria

Implementation is complete when:
- ✅ All assigned tasks implemented
- ✅ Tasks marked complete in tasks.md
- ✅ Code follows FibreFlow standards (file sizes, modular architecture, API format)
- ✅ Database queries use direct SQL (no ORM)
- ✅ Tests pass locally (production build)
- ✅ Deployed and tested on dev.fibreflow.app
- ✅ User approved for production deployment
- ✅ Deployed to production successfully
- ✅ Documentation updated (CHANGELOG, page logs, DATABASE_TABLES if needed)
- ✅ No errors in systemd logs: `journalctl -u fibreflow-production -n 50`
- ✅ Feature verified working in production
