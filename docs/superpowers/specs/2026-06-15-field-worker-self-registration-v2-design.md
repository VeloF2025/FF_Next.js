# Field Worker Self-Registration — CORRECTED Design (v2, account_status-anchored)

**Date:** 2026-06-15
**Status:** Draft for review (supersedes the discarded v1 `status='provisional'` design)
**Why v2:** The v1 design was built against a frozen main tree that lagged ~70 migrations behind `origin/master`. It missed that an `account_status` field-worker lifecycle, approval endpoints, and per-technician stock caps **already exist in production**. v1 introduced a parallel `status='provisional'` mechanism that conflicted with `account_status`; it has been scrapped (branch reset to origin/master).

## What already exists (DO NOT rebuild)

- **`staff.account_status`** lifecycle `pending → active → suspended` (migration 346) + **`staff.role`** (`technician|stores|supervisor|admin|driver|office`, CHECK-constrained).
- **Approval/suspend:** `pages/api/field/users/approve.ts` (admin-gated, `pending→active`), `suspend.ts`.
- **Create pending field worker:** `pages/api/field/users/index.ts` (withAuth) and `pages/api/my/stores/technicians.ts` (withMySession + `requireStoresActor`). Both INSERT `status='active'`, `account_status='pending'`, synthetic `${phone}@phone.local` email, phone-dedup via `findExistingStaffForRegistration`.
- **Per-individual stock gating:** `stockValueGuard.ts` (`PENDING_TECH_VALUE_CAP_ZAR=5000`) + server enforcement in `pages/api/procurement/field-stock/pickings/_create.ts` — a `pending` technician is capped at R5,000 of stock until approved.
- **Hours:** pending workers clock in normally (same `staff.id`); only `suspended` is blocked in `verifySession()`.
- **OTP/PIN onboarding:** `/my/onboard` + `/api/my/login/request-otp|verify-otp`.
- **Session already exposes** `accountStatus` + `role` + `authRole` (`AttendanceSessionProfile`, `/api/my/session`).

## Decisions (from brainstorming + corrected scope)

- Tiered trust → **already** `account_status='pending'` (clock now, stock capped at R5k). No new mechanism.
- Identity = staff row with `role ∈ {technician, casual}`, `account_status='pending'`, **`source='self_registered'`** (new marker column), `status='active'` (so attendance auth works).
- Approval = the **existing** `approve.ts` (`pending→active`). (Site-supervisor-in-portal approval UI is a later slice; SP1 reuses the admin endpoint.)
- Hiding from HR = **exclude by role/source in HR queries** (chosen).
- Build all four gaps: G1 self-serve intake, G2 HR-hiding, G3 casuals, G4 site+selfie+ID capture.

## The four gaps → build

### G1 — Self-service intake (`/my/register`)
A worker-initiated page (linked from `MyLoginScreen`): collects first/last name, phone, **declared site** (from the existing public-ish picker — needs an unauth site list), **ID number**, **live selfie**, and **worker type** (technician/casual, for G3). Submits to a **new `POST /api/my/register`** (PUBLIC, unauthenticated) that:
1. Validates inputs; `normaliseSaPhone`.
2. Phone-dedup via `findExistingStaffForRegistration` (reuse) — if an existing row matches, return it (no dupe), still send OTP.
3. Else INSERT a pending field worker mirroring `/api/my/stores/technicians`'s INSERT, but with `source='self_registered'`, `role` = chosen type, `account_status='pending'`, plus `declared_project_id`, `id_number`, `selfie_url`.
4. Generate OTP → `upsertPendingOtp` → WhatsApp (reuse `otpUtils`). Always `200` (anti-enumeration).
Step 2 (OTP+PIN) reuses `/my/onboard` verbatim → session issued. The new worker can immediately clock in; stock auto-capped at R5k until approved.

### G2 — Hide field workers from HR/employee surfaces
Two filter rules applied to the mapped surfaces:
- **Rule H (HR/employee surfaces — exclude `role IN ('technician','casual')` always):**
  `staffGetService.ts` (9 list/search branches), `neon/statistics.ts` (5 counts), `neon/queryBuilders.ts` (queryStaffWithFilters/queryActiveStaff/queryProjectManagers → feeds Excel export), `pages/api/staff/alerts.ts` (5 compliance/birthday/expiry queries), payslip `import.ts` resolveStaffByEmail, `payslips/staffMatcher.ts`, `payslips/services/previewImport.ts` (the SearchableStaffSelect dropdown), `pages/api/departments/[id].ts` + `[id]/report.ts`, `pages/api/admin/users/provision-from-staff.ts`, NOC `teamService.getUsersForDropdown`.
- **Rule P (attendance/operational surfaces — keep approved techs, exclude only `account_status='pending'`):**
  `attendance-roster.ts`, `attendance-pulse-signals.ts` (no-show), `attendance-export.ts`, `attendance-week.ts`, `searchQueries.ts` (`buildBaseWhere`), `reports/*` via `sqlHelpers.buildBaseWhere`, `geofencePatterns.ts`.
- **Flag for product decision (no change in SP1 unless confirmed):** `projects/[projectId]/team-search.ts` (a PM might legitimately add a technician), `realtime/poll.ts`.

Implementation note: prefer a single shared SQL fragment/helper (e.g. `HR_EXCLUDE_FIELD_WORKERS` and `EXCLUDE_PENDING`) so the two rules are defined once and applied consistently, reducing drift across ~19 sites. Each edit is additive (`AND (...)`).

### G3 — Casuals
- Migration: drop+re-add the `staff_role_check` CHECK to add `'casual'`:
  `CHECK (role IS NULL OR role IN ('technician','casual','stores','supervisor','admin','driver','office'))`.
- Update `StaffRole` type + `STAFF_ROLES` const (`types.ts`) to include `'casual'`.
- The intake worker-type selector offers Technician / Casual → sets `role`. Casuals follow the same pending→approve lifecycle. (Casual ≠ the payslip-importer `employment_type='casual'`; keep them distinct — flag in spec.)

### G4 — Capture site + selfie + ID
- Migration adds to `staff`: `source varchar(32) DEFAULT 'hr'`, `declared_project_id uuid`, `id_number varchar(32)`, `selfie_url text`. (NO `status='provisional'` — that was the v1 mistake. `registered_at/approved_by/at` optional; approval already stamps `updated_at`.)
- `storeRegistrationSelfie` (sharp resize → VF Storage `registrations/<staffId>/selfie.jpg`) — same helper as v1 (that part was sound).
- Public site picker: `GET /api/my/register-sites` (unauth, `{id,name}`) — same as v1 (sound).
- MyHub/`pages/my/index.tsx`: gate on `profile.accountStatus === 'pending'` → show a "pending approval — you can clock in; stock is limited to R5,000 until approved" banner and restrict tiles to Clock + History. (MyHub does not gate today.)

## Recommended build sequence (each its own plan)

- **Slice A — Intake + capture (G1 + G4 + G3 role):** the user-facing core. Independently shippable: a worker self-registers, sets a PIN, clocks in, is stock-capped at R5k, and an admin approves via the existing endpoint. Includes the migration (source/declared_project_id/id_number/selfie_url + casual CHECK), `/api/my/register`, `/api/my/register-sites`, `/my/register` page, selfie helper, MyHub pending gate.
- **Slice B — HR-hiding (G2):** the cross-cutting ~19-surface filter (Rule H + Rule P) via shared fragments + a hiding-audit test. Independently shippable; benefits even today's storeman-created technicians.

Reason to split: Slice B touches ~19 shared queries across HR/payroll/attendance/NOC/departments and carries the highest regression risk; keeping it separate from the intake build keeps each review focused and each PR independently revertable.

## Security / correctness

- `/api/my/register` is public → preserve anti-enumeration (always 200), rate-limit, reuse OTP cooldown; bodyParser size cap for the selfie; never-verified-cleanup (inert) as in v1.
- Hiding audit (Slice B): a test asserting a `role='technician'` `account_status='pending'` row does NOT appear in the HR surfaces, and a `role='technician'` `account_status='active'` row DOES appear in attendance hours but NOT in the HR employee directory.
- All edits additive; no change to the existing account_status semantics or the stock cap.

## Open items
- Casual vs payslip `employment_type='casual'` overlap — confirm they stay distinct.
- `projects/team-search` + `realtime/poll` hide decision (flagged).
- Whether self-serve registrants should be limited to `role='technician'` initially or also allow `casual` from day one (G3 in Slice A vs deferred).
