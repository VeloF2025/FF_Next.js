<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# Module: field-stock
<!-- 4-stage site stock tracking: issue → consume → return → reconcile -->

## Purpose
Tracks ONT/UPS serial stock from warehouse checkout through field installation to daily reconciliation, with automated blocking for unaccounted items.

## Key Files
| File | Purpose |
|------|---------|
| `components/DailyCheckoutModal.tsx` | Stage 1: technician daily stock checkout |
| `components/StockReceiptModal.tsx` | Stage 3: return unused stock |
| `components/DailyReconciliationDashboard.tsx` | Stage 4: end-of-day issued vs installed vs returned report |
| `services/reconciliationService.ts` | Backend: calculates unaccounted items per technician |
| `offline/offlineStorage.ts` | IndexedDB offline queue |
| `offline/useOnlineStatus.ts` | Online/offline hook |
| `offline/OfflineBanner.tsx` | Offline indicator banner |

## API Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/field-stock/reports/daily-reconciliation` | Daily reconciliation data |

## Database Tables
- `stock_pickings` — items issued to technicians
- `stock_consumptions` — items consumed at installations
- `stock_serials` — serial status tracking
- `qa_photo_reviews` — installation records with ONT serials (linked)
- `v_contractor_accountability` — blocking status per contractor (pure-custody live view, mig 384/390); legacy `contractor_stock_accountability` table retired app-side (Sprint E Track 4.4), dropped at cutover (Track 4.5)

## Critical Rules
- Reconciliation formula: **Unaccounted = Issued − Installed − Returned**
- Blocking thresholds: >3 unaccounted items OR >R5000 unaccounted value
- `reconciliationService.ts` still imports from `@/lib/db-neon` (Neon shim) — migrate to `pg.Pool` when touched
- Offline storage uses IndexedDB via `offline/offlineStorage.ts`; sync on reconnect
- Uses MUI components (Box, Paper, Table etc.) — not shadcn/ui like the rest of the app
- `qa_photo_reviews` is the WhatsApp QA table — do NOT confuse with `drops` table

## Common Issues
| Problem | Fix |
|---------|-----|
| Reconciliation 500 error | Check Neon shim — `reconciliationService.ts` uses `@/lib/db-neon`; verify DATABASE_URL |
| Technician shows as blocked | Query `v_contractor_accountability` (is_blocked rolls up from holder `stock_accountability`); unblock via the holder accountability UI |
| Offline data not syncing | Check IndexedDB in browser devtools; `useOnlineStatus` hook triggers sync on `online` event |

<!-- Auto-updated by /kb. Last: 2026-05-12 -->
