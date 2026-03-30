# Field Stock Module

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Mobile-first stock management for field teams at physical locations |
| **Status** | Production |
| **Complexity** | Medium |
| **Category** | inventory |

## Key Features
- **Daily Checkout Modal**: Field teams check out stock for the day
- **Stock Receipt**: Receive stock from warehouse dispatch
- **Daily Reconciliation Dashboard**: End-of-day stock vs usage reconciliation
- **Offline Support**: Works offline with sync when reconnected
- **VF Storage Integration**: Photo evidence for stock movements

## Directory Structure
```
src/modules/field-stock/
├── components/
│   ├── DailyCheckoutModal.tsx            # Checkout stock for field work
│   ├── DailyReconciliationDashboard.tsx  # End-of-day reconciliation
│   ├── StockReceiptModal.tsx             # Receive dispatched stock
│   └── index.ts                          # Component barrel
├── offline/
│   ├── OfflineBanner.tsx                 # Offline status indicator
│   ├── offlineStorage.ts                # IndexedDB offline storage
│   ├── useOnlineStatus.ts               # Online/offline hook
│   └── index.ts                          # Offline barrel
└── services/
    └── reconciliationService.ts          # Reconciliation logic
```

## API Routes
```
pages/api/field-stock/
├── checkout.ts             # Daily stock checkout
├── receipt.ts              # Stock receipt from dispatch
├── reconciliation.ts       # Daily reconciliation
└── reports/
    └── daily-reconciliation.ts  # Reconciliation reports
```

## Database Tables
- `field_stock_checkouts` — Daily checkout records
- `field_stock_receipts` — Stock receipt records
- `field_stock_reconciliations` — Reconciliation results

## Dependencies
- Procurement module (stock item catalog)
- Contractor module (accountability tracking)
- VF Storage (photo evidence)
