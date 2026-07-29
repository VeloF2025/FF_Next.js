<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# Module: assets
<!-- Equipment asset registry — categories, assignments, maintenance, Odoo import, VLM label scanning -->

## Purpose
Company asset lifecycle: registration, categorization, staff assignment, maintenance scheduling, calibration tracking, VLM label scanning, and Odoo import integration.

## Key Files
| File | Purpose |
|------|---------|
| `client.ts` | Client-safe re-exports (components/hooks only) |
| `index.ts` | Server-side re-exports (includes DB services) |
| `components/AddAssetModal.tsx` | Create asset modal |
| `components/OdooImportWizard.tsx` | 5-step wizard: categories → fleet filter → PO link → dry run → execute |
| `components/AssetVerificationPanel.tsx` | VLM label scan to verify asset identity |
| `components/LabelScanner.tsx` | Camera-based barcode/label capture |
| `components/ConditionPhotoCapture.tsx` | Condition photo at assignment |
| `services/assetService.ts` | Asset CRUD with status transition guard |
| `services/assetVlmService.ts` | VLM integration for label scanning |
| `services/assignmentService.ts` | Assignment history + staff linkage |
| `services/maintenanceService.ts` | Maintenance scheduling + due-date alerts |
| `hooks/queries.ts` | React Query hooks |
| `hooks/mutations.ts` | Create/update/assign mutations |
| `constants/assetStatus.ts` | Status enum + valid transition map |

## API Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/assets` | List / create assets |
| GET/PUT/DELETE | `/api/assets/[id]` | Asset CRUD |
| GET | `/api/assets/dashboard` | Dashboard stats (totals, alerts) |
| GET | `/api/assets/calibration-due` | Assets with calibration due/overdue |
| GET | `/api/assets/maintenance-due` | Maintenance alerts |
| POST | `/api/odoo/sync/assets` | Trigger Odoo asset import |
| POST | `/api/procurement/grn/[id]/register-assets` | Register assets from GRN |

## Database Tables
- `assets` — asset registry (asset_number, serial, barcode, category, status, purchase/warranty dates)
- `asset_categories` — category taxonomy
- `asset_assignments` — assignment history (staff + dates + condition photos)
- `asset_maintenance` — maintenance records + schedule

## Critical Rules
- Never delete assets with active assignments — status transition guard in `isValidTransition()`
- `index.ts` contains DB code (server-only); use `client.ts` in React components to avoid webpack errors
- Odoo import: dry run first — `execute` without dry run preview is blocked in wizard
- VLM label scan uses same endpoint as fleet (`:8100`) — resize to 1024×768 before sending
- Odoo import links to PO records from procurement module for stock reconciliation

## Common Issues
| Issue | Fix |
|-------|-----|
| Import error on client bundle | Use `client.ts` not `index.ts` in React components |
| Status transition blocked | Check `isValidTransition()` in `constants/assetStatus.ts` |
| Odoo sync stalls | Check `odoo_sync_jobs` table; re-trigger via wizard |

<!-- Auto-updated by /kb. Last: 2026-05-12 -->
