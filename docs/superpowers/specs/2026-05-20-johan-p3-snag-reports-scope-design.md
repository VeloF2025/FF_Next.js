# P3 — Per-pole / per-PON / per-zone snag reports

**Status:** Draft (design approved by Hein 2026-05-20)
**Parent spec:** [`2026-05-19-johan-civil-qa-snags-bulk-upload-design.md`](./2026-05-19-johan-civil-qa-snags-bulk-upload-design.md) §4.4
**Implementation plan:** `docs/superpowers/plans/2026-05-20-johan-p3-snag-reports-scope.md` (to be written next)

---

## 1. Why this addendum exists

The parent spec covered P3 at design-intent level but its `§4.6` migration list (354 / 355 / 356) was written before the codebase was inspected. Reality at 2026-05-20:

| Spec proposal | Actual state |
|---|---|
| Migration 354 — `snags` + `slot_key` + `scope_zone_no` | `snags.slot_key` shipped earlier (mig 247); `scope_zone_no`/`scope_pon_no` not present — but **not needed** (P3 queries join `pole_qa_photos` directly) |
| Migration 355 — `snag_demotes_vlm` trigger | Not landed; out of P3 scope |
| Migration 356 — `snag_reports.scope*` cols | Migration **356 was used for `works_qa_corrections`** (P1). P3 needs its own migration |
| `pages/api/snags/reports.ts` PDF generation | The file is currently CRUD-only (172 lines, GET list / POST TQR row / DELETE). No PDF, no scope filter |
| `project_reusable_report_template` | Actual file is `src/templates/reports/report-template.ts` (430 lines, already powers uptake / vlm-training / agreement PDFs) |

This addendum resolves four design decisions made on 2026-05-20 and locks in the implementation contract.

---

## 2. Decisions (locked)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Persist scoped reports** as rows in `snag_reports` (new migration 357) | Audit trail + library re-access; matches the existing TQR pattern |
| D2 | **Immutable PDF snapshot** stored in VF Storage at generate time | Yesterday's "Zone 24 report" must still show yesterday's numbers; compliance expectation |
| D3 | **Library home:** extend existing `SnagReportsPage` with a `source` filter chip (`TQR | Works QA | Scoped`) | One library page; no nav duplication; card layout shows scope summary text for `source='scope'` rows |
| D4 | **Export formats:** PDF (snapshot, stored) + Excel `.xlsx` (regenerated on demand). No plain CSV | Matches FibreFlow's universal Excel export pattern with ISO dates ([[feedback_excel_date_format]]); CSV adds no value |

---

## 3. Data model

### 3.1 Migration 357 — `357_snag_reports_scope.sql`

```sql
ALTER TABLE snag_reports
  ADD COLUMN scope            TEXT NOT NULL DEFAULT 'project',
  ADD COLUMN scope_zone_no    INT,
  ADD COLUMN scope_pon_no     INT,
  ADD COLUMN scope_poles      TEXT[],
  ADD COLUMN scope_from_date  DATE,
  ADD COLUMN scope_to_date    DATE,
  ADD COLUMN scope_severities TEXT[],
  ADD COLUMN scope_categories TEXT[],
  ADD COLUMN pdf_url          TEXT,
  ADD COLUMN generated_by     UUID REFERENCES users(id),
  ADD COLUMN generated_at     TIMESTAMPTZ;

-- Extend source check to include the new 'scope' source
ALTER TABLE snag_reports DROP CONSTRAINT snag_reports_source_check;
ALTER TABLE snag_reports
  ADD CONSTRAINT snag_reports_source_check
  CHECK (source IN ('tqr', 'works_qa', 'scope'));

-- Constraint: scope rows MUST have a generated_at + pdf_url (sanity)
ALTER TABLE snag_reports
  ADD CONSTRAINT snag_reports_scope_requires_pdf
  CHECK (source <> 'scope' OR (pdf_url IS NOT NULL AND generated_at IS NOT NULL));

CREATE INDEX snag_reports_scope_idx
  ON snag_reports (project_id, scope, scope_zone_no, scope_pon_no);

CREATE INDEX snag_reports_generated_at_idx
  ON snag_reports (generated_at DESC)
  WHERE source = 'scope';
```

**Rollback** (`scripts/migrations/sql/rollback_357_snag_reports_scope.sql`) drops the new constraints, indexes, and columns in reverse order.

### 3.2 `report_number` generator

Format: `SCOPE-<projectCode>-<YYYYMMDD>-<seq>`
- `projectCode` = first 4 chars of `projects.project_name` uppercased + slug (e.g. `LAWL`, `MOHA`)
- `seq` = zero-padded count of scope reports created for this project on this date, +1
- Uniqueness: existing `uq_snag_reports_project_report` (`project_id, report_number`) covers us

If two requests collide on the same second (race), the unique-index error is caught and retried once with `seq+1`. Same pattern as the activate PP-data ticket retry that this session normalized (PR #1666).

### 3.3 What we DO NOT add

- No `scope_zone_no` / `scope_pon_no` on the `snags` table (parent spec migration 354). Reason: the query joins `pole_qa_photos` (which has `zone_no`, `pon_no`, `pole_number`) — the data is already reachable without denormalising. If query perf becomes an issue we can add the columns later.
- No `snag_demotes_vlm` trigger (parent spec migration 355). Out of P3 scope.

---

## 4. Backend

### 4.1 Routes (flattened, no nested dynamic per CLAUDE.md)

| Route | File | Verb | Purpose |
|---|---|---|---|
| `/api/snags/reports` | `pages/api/snags/reports.ts` (existing, 172 lines) | GET | List reports — **extend** with `?source=scope` filter |
| `/api/snags/reports-scope` | `pages/api/snags/reports-scope.ts` (NEW, < 300 lines) | POST | Generate a scoped report: query → persist row → render PDF → store → return `{id, report_number, pdf_url}` |
| `/api/snags/reports-scope-xlsx` | `pages/api/snags/reports-scope-xlsx.ts` (NEW, < 200 lines) | GET `?id=` | Regenerate Excel for an existing scope report |
| `/api/snags/reports-scope-pdf` | `pages/api/snags/reports-scope-pdf.ts` (NEW, < 100 lines) | GET `?id=` | Stream the stored PDF (passes through `pdf_url`; lets us swap storage backends later without UI changes) |

All routes wrapped with `withAuth` + `qa:report:read` permission check (per parent spec §4.7).

### 4.2 Generate flow (`reports-scope.ts`)

```
POST /api/snags/reports-scope
Body: {
  project_id: uuid,
  scope: 'pole' | 'pon' | 'zone',
  zones?: number[],
  pons?: number[],
  poles?: string[],          // pole_number strings
  from_date?: string,        // ISO YYYY-MM-DD, default = 30 days ago
  to_date?: string,          // ISO, default = today
  severities?: ('minor'|'major'|'critical')[],
  categories?: string[],
}

→ 1. validate scope-vs-arrays consistency (scope='pole' requires poles[].length >= 1, etc.)
  2. run scope-query SQL (see 4.3) — must return >= 1 row, else 400 "No snags in scope"
  3. INSERT snag_reports row, source='scope', generated_by=req.user.id, generated_at=NOW(),
     report_number = generated via 3.2, pdf_url = NULL (filled in step 5)
  4. Build ReportData (the universal report-template schema)
     - cover: project name + scope summary string + severity totals
     - sections: zone → PON → pole hierarchy (only rendered for scope levels above 'pole')
     - per-pole detail: thumbnails (snagged slots highlighted red), description, status, assignee, ticket UID
  5. Render HTML via report-template → puppeteer PDF → upload to VF Storage
     at /storage/snag-reports/<projectId>/<reportId>.pdf
  6. UPDATE snag_reports SET pdf_url = '<vf storage path>' WHERE id = ...
  7. return apiResponse.created(res, { id, report_number, pdf_url })
```

Concurrency: serialise the `report_number` generation behind a short advisory lock keyed on `(project_id, YYYYMMDD)`. Avoids unique-violation retries when two managers click "Generate" within the same second on the same project.

### 4.3 Scope query SQL (canonical)

```sql
SELECT
  s.id, s.snag_number, s.category, s.severity, s.description, s.status,
  s.assigned_to, s.created_at, s.fixed_at, s.verified_at, s.closed_at,
  s.noc_ticket_id,
  p.id AS pole_qa_photo_id, p.zone_no, p.pon_no, p.pole_number,
  s.slot_key,
  nt.uid AS noc_ticket_uid
FROM snags s
LEFT JOIN pole_qa_photos p ON p.id = s.pole_qa_photo_id
LEFT JOIN noc_tickets nt   ON nt.id = s.noc_ticket_id
WHERE s.project_id = $1
  AND ($2::int[]  IS NULL OR p.zone_no    = ANY($2))
  AND ($3::int[]  IS NULL OR p.pon_no     = ANY($3))
  AND ($4::text[] IS NULL OR p.pole_number = ANY($4))
  AND s.created_at >= $5
  AND s.created_at <  $6 + INTERVAL '1 day'
  AND ($7::text[] IS NULL OR s.severity = ANY($7))
  AND ($8::text[] IS NULL OR s.category = ANY($8))
ORDER BY p.zone_no NULLS LAST, p.pon_no NULLS LAST, p.pole_number NULLS LAST, s.created_at;
```

**Crucial:** this query uses `pg.Pool` via `@/lib/db`, **not** the Neon serverless shim. The shim breaks conditional SQL (per CLAUDE.md tech debt note). All P3 routes use the modern `pg.Pool` path.

### 4.4 Excel render (`reports-scope-xlsx.ts`)

- Loads the stored `snag_reports` row + reruns the scope query
- Builds an xlsx workbook via the `xlsx` library:
  - **Sheet 1 — Summary**: KPIs (total snags, by severity, by category, by status)
  - **Sheet 2 — Snags**: one row per snag with all columns from the canonical query, ISO date strings, NOC ticket UID hyperlink
  - **Sheet 3 — Scope**: the scope parameters used at generate time (so the spreadsheet is self-describing)
- ISO dates everywhere (per [[feedback_excel_date_format]]) — never locale strings, never Excel serials
- Streams as `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

---

## 5. PDF template adapter

New file: `src/modules/construction-qa/services/snagReportRenderer.ts` (< 250 lines)

- Takes the scope query rows + `snag_reports` row → builds a `ReportData` object compatible with the universal `src/templates/reports/report-template.ts`
- Slot-thumbnail resolution: for each row that has `slot_key`, the renderer does a per-pole lookup on `pole_qa_photos` to read the matching `<slot_key>_url` column dynamically (single batched query per render, keyed by `pole_qa_photo_id`). This lets the canonical query stay flat and keeps the dynamic-column logic in TS, not SQL.
- KPIs row: `[ Total snags | Critical | Major | Minor | Resolved % ]`
- Sections (cards): one per zone in scope, listing PONs → poles → snag descriptions with status pills
- Cover blurb: past tense per [[feedback_report_tense_rectification]] (e.g. *"This report covers snags raised between 2026-04-20 and 2026-05-20 across Zone 24, PONs 265/266/267."*)
- VF logo via existing `getVfLogoBase64()` helper (already used in uptake-report)

The renderer does NOT call puppeteer itself — it returns the HTML string. The route handler in 4.2 does the puppeteer launch + PDF write. This keeps the renderer pure (testable without puppeteer in CI).

---

## 6. UI

### 6.1 New components

```
src/modules/works-qa/components/
  SnagReportButton.tsx              (< 120 lines) — context-aware label + Advanced dropdown
  SnagReportScopeDialog.tsx         (< 200 lines) — modal shell, form orchestration
  ScopeChipPicker.tsx               (< 150 lines) — chip multi-select for zones/PONs/poles
src/modules/works-qa/hooks/
  useReportScopeForm.ts             (< 100 lines) — form state + validation hook
```

### 6.2 Placement

- `SnagReportButton.tsx` rendered inside `WorksQAPage` header (between `WorksQAProjectCard` and `WorksQAFiltersBar`). Reads `zone_no` / `pon_no` / `pole_id` from `router.query` to derive label and prefill the dialog's default scope.
- `WorksQAPage` is currently 216 lines — adding the button will push it over the 200-line component limit. Refactor: extract a `WorksQAPageHeader.tsx` (~80 lines) that hosts the button + project info, keeping `WorksQAPage` as the orchestration shell.

### 6.3 Library page changes

`src/modules/construction-qa/components/snags/SnagReportsPage.tsx` (338 lines, already over 300 — refactor scope-creep risk):

- Add `source` filter chip: `[All]` / `[TQR]` / `[Works QA]` / `[Scoped]`. Drives `?source=` query param to the existing GET endpoint.
- When `source='scope'`, card shows: scope summary line ("Zone 24 · PON 265, 266 · 2026-04-20 → 2026-05-20"), severity totals, "Open PDF" / "Excel" action buttons.
- **Scope creep guard:** if reducing `SnagReportsPage` to < 300 lines requires a non-trivial refactor, that's a separate PR. P3 only ADDS the filter chip + scope card variant; existing TQR card behaviour stays put.

### 6.4 Confirmation flow

After successful `POST /api/snags/reports-scope`:
1. Modal switches to "Report ready" state showing `report_number` + scope summary
2. Two buttons: `[Open PDF]` (new tab → `pdf_url`) / `[Download Excel]` (triggers GET to xlsx endpoint)
3. Closing the modal returns to WorksQAPage; library has the new row visible after next refresh

This matches the [[project_share_token_actor_pattern]] / P2's 2-step confirmation pattern.

---

## 7. RBAC

| Action | Permission | Notes |
|---|---|---|
| Generate scoped report | `qa:report:read` | Per parent spec §4.7 — viewer can generate (read action) |
| View library (incl. scoped) | `qa:report:read` | Existing — no change |
| Delete scoped report | `qa:report:delete` (NEW) | super_admin + manager only; protect immutable audit trail |

Add `qa:report:delete` to `pages/api/_permissions/seed.ts` with deny rows for technician/viewer per [[feedback_rbac_parent_override_cascade]].

---

## 8. Tests

| Layer | Test | What it proves |
|---|---|---|
| Unit | `generateReportNumber.test.ts` | Format, uniqueness retry, project-code derivation |
| Unit | `snagReportRenderer.test.ts` | ReportData shape, KPI totals, severity grouping, ISO dates, cover blurb past tense |
| Unit | `useReportScopeForm.test.ts` | Default scope from URL params, validation (poles[].length when scope=pole), submit shape |
| Integration | `reports-scope.api.test.ts` | POST → DB row inserted with all scope cols → PDF written to storage (mocked) → returns `{id, pdf_url}` |
| Integration | `reports-scope-xlsx.api.test.ts` | GET → 3-sheet workbook → ISO dates → row count matches scope query |
| Integration | `reports-list-source-filter.test.ts` | GET `/api/snags/reports?source=scope` returns only scope rows |
| Browser (Playwright) | `p3-snag-report-flow.spec.ts` | WorksQAPage → click button → modal opens → submit defaults → confirmation with PDF link → open library → filter Scoped → row visible |

All integration tests hit the real DB (per global rule "no mocks for DB"). PDF rendering mocked in unit tests, real-rendered in one Playwright smoke test.

---

## 9. Rollout

1. Migration 357 applied via `scripts/deploy-local.sh dev` step 3a (auto-runner picks up `scripts/migrations/sql/357_*.sql`)
2. Dev validation: generate one scope report from WorksQAPage, verify PDF stored + library shows it
3. Johan WA test on dev — Afrikaans message
4. Prod deploy after-hours with Hein's OK + production migration step
5. Add to changelog via `/log`

---

## 10. Out of scope (deferred)

- Bulk per-pole VLM upload (P4) — parent spec §4.5
- `snag_demotes_vlm` trigger — parent spec §4.6 mig 355
- Sharing scope reports via public token (would need `share_session_actors` pattern per [[project_share_token_actor_pattern]])
- Email / WA delivery of generated reports
- Auto-regeneration on schedule
- Cross-project scope (current design is single-project)

---

## 11. References

- Parent spec: [`2026-05-19-johan-civil-qa-snags-bulk-upload-design.md`](./2026-05-19-johan-civil-qa-snags-bulk-upload-design.md) §4.4, §4.6, §4.7
- Universal report template: `src/templates/reports/report-template.ts`
- Existing scope-similar code: `pages/api/reports/uptake-pdf.ts` (puppeteer + VF Storage upload pattern)
- Existing TQR library: `src/modules/construction-qa/components/snags/SnagReportsPage.tsx`
- Field App: `src/modules/works-qa/components/WorksQAPage.tsx`
- Memories: [[feedback_excel_date_format]], [[feedback_report_tense_rectification]], [[feedback_snag_report_granularity]], [[feedback_browser_playwright]], [[feedback_file_size_limit_strict]], [[feedback_migration_directory]]
