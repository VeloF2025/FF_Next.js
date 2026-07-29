<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# payslips module

HR payslip import (Sage combined PDF or legacy Sage/VIP/Isaflow CSV+PDF bundle), per-staff secure download at `/my/payslips`, and 5-year soft-retention archiving.

**Pages:** `pages/my/payslips/index.tsx` — staff self-serve view (dark-theme `/my` portal); `pages/staff/payslips/import.tsx` — HR bulk import UI
**API routes:**
- `GET  /api/my/payslips` — list own active payslips (scoped to session staffId, archived_at IS NULL)
- `GET  /api/my/payslips/[id]/download` — streams PDF server-side (VF Storage URL never sent to client — POPIA)
- `POST /api/staff/payslips/import-combined` — Sage combined-PDF upload, two-phase: preview (`commit=false`) then commit (`commit=true`)
- `POST /api/staff/payslips/import` — legacy: CSV + individual PDFs bundle (still gated by `payslips.import`)
**DB table:** `payslips` — `id`, `staff_id`, `pay_period_start/end` (DATE, unique constraint), `gross_cents/deductions_cents/net_cents` (bigint), `pdf_url` (relative `/storage/…` path), `raw_data` (jsonb), `imported_at`, `imported_by`, `archived_at`
**Key files:**
- `queries.ts` — all SQL: `upsertPayslip`, `listPayslipsForStaff`, `findPayslipById`, `archiveAgedPayslips`; always project DATE cols with `to_char(…, 'YYYY-MM-DD')` to prevent SAST midnight shift
- `services/previewImport.ts` / `services/commitImport.ts` — two-phase orchestration for combined-PDF flow
- `pdfSplitter.ts` — splits the combined PDF (pdf-lib) and reads each page's text (pdf-parse)
- `payslipLayouts.ts` — per-page layout detection + field regexes. **Two layouts:** `plain_paper` (Sage Plain Paper Payslip, current since July 2026 — value printed *before* its label, space thousands separators) and `vip` (legacy, label-first, comma separators). Deductions is derived (earnings − nett) in both, never read off the page — `commitImport` coalesces a null to 0, so an independently-parsed deductions could overwrite a correct stored value with 0 on re-import.
- `staffMatcher.ts` — matches page to staff via payroll_code → RSA ID → name-fuzzy; unmatched rows require HR manual-map in UI
- `storage.ts` — resolves relative `/storage/staff/payslips/…` to `http://100.96.203.105:8091` for server-side fetching
**RBAC:** Import routes gated by `payslips.import` permission (`withPermission('payslips.import', 'create')` — super_admin + admin only per migration 326 seed). Staff `/my` routes use `withMySession` (attendance portal session, not main RBAC) — staff see only their own rows.
**Gotchas:**
- `findPayslipById(id, null)` bypasses ownership — **never pass null from a staff-facing route**
- `upsertPayslip` uses `ON CONFLICT (staff_id, pay_period_start, pay_period_end)` and preserves `archived_at` on re-import — do not raw-INSERT
- `gross_cents` / bigint columns come back as **strings** from pg — coerce with `Number()` before arithmetic
- Combined-PDF commit: casuals can be created inline; casual INSERT is not in the same transaction as payslip upserts
- Staff `/my` portal uses dark theme; payslip pages must match dark-theme styles
- PDF URL stored as relative path (`/storage/…`) — environment-agnostic; `storage.ts` resolves to internal URL for server-side fetch
