# PRD — Velocity Fibre Staff Portal (`/my`)

| Field | Value |
|---|---|
| Document | Product Requirements Document |
| Version | 0.1 — draft |
| Author | Hein van Vuuren (product), Claude (drafting) |
| Date | 2026-04-24 |
| Status | Draft — pending legal review (POPIA retention) |
| Related | Implementation plan: [PRD-040-unified-staff-portal-plan.md](./PRD-040-unified-staff-portal-plan.md) |
| Related | Infra precedent: `public/sw-fleet.js`, `src/modules/fleet/offline/useServiceWorker.ts` |

---

## 1. Executive summary

Velocity Fibre's phone-first staff tooling today is split across two portals that share no identity layer:

- **`/my`** — attendance (clock in/out, selfie + GPS, corrections). Person-scoped session.
- **`/fleet/portal`** — vehicle (fuel, daily/weekly check-in). Vehicle-scoped session via license-plate photo.

Every Velocity driver is also an attendance-tracked staff member. They log in twice a day, twice: once on `/my` for clock-in, once on `/fleet/portal` for vehicle check-in. The portals don't talk to each other even though the DB already links `staff.id ↔ vehicle_assignments`.

Separately, staff can't access their payslips without asking HR. Monthly payslip distribution is manual — a friction that consumes HR time and causes salary-dispute escalations that could be self-served.

**This project unifies `/my` into the single staff phone hub** — an installable PWA that handles attendance (today), vehicle actions (single sign-on to the fleet portal), and payslip self-service. Contractor drivers without staff accounts retain their plate-photo flow as a back-door.

---

## 2. Problem statement

### 2.1 Double login for drivers

Every staff driver (all of them, today) authenticates twice per shift:

1. `/my` — phone + 6-digit PIN → clock in.
2. `/fleet/portal` — photo of their vehicle's plate → VLM identifies vehicle → action selection.

At the end of the shift, same two logins in reverse. Field staff have flagged this repeatedly.

### 2.2 `/my` is a single-feature screen, not a hub

After login, `/my/attendance` shows one action (clock in / clock out) and a history list. There's no place for the next feature to land without cluttering the attendance view.

### 2.3 PWA ingredients exist but aren't wired

The repo has `public/manifest-my.json` scoped to `/my`, proven service-worker patterns in `public/sw-fleet.js`, and an IndexedDB-backed offline queue at `src/modules/attendance/portal/client/offline/`. Nothing glues them together. `/my` is not installable today — no Add-to-Home-Screen, no offline shell, no icon on the phone's home screen.

### 2.4 Payslip distribution is manual

HR produces per-staff PDFs in the current payroll system (Sage / VIP / Isaflow — see §5) and emails them or hands them out in person. Delays, misdelivery, and staff asking HR for re-sends cost time and create dispute surface.

---

## 3. Goals & non-goals

### 3.1 In scope

- **G1**: Drivers with an assigned vehicle log in once (to `/my`) and reach vehicle check-in without re-authenticating.
- **G2**: `/my` renders as an installable PWA. Staff add it to their home screen; it launches in standalone mode; previously-loaded pages work offline.
- **G3**: Staff view and download their own payslips on `/my/payslips`. Historical payslips (back to project start) accessible.
- **G4**: HR imports payslips through a single admin flow that supports Sage, VIP, Isaflow, and raw CSV+PDF batch uploads.

### 3.2 Out of scope

- **N1**: Unifying the main FibreFlow admin session (dashboards, NOC, procurement) with `/my`. The admin audience is office-based with different identity needs.
- **N2**: Native iOS / Android apps. The PWA is the deliverable; a native rewrite is a separate future decision.
- **N3**: Two-way sync with payroll (we read payslips, we don't write payroll data).
- **N4**: In-app payroll adjustments or leave-request workflows. Those are follow-up features if/when scoped.
- **N5**: Retiring `/fleet/portal`. Plate-photo entry stays permanently (rare contractor cohort).

---

## 4. User personas

### 4.1 Field Driver (primary — ~50 people)

Phone-only, out in the field. Has a company vehicle. Clocks in at site start, checks fuel/vehicle, does fibre work, clocks out. Low tolerance for friction; low technical literacy; often on poor cellular.

**Needs**: One login. Fast clock-in. Vehicle actions without re-entering identity. Offline resilience.

### 4.2 Office Staff / Installer (secondary — ~20 people)

Phone + occasional desktop. No assigned vehicle. Clocks in from office or site.

**Needs**: Clock-in. Payslips. Does NOT need vehicle tile (hidden).

### 4.3 HR Manager (admin — 1–2 people)

Desktop-first. Runs monthly payroll cycle.

**Needs**: Batch upload all staff's payslips for a pay period in one go. Fix per-staff mismatches before commit. See import history.

### 4.4 Contractor Driver (rare — occasional)

Outside contractor hired for a job, driving one of our vans for a day. No staff record, no phone+PIN.

**Needs**: Plate-photo entry to `/fleet/portal` (unchanged).

---

## 5. Payroll source of truth

HR uses one of three systems depending on the month / who's doing the run:

- **Sage Business Cloud Payroll** (SA Basic Auth API)
- **VIP Payroll** (desktop Windows app, CSV export)
- **Isaflow** (Velocity's own accounting system — built in-house)

Across all three, **the unit we care about is a per-staff PDF payslip per pay period**. HR already produces these today.

### 5.1 Ingestion strategy — universal batch first

Support all three systems via a **single batch-upload admin path** first. HR drops a folder/zip of per-staff PDFs + a CSV summary, regardless of which payroll ran. This works for 100% of cases on day one.

Then add system-specific connectors as follow-up work, in this order:

1. **Isaflow** — first API connector (in-house, lowest integration risk).
2. **Sage Business Cloud** — public SA API, we already have Sage integration knowledge from the accounting app.
3. **VIP** — desktop-only; will likely remain CSV-upload-forever since there's no API on VIP Classic.

---

## 6. User stories

### 6.1 Driver — unified login

> **AS A** field driver
> **I WANT** to log into `/my` once per shift
> **SO THAT** I can clock in AND do my vehicle check-in without authenticating twice.

### 6.2 Driver — install to home screen

> **AS A** field driver
> **I WANT** to install the portal on my phone's home screen with one tap
> **SO THAT** it launches like an app, not buried in a browser tab.

### 6.3 Any staff — offline resilience

> **AS A** field worker with a patchy signal
> **I WANT** the portal to load the last-known shell when offline
> **SO THAT** I can still clock in/out and the queue syncs when I get signal back.

### 6.4 Staff — see payslip

> **AS A** staff member
> **I WANT** to open `/my`, tap Payslips, and see my last payslip
> **SO THAT** I don't need to ask HR to re-send it.

### 6.5 Staff — see history

> **AS A** staff member
> **I WANT** to scroll back through all my payslips since joining
> **SO THAT** I can compare months, download for a loan application, etc.

### 6.6 HR — monthly batch import

> **AS A** HR manager
> **I WANT** to upload all staff's payslip PDFs for a pay period in one batch
> **SO THAT** I don't repeat the process 50 times.

### 6.7 HR — import preview

> **AS A** HR manager
> **I WANT** to see a preview before committing (matched: 48, unmatched: 2)
> **SO THAT** I can fix mismatches (wrong staff ID, wrong period) before they're live.

### 6.8 Contractor driver — unchanged

> **AS A** contractor driving a Velocity van for a day
> **I WANT** to open `/fleet/portal`, photograph the plate, and proceed exactly as today
> **SO THAT** my workflow isn't broken by the staff-portal changes.

---

## 7. Functional requirements

### 7.1 PWA hub

- **FR-HUB-01**: `/my` (after login) renders a tile grid: Clock, My Vehicle (if assigned), Payslips (if any), Corrections, History.
- **FR-HUB-02**: Tile visibility is data-driven by a new `/api/my/hub-summary` endpoint. No client-side feature flags.
- **FR-HUB-03**: The page must be installable via Add-to-Home-Screen on iOS Safari and Android Chrome. Install prompts are platform-aware.
- **FR-HUB-04**: A service worker caches the hub shell so a previously-visited `/my` loads offline. The existing clock-event offline queue is preserved and unchanged.
- **FR-HUB-05**: Service-worker version bumps display an "Update available — tap to reload" banner; no silent HTML caching forever.
- **FR-HUB-06**: First-visit install prompt is dismissible and remembered. No re-nag.

### 7.2 Unified login — fleet SSO

- **FR-SSO-01**: Tapping "My Vehicle" from the `/my` hub routes to `/fleet/portal` without re-authentication.
- **FR-SSO-02**: `/fleet/portal` skips the plate-photo step when the request is authenticated via an `/my` session AND the staff member has an active vehicle assignment. The assigned vehicle pre-populates.
- **FR-SSO-03**: Staff without an active vehicle assignment cannot reach `/fleet/*` via the `/my` session path (403).
- **FR-SSO-04**: `/fleet/portal` plate-photo entry remains fully functional for contractor drivers (no regression).
- **FR-SSO-05**: Fleet-side session (`ff_portal_session`) is NOT merged with `/my` session (`ff_my_session`). SSO bridge is one-directional; cookie shapes unchanged.

### 7.3 Payslip self-service

- **FR-PAY-01**: `/my/payslips` lists all payslips for the authenticated staff, latest first, sorted by pay-period-start desc.
- **FR-PAY-02**: Each row shows pay period, gross, net, and a "Download PDF" action.
- **FR-PAY-03**: PDF download uses a short-lived signed URL from VF Storage (≤ 60 s TTL).
- **FR-PAY-04**: Staff cannot see any other staff's payslips (server-side staff_id filter, not trusted from client).
- **FR-PAY-05**: Every payslip view and download is audit-logged (staff_id, accessed_at, IP-prefix, user-agent-coarse) for POPIA compliance.
- **FR-PAY-06**: Historical payslips backfilled from project start are accessible identically to current-period ones.

### 7.4 HR-side payslip import

- **FR-IMP-01**: Admin page `/staff/payslips/import` (new permission `payslips.import`, seeded for HR manager role only).
- **FR-IMP-02**: HR uploads a batch: one ZIP containing per-staff PDFs + a CSV summary per pay period.
- **FR-IMP-03**: CSV columns: `staff_id` (or `phone` as fallback lookup), `pay_period_start`, `pay_period_end`, `gross_cents`, `deductions_cents`, `net_cents`, `pdf_filename`.
- **FR-IMP-04**: Preview before commit: shows matched (staff_id resolvable, PDF present, period not already imported) vs unmatched rows.
- **FR-IMP-05**: Unmatched rows blockable at line level; HR can edit the staff mapping and re-preview.
- **FR-IMP-06**: Commit is atomic per pay-period: either all matched rows import or none do. Partial imports create support headaches.
- **FR-IMP-07**: Re-importing an existing (staff_id, pay_period_start, pay_period_end) triple is a no-op by default; HR can force-overwrite with a confirmation modal (use case: re-issued payslip after correction).
- **FR-IMP-08**: Payroll-system-specific connectors come later (Isaflow first → Sage → VIP) but MUST produce data the batch path already accepts. Connectors are thin fetchers, not new import paths.

### 7.5 POPIA compliance

- **FR-POPIA-01**: Payslip PDFs encrypted at rest in VF Storage (existing VF Storage setup).
- **FR-POPIA-02**: Audit log for every read/download; retained for at least the retention period.
- **FR-POPIA-03**: Retention: see §10 — **research pending (default proposal: 7 years)**.
- **FR-POPIA-04**: Automated purge job runs monthly; deletes payslip PDF blobs and DB rows older than retention cut-off.
- **FR-POPIA-05**: Staff termination → personal data access handled per existing POPIA process (out of scope to re-design here, but payslip data respects the same termination triggers).

---

## 8. Non-functional requirements

### 8.1 Performance

- **NFR-PERF-01**: `/my` hub first load < 2 s on 4G. Shell from cache subsequently < 500 ms.
- **NFR-PERF-02**: `/api/my/hub-summary` responds < 200 ms server-side for 95th percentile.
- **NFR-PERF-03**: Payslip PDF download initiates < 1 s from tap.

### 8.2 Reliability

- **NFR-REL-01**: Each phase has a kill switch. Service worker unregister, SSO bridge disable, payslip tile hide. No phase can break clock-in.
- **NFR-REL-02**: Payslip-import failures roll back atomically; HR re-runs the full batch.

### 8.3 Security

- **NFR-SEC-01**: Staff-side endpoints require `withMySession`. Admin-side endpoints require `withPermission('payslips.import')`.
- **NFR-SEC-02**: Payslip DB access filtered by `staff_id` matching session on every query. No trust of client-provided staff_id.
- **NFR-SEC-03**: Signed URLs short-lived, logged.
- **NFR-SEC-04**: No cross-tenant leakage — the DB lives in a single-tenant deployment, but queries explicitly filter regardless.

### 8.4 Accessibility

- **NFR-A11Y-01**: WCAG AA contrast across all `/my` views (we're close after today's dark-theme work; audit planned in Phase 4).
- **NFR-A11Y-02**: All interactive elements ≥ 44×44 CSS pixels (iOS HIG). Current method-toggle buttons on login are 32px — to be fixed.
- **NFR-A11Y-03**: Screen-reader labels on all tile actions and payslip rows.

### 8.5 Privacy (POPIA)

- **NFR-PRIV-01**: No 3rd-party analytics on `/my` surfaces that see staff identity. Web-vitals telemetry is aggregate only.
- **NFR-PRIV-02**: Reverse-geocode already proxied server-side (shipped #1460) so OpenStreetMap doesn't see individual staff IPs.

### 8.6 Observability

- **NFR-OBS-01**: Stderr mirror pattern (shipped today in #1434, #1454) extended to payslip-import + SSO-bridge catch blocks, so silent failures are grep-able in `/var/log/fibreflow-production.error.log`.

---

## 9. Dependencies

| Dep | Owner | Status |
|---|---|---|
| Payroll system confirmed-per-month-run (Sage / VIP / Isaflow) | Hein + HR | ✅ answered: all three supported, plus batch |
| Per-staff PDF availability | Hein + HR | ✅ answered: yes, available today |
| POPIA retention period | Legal review | ⏳ to confirm (proposal: 7 years) |
| Historical payslip backfill scope | HR | ✅ answered: back-import all |
| Isaflow API access / credentials | Hein (Isaflow owner) | Needed before connector phase |
| Sage Business Cloud API credentials | Finance | Needed before Sage connector |
| VIP export file format sample | HR | Needed before VIP connector |

---

## 10. POPIA retention — research & proposal

Applicable South African law:

- **Basic Conditions of Employment Act (BCEA)** §31: employee records retained **3 years** after employment ends.
- **Income Tax Act** §29: records relevant to tax must be kept for **5 years** after submission of the tax return they relate to.
- **POPIA** §14: personal information retained only for as long as necessary for the purpose, then deleted/de-identified. Allows longer retention where required by law.
- **Companies Act** §24: accounting records **7 years**.

**Proposal**: keep payslip PDFs + DB rows for **7 years from pay-period-end**, then auto-purge. Rationale: payslips overlap with accounting records (they're the source of salary GL entries). 7 years satisfies Companies Act, BCEA, Income Tax Act, and POPIA's "necessary" test simultaneously.

**Legal review required** before FR-POPIA-03 locks this in.

---

## 11. Success metrics

| Metric | Baseline | Target (3 months post-launch) |
|---|---|---|
| Drivers logging in twice per shift (telemetry: unique session pairs same-staff same-day) | ~50/day | < 5/day (contractor only) |
| `/my` hub installs (Add-to-Home-Screen) | 0 | > 30 installs across staff |
| Payslip self-service usage | 0 | > 80% of staff views own payslip within 48 h of publish |
| HR "send me my payslip" requests per month | unmeasured baseline — HR surveys pre-launch | < 5 / month |
| Clock-in 500 error rate | ~0 post #1456 | Maintained at ~0 |

---

## 12. Rollout plan

| Phase | Scope | Duration | Deployable independently |
|---|---|---|---|
| **1. PWA hub infra** | Service worker, tile-grid hub, install prompt | 1 week | ✅ Standalone |
| **2. Fleet SSO bridge** | `/my`-session accepted at `/fleet/*` when vehicle assigned | 1 week | ✅ Standalone |
| **3a. Payslip batch upload + self-service** | DB schema, admin import, `/my/payslips` | 2 weeks | ✅ Standalone |
| **3b. Isaflow connector** | Scheduled fetch from Isaflow API into payslip import | 1 week | ✅ Builds on 3a |
| **3c. Sage connector** | Scheduled fetch from Sage Business Cloud Payroll API | 1 week | ✅ Builds on 3a |
| **3d. VIP support** | CSV-only (no API), remains batch-upload-driven permanently | N/A | Already covered by 3a |
| **4. Polish** | WCAG audit, tap-target sweep, perf tuning, expand tile grid | rolling | — |

Total linear time: ~6 weeks. Phases 2, 3a, 3b, 3c can run in parallel after phase 1 ships.

---

## 13. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Service worker caches stale HTML, users stuck on old version | Medium | Medium | Update banner + skip-waiting, same pattern `sw-fleet.js` uses |
| SSO bridge regresses contractor plate-photo flow | Low | High | Guard every branch with `ff_my_session` presence check; regression test before merge |
| CSV import format drift across Sage/VIP/Isaflow | Medium | Medium | Define canonical CSV schema; connectors normalize; HR sees a single UI |
| POPIA retention retroactively changes | Low | Medium | Retention as a config constant, single place to update |
| Payslip DB grows large (50 staff × 12 months × 7 years = 4 200 rows + 4 200 PDFs in VF Storage) | Low | Low | Not a scale problem at this org size |
| Isaflow API breaks when Hein iterates Isaflow | Medium | Low | Connector has a clean fallback to batch upload; treat API as a convenience not a dependency |

---

## 14. Open questions

1. **POPIA retention confirmation** — legal review of the 7-year proposal.
2. **Payslip line-item detail** — do staff need to see deduction breakdown (PAYE, UIF, pension) or just gross / net / download PDF for detail? Affects `payslips.raw_data` JSONB shape.
3. **VIP users** — how many of our monthly payroll runs use VIP today? If it's most runs, we prioritize the VIP CSV contract. If Sage/Isaflow dominate, VIP can be CSV-only forever.
4. **Admin-side access** — should supervisors (not just HR) see a staff member's payslips in any flow? Affects `withPermission` gate.
5. **Notification on new payslip** — WhatsApp DM when a new payslip lands? Potentially useful; not in scope for phase 3.

---

## 15. References

- Implementation plan: [PRD-040-unified-staff-portal-plan.md](./PRD-040-unified-staff-portal-plan.md) — technical design, file-by-file.
- Today's shipped /my work: PRs #1421, #1423–#1428, #1432, #1434–#1438, #1440, #1441, #1446–#1448, #1450–#1452, #1454, #1456, #1458, #1460.
- Memory: `memory/project_time_attendance.md`, `memory/feedback_my_portal_dark_theme.md`, `memory/reference_ios_safari_geolocation_fix.md`.
- POPIA: https://popia.co.za/
- Nominatim usage policy (already in use via #1460): https://operations.osmfoundation.org/policies/nominatim/
