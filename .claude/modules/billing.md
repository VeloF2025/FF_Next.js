# Billing Module

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | FT payment summary parsing, weekly billing reconciliation, DR payment tracking |
| **Status** | Production |
| **Complexity** | Medium |
| **Category** | finance |

## Key Features
- **FT Payment Summary Upload**: Parse Excel files from FiberTime with payment data
- **Weekly Summary**: Aggregated billing view per project/period
- **DR Payment Status**: Track payment status per daily report
- **Lifecycle Rules**: Pre-provisions NOT paid, deductions tracked, 3 business rules

## Directory Structure
```
src/modules/billing/
├── components/
│   ├── BillingUploadTab.tsx          # FT payment Excel upload
│   ├── WeeklySummaryTab.tsx          # Weekly billing aggregation
│   └── DRPaymentStatusTab.tsx        # DR-level payment tracking
└── services/
    └── parseFTPaymentSummary.ts      # Excel parser for FT billing data
```

## API Routes
```
pages/api/billing/
├── upload.ts               # FT payment summary upload
├── weekly-summary.ts       # Weekly billing data
└── dr-payment-status.ts    # DR payment status queries
```

## Database Tables
- `ft_billing_records` — Parsed FT payment records
- `ft_billing_uploads` — Upload history/metadata

## Business Rules
1. Pre-provisions are NOT paid (excluded from billing)
2. Deductions tracked separately per contractor
3. Lifecycle status determines payment eligibility

## Dependencies
- xlsx library for Excel parsing
- Activate module (DR data linkage)
