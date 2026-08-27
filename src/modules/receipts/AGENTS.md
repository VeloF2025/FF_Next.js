<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# Module: receipts
<!-- Staff expense receipt capture: camera-only PWA, VLM OCR, finance review/export -->

## Purpose
Staff expense-receipt capture (camera-only PWA), VLM OCR extraction (vendor/total/VAT/date/category), per-staff submission at `/my/receipts`, finance review/export at `/staff/receipts`.

## Key Files
| File | Purpose |
|------|---------|
| `queries.ts` | Core SQL: insert, list, find, patch, hub-badge helper |
| `queries-review.ts` | Finance-side review queries + single-row transition |
| `queries-review-bulk.ts` | Bulk transition (up to 100 ids in one UPDATE), split out to stay under the 300-line file cap |
| `extraction.ts` / `serverExtraction.ts` | VLM prompt + response parser; server-side call wrapper |
| `categories.ts` | Closed `RECEIPT_CATEGORIES` + `coerceReceiptCategory()` |
| `storage.ts` | VF Storage upload/download (`100.96.203.105:8091`) |
| `csv.ts` / `reviewFilters.ts` | Finance CSV export + URL filter helpers |

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/my/receipts/index` | Staff's own non-rejected receipts |
| POST | `/api/my/receipts/save` | Insert + image upload |
| POST | `/api/my/receipts/extract` | VLM OCR extraction (Qwen3-VL on :8100) |
| PATCH | `/api/my/receipts/[id]/edit` | Staff edits own submitted receipt |
| GET | `/api/staff/receipts` | Finance listing |
| POST | `/api/staff/receipts-review` | Approve / reject / reconcile (one receipt) |
| POST | `/api/staff/receipts-review-bulk` | Approve / reject / reconcile (up to 100 receipts, same transition rules) |
| GET | `/api/staff/receipts-export` | CSV export |

## Database Tables
- `staff_receipts` — `status` drives workflow: `submitted` → `approved` / `rejected` / `reconciled`

## Critical Rules
- NEVER allow file-upload fallback — capture MUST use `capture="environment"` (live camera only)
- Pre-generate receipt UUID before upload — `insertReceipt()` requires `args.id` matching the image filename
- Staff cannot edit once status leaves `submitted` — enforced by `AND status = 'submitted'` in `updateOwnSubmittedReceipt()`
- To add a new category: extend `RECEIPT_CATEGORIES` array + update VLM prompt in `extraction.ts`

## Common Issues
| Issue | Fix |
|-------|-----|
| Receipt not saving | Confirm UUID pre-generated and matches storage filename |
| VLM extraction wrong category | Check `coerceReceiptCategory()` — adds closest match from closed list |
| Finance CSV blank | Check `reviewFilters.ts` URL params — date range required |

<!-- Auto-updated by /kb. Last: 2026-05-12 -->
