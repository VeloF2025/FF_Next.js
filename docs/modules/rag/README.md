# RAG Module — Contractor Health Scoring

**Last Updated:** 2026-03-11  
**Status:** Active (Embedded in Contractors)  
**Complexity:** High  
**Ownership:** Elon (CTO)

## Overview

RAG is a **traffic light scoring system** (Red/Amber/Green) that evaluates contractor health across four dimensions:

- **Financial** — Payment history, stability
- **Compliance** — Document status, certifications
- **Performance** — Project delivery, quality
- **Safety** — Incident tracking, safety compliance

The overall RAG status is determined by the **worst score** across all dimensions, creating a fail-safe risk assessment model.

## Quick Start

### Check a Contractor's RAG Status

```bash
# Get single contractor RAG
curl "http://localhost:3000/api/contractors-rag?contractorId=<UUID>"

# Get all contractors RAG
curl "http://localhost:3000/api/contractors-rag"
```

### Example Response

```json
{
  "contractorId": "abc-123",
  "companyName": "ABC Contractors Ltd",
  "overall_status": "amber",
  "dimensions": {
    "financial": "green",
    "compliance": "amber",
    "performance": "green",
    "safety": "green"
  },
  "reasons": {
    "compliance": ["2 expired certifications", "Training overdue"]
  }
}
```

## Architecture

### Data Sources

| Dimension | Source Table | Key Metrics |
|-----------|--------------|-------------|
| **Financial** | `contractors` | Payment history, financial stability |
| **Compliance** | `contractor_documents` | Document expiration, certification status |
| **Performance** | Project history (via aggregates) | Completion rate, quality scores |
| **Safety** | Incidents (hardcoded as 0, TODO) | Safety incidents, violations |

### Calculation Rules

**Status Mapping:**
```
Green ✅  : All dimensions green (low risk)
Amber ⚠️  : Any dimension amber, none red (medium risk)
Red 🔴   : Any dimension red (high risk)
```

**Overall = Worst of (Financial, Compliance, Performance, Safety)**

This ensures a single failing area makes the contractor's overall status fail—conservative risk approach.

### Current Limitations (Known Gaps)

- **❌ Safety scoring:** Currently hardcoded to 0 (no incidents tracked)
- **❌ Payment data:** Incomplete payment history aggregation
- **❌ Performance scoring:** Uses contractor aggregates, not real-time calculations
- **❌ Incident table:** Missing dedicated incident/violation tracking table

See [RAG_MODULE_PLAN.md](RAG_MODULE_PLAN.md) for future refactoring design.

## Files & Structure

```
docs/modules/rag/
├── README.md                    ← You are here
├── CHANGELOG.md                 ← Version history
├── RAG_MODULE_PLAN.md          ← Future refactoring design
└── API_ENDPOINTS.md            ← [TODO] Detailed endpoint docs

src/pages/api/
└── contractors-rag.ts          ← Main API endpoint

.claude/modules/
└── rag.md                       ← Internal module definition
```

## API Endpoints

### GET /api/contractors-rag

Fetch all contractors with RAG scores.

**Query Parameters:**
- `contractorId` *(optional)* — UUID of single contractor to fetch
- `status` *(optional)* — Filter by RAG status: `'red'`, `'amber'`, `'green'`

**Response:**
```typescript
{
  contractors: [
    {
      contractorId: string;
      companyName: string;
      overall_status: 'red' | 'amber' | 'green';
      financial_status: 'red' | 'amber' | 'green';
      compliance_status: 'red' | 'amber' | 'green';
      performance_status: 'red' | 'amber' | 'green';
      safety_status: 'red' | 'amber' | 'green';
      reasons: {
        [dimension: string]: string[];  // Why this status
      };
    }
  ]
}
```

## Services

### `ragCalculationService`

Core scoring engine (`src/services/contractor/ragScoringService.ts`).

```typescript
calculateContractorRag(input)        // Score a single contractor
prepareRagInputFromDbRow(row)       // Prepare data from DB
calculateBulkRag(contractors)       // Score multiple contractors
hasRagStatusChanged(old, new)       // Detect status change
getRagChanges(oldStatus, newStatus) // Get change reasons
```

### `ragApiService`

API wrapper service for external requests.

```typescript
getContractorRagStatus(contractorId)      // Single contractor
getAllContractorsRagStatus()              // All contractors
```

## Components

### RagDashboard

Main UI component for displaying RAG scores in the contractors list.

**Props:**
- `contractors: Contractor[]` — Array of contractors
- `selectedStatus?: 'red' | 'amber' | 'green'` — Filter by status
- `onStatusChange?: (status) => void` — Handle filter changes

**Features:**
- Colored status badges (red/amber/green)
- Filter by RAG status
- Drill-down to contractor detail
- Dimension breakdown visibility

### RagStatusBadge

Simple status display component.

```typescript
<RagStatusBadge status="amber" />  // Renders colored badge
```

## Usage Examples

### Display Contractor RAG in List View

```typescript
import { RagDashboard } from '@/modules/contractors/components/RagDashboard';
import { useContractorsRag } from '@/hooks/useContractorsRag';

export function ContractorsList() {
  const { contractors } = useContractorsRag();

  return (
    <RagDashboard 
      contractors={contractors}
      selectedStatus="red"  // Show only high-risk
    />
  );
}
```

### Fetch Single Contractor RAG

```typescript
const response = await fetch(
  `/api/contractors-rag?contractorId=${id}`
);
const { contractors } = await response.json();
const contractor = contractors[0];

console.log(`${contractor.companyName} is ${contractor.overall_status}`);
```

### Programmatic Score Check

```typescript
import { ragApiService } from '@/services/contractor/ragApiService';

const ragStatus = await ragApiService.getContractorRagStatus(contractorId);

if (ragStatus.overall_status === 'red') {
  alert(`⚠️ High-risk contractor: ${ragStatus.reasons}`);
}
```

## Troubleshooting

### RAG Status Not Updating
1. Check that contractor document data is current
2. Verify `contractor_documents` table has recent data
3. Check for `TODO` comments in `ragScoringService.ts` (missing integrations)
4. RAG calculation may be cache-delayed (clear browser cache)

### All Contractors Show Green
Likely cause: Scoring logic incomplete. Check `ragScoringService.ts` for `TODO` markers and missing data sources.

### Safety Status Always Green
**Known issue:** Safety incidents hardcoded to 0 (no tracking table exists). Will be resolved in future refactoring. See [RAG_MODULE_PLAN.md](RAG_MODULE_PLAN.md).

## Dependencies

### Internal
- `contractors` module — Contractor CRUD and data
- `contractor-documents` module — Compliance document tracking

### External Packages
- `@neondatabase/serverless` — Database client
- `react` — UI rendering
- `lucide-react` — Icons for status badges

## Roadmap

### Current State (2026-03)
- ✅ Financial & compliance scoring active
- ✅ API endpoints working
- ✅ Dashboard UI functional
- ⚠️ Performance scoring incomplete
- ❌ Safety tracking missing

### Future (Planned)
- [ ] Separate RAG into independent module (see [RAG_MODULE_PLAN.md](RAG_MODULE_PLAN.md))
- [ ] Implement safety incident tracking
- [ ] Add automated score recalculation (cron jobs)
- [ ] Score history & trending dashboard
- [ ] Performance dimension completion
- [ ] Email alerts on RAG status changes
- [ ] Contractor risk scoring API for external systems

## Support

For issues, questions, or feature requests:
1. Check [RAG_MODULE_PLAN.md](RAG_MODULE_PLAN.md) for planned improvements
2. Search `TODO` comments in `src/services/contractor/ragScoringService.ts`
3. Contact Elon (CTO)

---

**Related Documentation:**
- [CHANGELOG.md](CHANGELOG.md) — Version history
- [RAG_MODULE_PLAN.md](RAG_MODULE_PLAN.md) — Future architecture (October 2025)
- [Contractors Module](../contractors/README.md) — Parent module
