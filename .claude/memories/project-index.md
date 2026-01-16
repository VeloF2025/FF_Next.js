# FibreFlow Project Index

**Last Updated**: 2026-01-10

---

## Project Overview

| Field | Value |
|-------|-------|
| Name | FibreFlow Next.js |
| Type | Fiber network project management |
| Framework | Next.js 14+ (Pages Router) |
| Database | Neon PostgreSQL |
| Auth | Clerk |
| Dark Mode | ✅ Complete (CSS variable system) |

---

## Key Locations

### Core Directories
| Path | Purpose |
|------|---------|
| `src/modules/` | 34 modular features |
| `src/components/` | Shared UI components |
| `src/services/` | API services |
| `src/lib/` | Utilities (apiResponse, logger, arcjet) |
| `pages/api/` | API routes |
| `scripts/` | Build & database tools |

### Critical Files
| File | Purpose |
|------|---------|
| `src/lib/apiResponse.ts` | Standard API responses |
| `src/lib/logger.ts` | Logging (use instead of console.*) |
| `src/lib/arcjet.ts` | API rate limiting |
| `src/components/layout/AppLayout.tsx` | Standard page layout |
| `neon/schema.sql` | Database schema |

### Module Structure Pattern
```
src/modules/{name}/
├── types/          # TypeScript interfaces
├── services/       # Business logic & API
├── utils/          # Helpers
├── components/     # UI components
└── hooks/          # Custom hooks
```

---

## Database Tables (Key)

### SOW Data (`drops` table)
- API: `/api/sow/drops`, `/api/sow/fibre`
- Source: Excel imports
- Scripts: `scripts/sow-import/`

### WhatsApp QA (`qa_photo_reviews` table)
- API: `/api/wa-monitor-*`
- Source: WhatsApp groups
- Module: `src/modules/wa-monitor/`

### Field Stock Tables (PRD-027)
- `field_stock_items` - Stock items at field locations
- `field_stock_transactions` - All stock movements
- `field_stock_requisitions` - Material requests
- `field_stock_returns` - Returns to warehouse

### Other Key Tables
- `projects` - Project definitions
- `contractors` - Contractor records
- `installations` - Installation tracking
- `foto_ai_reviews` - AI photo reviews

---

## API Patterns

### Standard Response
```typescript
import { apiResponse } from '@/lib/apiResponse';
return apiResponse.success(res, data);
return apiResponse.notFound(res, 'Resource', id);
return apiResponse.internalError(res, error);
```

### Route Naming
```
pages/api/contractors/[contractorId].ts  // Correct
pages/api/contractors/[id].ts            // Wrong - conflicts
```

### Vercel Nested Routes Issue
```
pages/api/contractors/[id]/stages.ts     // Fails in production
pages/api/contractors-stages.ts          // Works everywhere
```

### Pages Router vs App Router (CRITICAL)
This is a **Pages Router** app. Don't mix APIs:
```tsx
// ✅ CORRECT (Pages Router)
import { useRouter } from 'next/router';
const router = useRouter();
const pathname = router.pathname;

// ❌ WRONG (App Router - causes navigation issues)
import { usePathname } from 'next/navigation';
const pathname = usePathname();
```

### Next.js Link Component
```tsx
// ✅ MODERN - apply styles directly
<Link href="/page" className="...">Text</Link>

// ❌ OLD - avoid legacyBehavior
<Link href="/page" legacyBehavior passHref><a>Text</a></Link>
```

---

## Environments

| Env | URL | Branch | DB Endpoint |
|-----|-----|--------|-------------|
| Production | app.fibreflow.app | master | ep-dry-night-a9qyh4sj |
| Development | dev.fibreflow.app | develop | ep-aged-poetry-a9bbd8e9 |

---

## Important Modules

### field-stock (New - PRD-027)
- Field stock tracking and management
- 7 tabs: Overview, Items, Transactions, Requisitions, Returns, Transfers, Settings
- API: `/api/procurement/field-stock/*`
- Tables: `field_stock_items`, `field_stock_transactions`, `field_stock_requisitions`, `field_stock_returns`

### wa-monitor (Isolated)
- Fully self-contained, zero external dependencies
- Can be extracted to microservice
- Groups: Lawley, Mohadin, Velo Test, Mamelodi

### ticketing (Active Development)
- DR lookup service recently modified
- Integration with QContact

### activate (formerly dr-photo-unified)
- AI-powered photo review with VLM categorization
- DR validation against `drops` table with WhatsApp notifications
- See: `activate-dr-validation.md` for validation system details
- API: `/api/activate/*`
- Table: `foto_ai_reviews`

---

## Quality Standards

| Standard | Value |
|----------|-------|
| File size | Max 300 lines |
| Component size | Max 200 lines |
| Type coverage | 100% |
| Logging | logger.ts only (no console.*) |
| Error handling | Always use apiResponse helpers |

---

## Deployment Commands

```bash
# Deploy to DEV
ssh louis@100.96.203.105 \
  "cd /var/www/fibreflow-dev && git pull && npm ci && npm run build && pm2 restart fibreflow-dev"

# Deploy to PROD (after dev testing)
ssh louis@100.96.203.105 \
  "cd /var/www/fibreflow && git pull && npm ci && npm run build && pm2 restart fibreflow-prod"
```

---

## Search Patterns

```bash
# Find API routes
rg "export default" pages/api/

# Find module services
ls src/modules/*/services/

# Find types
rg "interface|type " src/modules/*/types/

# Find components
ls src/modules/*/components/
```
