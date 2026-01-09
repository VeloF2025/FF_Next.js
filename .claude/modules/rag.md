# Module: rag

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Contractor health monitoring system that calculates Red/Amber/Green status based on financial, compliance, performance, and safety metrics |
| **Status** | Active |
| **Complexity** | High |
| **Category** | monitoring |

## Dependencies

### Internal FF Modules
- `contractors` (uses contractor data)
- `contractor-documents` (for compliance data)

### External Packages
- @neondatabase/serverless
- react
- lucide-react

## Database

### Tables
- `contractors` - Contractor records
- `contractor_documents` - Document status

### Key Queries
- Fetch contractor with aggregated data including document status
- Count expired and expiring-soon documents
- Filter active contractors with RAG calculation

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/contractors-rag` | List all contractors RAG |
| GET | `/api/contractors-rag?contractorId={id}` | Single contractor RAG |

## Services

### ragCalculationService
```typescript
calculateContractorRag(input)
prepareRagInputFromDbRow(row)
calculateBulkRag(contractors)
hasRagStatusChanged(oldStatus, newStatus)
getRagChanges(oldStatus, newStatus)
```

### ragApiService
```typescript
getContractorRagStatus(contractorId)
getAllContractorsRagStatus()
```

## Components
- `RagDashboard` - Main dashboard with filtering
- `RagSummaryCards` - Summary statistics
- `RagStatusBadge` - Status display

## Hooks
None custom - uses useState, useEffect directly

## RAG Categories
1. Financial
2. Compliance
3. Performance
4. Safety
5. Overall (worst of all categories)

## Scoring Rules
Defined in `ragRules.ts`:
- Traffic light system (green/amber/red)
- Category-based scoring
- Change detection and history tracking

## Patterns
- Scoring rules abstraction
- Traffic light system
- Category-based scoring (5 categories + overall)
- Change detection and history tracking

## Gotchas
- **Incomplete Data**: TODO comments indicate incomplete data gathering (payment data, incidents)
- **Hardcoded Safety**: Safety incidents currently hardcoded to 0
- **Aggregated Scores**: Uses contractor aggregated scores, not real-time calculations
- **Missing Table**: Missing incident tracking table in current schema
- **Worst Status Logic**: Overall RAG = "worst" of 4 categories
