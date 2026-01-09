# Module: contractor-documents-report

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Comprehensive document compliance tracking and reporting system for contractors |
| **Status** | Active |
| **Complexity** | High |
| **Category** | other |

## Dependencies

### Internal FF Modules
None

### External Packages
- @neondatabase/serverless (backend)
- react

## Database

### Tables
- `contractors` - Contractor records
- `contractor_documents` - Document storage
- `team_members` - Team member records

### Key Queries
- Fetch contractor documents grouped by type with verification status
- Query team members and their ID documents
- Aggregate document statistics (verified, pending, missing, expired)
- Generate all-contractors summary with compliance metrics

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/contractors-documents-report?contractorId={id}` | Single contractor report |
| GET | `/api/contractors-documents-report-summary` | All contractors summary |
| GET | `/api/contractors-documents-export?contractorId={id}&format={csv\|pdf}` | Export report |

## Services

### documentReportService
```typescript
generateContractorDocumentReport(contractorId)
generateAllContractorsSummary()
fetchContractorInfo(contractorId)
fetchCompanyDocuments(contractorId)
fetchTeamMemberDocuments(contractorId)
buildDocumentInfo(docType, dbRow)
```

### documentReportApiService
```typescript
fetchContractorDocumentReport(contractorId)
fetchAllContractorsSummary()
exportContractorReportCSV(contractorId)
exportContractorReportPDF(contractorId)
downloadBlob(blob, filename)
```

### documentExportService
```typescript
generateContractorReportCSV(report)
generateAllContractorsSummaryCSV(contractors)
```

## Components
- `AllContractorsSummary` - Summary view
- `SingleContractorReport` - Individual report
- `ExpiryAlert` - Expiry warnings
- `DocumentStatusBadge` - Status indicator
- `DocumentStatusTable` - Status table
- `CompletionProgressBar` - Progress display

## Hooks
- `useContractorDocumentReport(contractorId)` - Single contractor data
- `useAllContractorsSummary()` - All contractors data

## Types
- `CompanyDocumentType` - 6 types: CIDB, B-BBEE, Registration, Tax, Bank, Address
- `TeamMemberDocumentType` - ID Document
- `DocumentVerificationStatus` - verified, pending, rejected, missing
- `DocumentUrgencyLevel` - ok, expiring, expired
- `DocumentDisplayStatus` - 7 combined states

## Patterns
- Service-oriented architecture (backend service + API layer + frontend API service)
- Database-first approach with direct SQL queries via Neon
- Declarative document type and category system
- Status aggregation (verified, pending, rejected, missing, expiring, expired)
- Completion percentage calculation based on document upload status
- Alert generation based on expiry dates and rejection reasons
- CSV export functionality

## Gotchas
- **Missing Table**: Team member documents table doesn't exist yet - all marked as "missing"
- **PDF Not Implemented**: PDF export returns 501
- **Hardcoded Periods**: Expiry date warning period is hardcoded per document type
- **Status Filter**: Only queries "approved" contractors in summary (excludes suspended/pending)
- **NULL Handling**: Must handle missing/null database rows gracefully for optional documents
